# Plan 4 — Multiple Jelly teams

## Summary

Marmalade is single-tenant by configuration, not by architecture. `JELLY_TEAM_ID`
and `JELLY_API_KEY` are environment variables, and `env.JELLY_TEAM_ID` is read at
55 call sites. The database, however, is already most of the way there: a
`jelly_team` table exists and nine tables already carry `jelly_team_id`.

The work splits into four things, in this order:

1. **Fix mailbox authorisation first.** It does not currently work (see below).
   Until it does, mailbox scoping cannot be the tenant boundary, and everything
   else here is built on sand.
2. **Resolve the team once, at the context boundary**, so `env.JELLY_TEAM_ID`
   can be deleted rather than replaced.
3. **Move per-team credentials from environment into the database**, so adding a
   team is a row, not a redeploy. This is the whole of "scales easily".
4. **Make isolation un-forgettable** with row-level security, so the 55 call
   sites cannot each be a place someone forgets a `where`.

---

## 0. Prerequisite: mailbox authorisation is not enforced

This was found while auditing what the tenant boundary would be, and it is a
present-day bug independent of multi-tenancy.

Not one read route in `packages/api/src/routers/convo.ts` calls
`requireMailboxAccess`:

| Route                                                | Procedure                           | Checks caller may use `{mailboxId}`? | Joins `conversation_mailbox`? |
| ---------------------------------------------------- | ----------------------------------- | ------------------------------------ | ----------------------------- |
| `GET /mailboxes/{id}/conversations`                  | `mailboxScopedProcedure`            | no                                   | yes                           |
| `GET /mailboxes/{id}/conversations/{cid}`            | `apiKeyOrSessionOrWebhookProcedure` | no                                   | yes                           |
| `GET /mailboxes/{id}/conversations/{cid}/assignment` | `mailboxScopedProcedure`            | no                                   | **no**                        |
| `GET /mailboxes/{id}/conversations/{cid}/messages`   | `apiKeyOrSessionOrWebhookProcedure` | no                                   | **no**                        |
| `GET /mailboxes/{id}/messages/{mid}`                 | `apiKeyOrSessionOrWebhookProcedure` | no                                   | yes                           |
| `GET /mailboxes/{id}/conversations/{cid}/comments`   | `apiKeyOrSessionOrWebhookProcedure` | no                                   | **no**                        |
| `GET /mailboxes/{id}/comments/{cid}`                 | `apiKeyOrSessionOrWebhookProcedure` | no                                   | yes                           |

Two distinct problems:

- Routes on `apiKeyOrSessionOrWebhookProcedure` never resolve
  `allowedMailboxIds` at all — only `mailboxScopedProcedure` does that. The only
  gate they apply is `checkRouterScope`, which asks "may this key touch the
  `convo` router", not "which mailboxes".
- The routes that _do_ join `conversation_mailbox` join it on the `mailboxId`
  from the path. That scopes the rows to the named mailbox, but nothing checks
  the caller is entitled to that mailbox. Passing a different mailbox id returns
  that mailbox's data.
- The three routes that do not join at all filter on `conversationId` alone, so
  knowing a conversation id is sufficient to read its messages, comments and
  assignments.

Net effect today: **any API key holding the `convo` router scope can read every
conversation in the team, whatever its mailbox scopes say.** That is the opposite
of the README's "finely-grained & least-privileged api access", and the mailbox
scope UI implies a boundary that is not applied.

The write path added in Plan 1 does enforce it — `submitAction` calls
`requireMailboxAccess` and `requireMailboxWritesEnabled` — so this is confined to
reads.

**Fix before anything else here**: move every read route onto
`mailboxScopedProcedure`, call `requireMailboxAccess(context, input.mailboxId)`
at the top of each handler, and make the three unjoined routes resolve the
conversation through `conversation_mailbox` so a conversation id alone proves
nothing. This is a small, self-contained change and should ship on its own,
ahead of multi-team work, because it is a live authorisation bug.

---

## 1. What is already right

Worth stating, because it determines how much of this is addition rather than
rework.

- `jelly_team` exists as a real table with Jelly's team id as the primary key.
- Nine tables already carry `jelly_team_id`: `jelly_action`, `api_key`,
  `audit_log`, `jelly_conversation_mailbox`, `jelly_mailbox`,
  `jelly_mailbox_member`, `mailbox`, `jelly_contact`.
- `api_key.jellyTeamId` already exists and is already populated — the API key
  **is** a tenant selector today, it is just never consulted.
- The quota and circuit-breaker tables from Plans 1 and 2 are keyed by
  `(scope, scopeId)` with `scope = 'team'`. Per-team quota accounting and a
  per-team circuit breaker already work, unchanged, for N teams. One team being
  rate-limited will not pause another.
- `jelly_mailbox` is already `unique(jelly_mailbox_id, jelly_team_id)`.
- `packages/api/src/lib/jelly.ts` already takes `teamId` in its constructor and
  `createJellyClient(url, key, teamId)` already accepts all three.

## 2. What assumes one team

### 2.1 Content tables have no team column

Missing `jelly_team_id`: `jelly_conversation`, `jelly_message`, `comment`,
`jelly_label`, `jelly_conversation_label`, `jelly_conversation_assignment`,
`jelly_message_contact`, `jelly_message_attachment`, `mailbox_member`.

Of the observability tables, `jelly_request_log` and `jelly_webhook_delivery`
also need one, so usage and webhook health can be reported per team.

### 2.2 Identity is globally unique

`jelly_contact.email` is `.notNull().unique()`. One person in two Jelly teams
cannot be represented. `packages/db/src/schema/team.ts` still contains the
commented-out previous version of this table which had
`unique(email, jellyTeamId)` — the right shape was already written once and
backed out.

### 2.3 Credentials are environment variables

`JELLY_API_KEY`, `JELLY_WEBHOOK_SECRET`, `WEBHOOK_USERNAME`, `WEBHOOK_PASSWORD`
and `JELLY_TEAM_ID` are all single-valued env vars. Adding a team currently
means a redeploy, which is the thing that stops this scaling.

### 2.4 The Jelly client is a module singleton

`getJellyClient()` caches one client in a module-level variable. Three call
sites: `routers/mailbox.ts`, `routers/team.ts`, `lib/actions/outbox.ts`.

### 2.5 The webhook cannot tell you which team it is for

Jelly's structured payload is `{ event, created_at, data }`. There is no team
identifier anywhere in the body or the documented headers, and the signing
secret is per-webhook-configuration. One endpoint plus one
`JELLY_WEBHOOK_SECRET` therefore cannot serve several teams — the team has to
come from the URL.

### 2.6 A session has no notion of "which team am I looking at"

`teamMemberProtectedProcedure`, `teamAdminProtectedProcedure` and
`mailboxScopedProcedure` all resolve the caller's role with
`eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID)`. With several teams a user
may hold a different role in each.

### 2.7 Two latent bugs that become tenant bugs

- **`mailbox` has no unique constraint.** `marmaladeMailbox` is keyed only on a
  serial id; nothing stops two rows for the same `(jellyMailboxId, jellyTeamId)`.
  `requireMailboxWritesEnabled` does `.limit(1)` and takes whichever row comes
  back, so a duplicate silently decides whether writes are allowed. Add
  `unique(jelly_mailbox_id, jelly_team_id)`.
- **Conversation ids are trusted to be globally unique.** `jelly_conversation.id`
  is Jelly's own id used as the primary key, and the webhook path inserts with
  `onConflictDoNothing`. Jelly is one multi-tenant SaaS so its ids are very
  probably unique across teams — but if that assumption is ever wrong, team B's
  conversation silently resolves to team A's existing row and the webhook
  reports success. Cheap guard: once `jelly_team_id` exists on the table, assert
  it matches before reusing an existing row, and fail loudly if not. Same
  argument for `jelly_message.id`, `comment.id` and `jelly_contact.id`.

## 3. The design

### 3.1 Resolve the team once, in the context

The request already produces exactly one of three contexts. Each resolves one
team, and every handler reads `context.team` instead of `env.JELLY_TEAM_ID`.
That is what makes this a deletion rather than a 55-site find-and-replace with a
different global.

| Context | How the team is resolved                  | API surface change                         |
| ------- | ----------------------------------------- | ------------------------------------------ |
| API key | `api_key.jellyTeamId`, already on the row | **none**                                   |
| Webhook | path segment: `/api/webhook/jelly/{slug}` | new path, old one aliased during migration |
| Session | path prefix `/t/{slug}/…` on the web app  | web only                                   |

The important consequence: **the public API does not change at all.** The key is
the tenant selector, so every existing integration keeps working and no path
gains a team segment. Only the session-authenticated web UI needs a team picker.

Shape:

```ts
export type TeamContext = {
  team: {
    id: string; // Jelly's team id
    slug: string; // URL-safe handle
    name: string;
    dailyCeiling: number;
  };
};
```

`createApiKeyContext` already loads the key row; add a join to `jelly_team`.
`createAuthContext` resolves from the path segment and verifies the user has a
`jelly_contact` row in that team. `createJellyWebhookContext` resolves from the
slug _first_, then verifies the HMAC against that team's stored secret — the
order matters, because the secret is per-team.

Then delete `JELLY_TEAM_ID` from `packages/env/src/server.ts`. Leaving it as a
"default team" fallback is tempting and should be resisted past the migration
window: a fallback is a silent cross-tenant write waiting for the one code path
that forgot to pass a team.

### 3.2 Credentials live in `jelly_team`

```ts
export const jellyTeam = pgTable("jelly_team", {
  id: text("id").primaryKey(), // Jelly's team id
  slug: text("slug").notNull().unique(), // URL handle
  name: text("name").notNull(),
  apiBaseUrl: text("api_base_url")
    .notNull()
    .default("https://app.letsjelly.com"),
  apiTokenEncrypted: text("api_token_encrypted").notNull(),
  webhookSecretEncrypted: text("webhook_secret_encrypted"),
  dailyCeiling: integer("daily_ceiling").notNull().default(80_000),
  active: boolean("active").notNull().default(true),
  onboardedAt: timestamp("onboarded_at"),
  firstWebhookAt: timestamp("first_webhook_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

Encryption: AES-256-GCM via node `crypto`, key from a single
`MARMALADE_ENCRYPTION_KEY` env var, ciphertext stored as
`v1:<iv>:<tag>:<payload>` so the scheme is versioned and rotatable. No KMS
dependency; the threat being addressed is a leaked database dump, not a
compromised host.

`getJellyClient()` becomes `getJellyClient(teamId)` with a small per-team cache
keyed on team id and credential version. Three call sites to update.

### 3.3 Row-level security as the backstop

Adding `jelly_team_id` columns is necessary but not sufficient: it leaves ~55
places where a missing `where` is a cross-tenant leak, and section 0 is evidence
that this codebase does miss them. Correctness should not depend on every future
handler remembering.

Postgres RLS makes the database enforce it, and drizzle 0.45.2 already supports
declaring it in the schema — `pgPolicy()` and `.enableRLS()` are both present and
drizzle-kit emits the DDL.

```ts
export const conversation = pgTable("jelly_conversation", {/* … */}, (t) => [
  pgPolicy("conversation_team_isolation", {
    for: "all",
    using: sql`${t.jellyTeamId} = current_setting('app.team_id', true)`,
    withCheck: sql`${t.jellyTeamId} = current_setting('app.team_id', true)`,
  }),
]).enableRLS();
```

Every request runs its queries inside a transaction that sets the GUC:

```ts
export function withTeam<T>(teamId: string, fn: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    // SET LOCAL, never SET: the value must die with the transaction, or a
    // pooled connection carries one tenant's id into the next tenant's query.
    await tx.execute(sql`set local app.team_id = ${teamId}`);
    return fn(tx);
  });
}
```

Honest costs:

- Every tenant-scoped query must run inside `withTeam`. That is a real
  refactor of the handlers, though a mechanical one, and it gives each handler a
  `tx` it must use instead of the ambient `db` — which is itself the forcing
  function that makes forgetting impossible rather than merely discouraged.
- The connection must not be a superuser or the table owner, or policies are
  bypassed. Needs a dedicated application role plus `FORCE ROW LEVEL SECURITY`.
- Cross-team work — the drain worker, instance-operator dashboards, the
  onboarding flow — needs a privileged path. Give it a second role and an
  explicit `withAllTeams()` helper, so privilege escalation is a visible call
  rather than an absent `where`.

Recommendation: do it, and sequence it last, after the explicit `where` clauses
are in place. Defence in depth, with RLS catching what review misses. If RLS is
judged too heavy, the fallback is a `scopedDb(teamId)` wrapper plus a lint rule
banning bare `db` imports in routers — weaker, but the same shape.

### 3.4 Quota: per-team, plus one genuinely shared limit

Jelly publishes two limits, and they do not scale the same way:

- **100,000 requests per day, per team.** Already modelled correctly as
  `scope='team'`. Each new team brings its own budget. Move
  `TEAM_DAILY_CEILING` out of `packages/api/src/lib/quota.ts` and onto
  `jelly_team.dailyCeiling`.
- **5,000 requests per 5 minutes, per IP.** This one is _shared across every
  team on the deployment_, because they all egress from the same address. The
  current five-minute bucket is keyed `scope='team'`, which is wrong the moment
  there are two teams: ten teams at 4,000/5min each would sail past their own
  ceilings and collectively hit a 429 nobody's gauge predicted.

  Fix: keep the per-team five-minute bucket as a fairness ceiling, and add a
  `scope='instance'` bucket checked on every outbound call. The circuit breaker
  needs the same treatment — a 429 on the per-IP limit must pause _all_ teams,
  so `recordCircuitFailure` writes to the instance scope when the limit that was
  hit is the IP one.

This is the main place where multi-team is not just plumbing.

### 3.5 Worker fairness

`drainActions` claims the oldest due actions globally. With several teams, one
team with a 10,000-action backlog starves everyone else, and the claimed batch
would span teams while `getJellyClient()` returns one client.

Change the drain to claim per team, round-robin, with a per-team cap per pass:

```sql
-- one claim per active team per pass, instead of one global ORDER BY
SELECT DISTINCT ON (jelly_team_id) ...
```

or simply iterate active teams and run the existing claim query with
`AND jelly_team_id = $1 LIMIT $perTeam`. The second is less clever and easier to
reason about; prefer it. Skip teams whose circuit is open, and stop the whole
pass when the instance-wide five-minute bucket is exhausted.

`worker_heartbeat` stays a single row for the drain process, but
`queueHealth()` should take a team id so each team's admin sees their own
oldest-pending age.

### 3.6 Two tiers of admin

Today `teamAdminProtectedProcedure` means "admin or owner in the one Jelly team".
Multi-team needs a second, higher tier that has no Jelly equivalent:

- **Team admin** — admin/owner in their own `jelly_contact` row. Sees their
  team's health, usage, queue and audit. Everything in Plan 2, scoped.
- **Instance operator** — Marmalade-level. Onboards teams, holds credentials,
  sees cross-team health, can impersonate. Cannot be derived from a Jelly role
  because it is a fact about Marmalade, not about any team.

Better Auth's `admin` plugin provides exactly this (`user.role`, ban,
impersonation), and the README already lists bans and impersonation as wanted.
Using it means instance operators are not another bespoke table.

Split `routers/admin.ts` accordingly: the per-team views move behind team admin,
and a new `routers/instance.ts` holds onboarding, credential management and the
cross-team fleet view.

### 3.7 Onboarding is the scaling test

Adding a team should be a form, not a deploy:

1. Operator submits slug, display name and a Jelly API token.
2. Marmalade calls `GET /api/members` with the token. This validates it and, on
   success, confirms the team is reachable. Reject on 401 before storing
   anything.
3. Marmalade generates a webhook secret and shows the operator the endpoint
   `https://<host>/api/webhook/jelly/<slug>` plus the secret to paste into
   Jelly's Settings → Integrations.
4. First sync runs for that team only: mailboxes, members, contacts.
5. The team's health page shows "waiting for first webhook" until
   `firstWebhookAt` is set, so a misconfigured integration is visible at
   onboarding rather than discovered weeks later as a stale mirror.

### 3.8 Registration-time sync does not scale

`apps/web/src/lib/auth.ts` resyncs the team and all mailboxes in a Better Auth
`account.create.after` hook. With N teams that becomes N full member-list
fetches on every signup, against a shared rate limit, on the critical path of a
login.

Replace with: on signup, look the user's email up across existing
`jelly_contact` rows and attach them to whatever teams already know them; leave
discovery of _new_ contacts to the scheduled per-team resync that the README
already wants. A signup should cost zero Jelly requests.

## 4. Schema changes

```
jelly_team            + slug, name, api_base_url, api_token_encrypted,
                        webhook_secret_encrypted, daily_ceiling, active,
                        onboarded_at, first_webhook_at
jelly_contact         email .unique() -> unique(email, jelly_team_id)
mailbox               + unique(jelly_mailbox_id, jelly_team_id)   [bug fix]
jelly_conversation            + jelly_team_id
jelly_message                 + jelly_team_id
comment                       + jelly_team_id
jelly_label                   + jelly_team_id, unique(label_id, jelly_team_id)
jelly_conversation_label      + jelly_team_id
jelly_conversation_assignment + jelly_team_id
jelly_message_contact         + jelly_team_id
jelly_message_attachment      + jelly_team_id
mailbox_member                + jelly_team_id
jelly_request_log             + jelly_team_id
jelly_webhook_delivery        + jelly_team_id
```

Then an index on `jelly_team_id` for each, and RLS policies on all of the above
plus the nine tables that already carry the column.

Denormalising `jelly_team_id` onto child tables such as `jelly_message_contact`
is deliberate. It could be reached through a join, but RLS policies that join
are slow and awkward, and the column is what lets the policy be a single
equality test.

## 5. Sequence

| Step | Change                                                                        | Why here                                                            |
| ---- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1    | Enforce `requireMailboxAccess` on every read route                            | Live authorisation bug; also the boundary everything else assumes   |
| 2    | `mailbox` unique constraint; team-id assertion on webhook upserts             | Small correctness fixes, independent                                |
| 3    | `jelly_team` credential columns + encryption helper; `getJellyClient(teamId)` | No behaviour change — backfill the one existing team from env       |
| 4    | Team on the context; replace all 55 `env.JELLY_TEAM_ID` reads                 | Still one team, so this is pure refactor and verifiable by diff     |
| 5    | `jelly_team_id` on content tables, backfilled, then NOT NULL                  | Mechanical; safe while one team exists                              |
| 6    | `jelly_contact` composite unique                                              | Needs step 5's backfill to be meaningful                            |
| 7    | Instance-scope five-minute quota bucket + shared circuit breaker              | Correctness, needed before a second team exists                     |
| 8    | Per-team webhook endpoint `/api/webhook/jelly/{slug}`, old path aliased       | First externally visible change                                     |
| 9    | Per-team worker fairness                                                      | Only matters with two teams, but must precede onboarding the second |
| 10   | Instance-operator tier + onboarding flow                                      | Now a team can be added without a deploy                            |
| 11   | Web `/t/{slug}` prefix + team switcher                                        | Session UX                                                          |
| 12   | RLS policies, app role, `withTeam()`                                          | Last: backstop over code that is already correct                    |
| 13   | Delete `JELLY_TEAM_ID` and the single-team env credentials                    | The migration is over                                               |

Steps 1–7 are all shippable while there is still exactly one team, which means
most of this lands with no cutover risk.

## 6. Open questions

1. **Are Jelly resource ids globally unique across teams?** The whole plan keeps
   Jelly's ids as primary keys. If they are only unique per team, conversations,
   messages, comments and contacts all need surrogate keys, which is a much
   larger change. Worth asking Jelly directly, and worth adding the loud
   assertion in step 2 either way.
2. **Does a Jelly API token's scope tell us its team?** Onboarding assumes
   `GET /api/members` identifies the team. If no endpoint returns the team's own
   id, the operator has to supply it by hand and a typo misroutes a whole team's
   data. Check whether `/api/statistics` or a `/api/team` endpoint exists.
3. **Is the 5,000/5min limit really per source IP?** The docs say so. If
   Marmalade runs on Vercel with rotating egress IPs, the shared bucket is
   pessimistic rather than wrong — but the real constraint should be measured
   before tuning ceilings around it.
4. **Do teams need to share anything?** This plan assumes hard isolation. If
   Hack Club wants one person to see several teams in one view, the UI needs a
   cross-team mode, which RLS makes deliberately awkward. Worth settling before
   step 12.
