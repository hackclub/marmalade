# Plan 1 — Write API actions

## Goal

Let a permissioned Marmalade API key perform mutating Jelly operations, without
letting any key exhaust the team's shared Jelly quota, lose a write to a transient
failure, or perform a write nobody can later account for.

## Why a queue instead of a proxy

The obvious implementation is: validate the key, forward the call to Jelly, return the
response. That fails four of the stated requirements at once.

1. **Retry.** A `429` or a `503` from Jelly on a forwarded call has nowhere to live. The
   client sees an error and the write is lost. Deferring a write requires durable state.
2. **Quota.** Jelly allows 100,000 requests per day per team (midnight UTC reset) and
   5,000 per 5 minutes per IP, both returning `429` with `Retry-After`. That budget is
   shared across every Marmalade key, the sync jobs, and anything else the team runs.
   Fair allocation requires a single chokepoint that sees every outbound call.
3. **Audit.** The README's stated goal is "fully audit-trailed". A forwarded call leaves
   an audit row saying an attempt happened; a queued action row *is* the request body,
   the response, the attempt history, and the actor, in one place.
4. **Mirror coherence.** Marmalade's reads come from Postgres. A write that succeeds in
   Jelly but never updates the mirror produces a client that shows stale data
   immediately after its own successful mutation.

So: **every write becomes a durable `jelly_action` row.** Execution is a separate
concern from acceptance.

## Data model

Four new tables in `packages/db/src/schema/`, plus scope rows reusing the existing
`api_key_scope` table.

### `jelly_action` — the outbox (`schema/action.ts`)

| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK | ULID, so ordering is lexicographic |
| `idempotency_key` | `text` | unique with `api_key_id`; see Idempotency |
| `jelly_team_id` | `text` FK | |
| `jelly_mailbox_id` | `text` | quota + permission scope; nullable for team-level actions |
| `action_type` | `text` | `conversation.archive`, `comment.create`, … |
| `target_resource_type` | `text` | `conversation`, `message`, `label`, `contact` |
| `target_resource_id` | `text` | nullable for create actions |
| `payload` | `jsonb` | validated request body, exactly as it will be sent |
| `status` | `text` | `pending` → `scheduled` → `in_flight` → `succeeded` \| `failed` \| `dead` \| `cancelled` |
| `actor_type` | `text` | `api_key` \| `user` \| `system` |
| `api_key_id` | `int` FK | nullable |
| `user_id` | `text` FK | nullable |
| `attempts` / `max_attempts` | `int` | |
| `scheduled_for` | `timestamp` | future-dated actions; defaults to now |
| `next_attempt_at` | `timestamp` | backoff target |
| `locked_at` / `locked_by` | `timestamp` / `text` | worker lease |
| `last_error` | `jsonb` | `{ status, code, message, retryAfter }` |
| `jelly_response` | `jsonb` | response body on success |
| `jelly_resource_id` | `text` | id Jelly assigned to a created resource |
| `created_at` / `updated_at` / `completed_at` | `timestamp` | |

Indexes: `(status, next_attempt_at)` for the drain query, `(jelly_mailbox_id, created_at)`,
`(api_key_id, created_at)`, `(action_type, status)`, unique `(api_key_id, idempotency_key)`.

### `jelly_request_log` — every outbound HTTP call (`schema/observability.ts`)

Closes the existing README todo ("for now, simply track every jelly request in db and
monitor success/fail"). Logs **reads too**, not just actions — sync jobs consume the
same quota.

Columns: `id`, `action_id` (nullable), `method`, `path` (templated, e.g.
`/conversations/:id/archive`, so it groups), `status_code`, `duration_ms`,
`retry_after_seconds`, `error`, `actor_type`, `api_key_id`, `user_id`, `created_at`.
Indexes on `created_at`, `(status_code, created_at)`, `(path, created_at)`.

This table grows fast. Add a retention job (Plan 1, phase 7) that rolls rows older than
30 days into `usage_rollup` and deletes them.

### `jelly_quota_bucket` — rolling counters

`(scope, scope_id, window, window_start)` unique, plus `count`. `scope` is one of
`team`, `mailbox`, `api_key`, `user`. `window` is one of `five_minute`, `day`. Counters
are incremented with an upsert (`ON CONFLICT DO UPDATE SET count = count + 1`) in the
same transaction that marks an action `in_flight`, so a crash between the increment and
the HTTP call over-counts rather than under-counts. Over-counting is the safe direction.

The `team`/`day` and `team`/`five_minute` buckets model Jelly's published limits. The
`api_key` and `mailbox` buckets are Marmalade's own allocation policy, so one noisy key
cannot eat the team's budget.

### `usage_rollup` — hourly aggregates

`(bucket_hour, scope, scope_id, action_type, status)` with `count`, `p50_ms`, `p95_ms`,
`error_count`. Dashboards read this; they must never scan `jelly_request_log` directly.

### Write scopes — reuse `api_key_scope`

No schema change needed. Add rows with `scope_resource_type = 'action'` and
`scope_resource_id` set to an action type (`conversation.archive`) or a wildcard family
(`conversation.*`, `*`). `createApiKeyContext` in `packages/api/src/context.ts` already
aggregates scope rows; add an `actionScopes: string[]` field alongside `mailboxIds` and
`resourceScopes`.

> **Fail closed.** `filterFieldsByScope` currently treats "no field scopes configured"
> as "allow every field". Do **not** copy that default for action scopes. An empty
> `actionScopes` array must mean *no writes permitted*. A read-only key that silently
> gains write access because nobody configured it is the worst failure this system can
> have.

Also add `writes_enabled boolean not null default false` to the `mailbox`
(`marmaladeMailbox`) table. Per the README's "everything opt-in" goal, a mailbox admin
must turn writes on for that mailbox before any key can write to it, independently of
what scopes a key holds. Two independent switches, both required.

## Action catalogue and feature parity

Jelly's documented mutating surface, mapped to Marmalade action types. `Idem` marks
operations Jelly documents as idempotent.

| Action type | Jelly call | Idem | Wave |
|---|---|---|---|
| `conversation.archive` / `.unarchive` | `POST`/`DELETE /conversations/:id/archive` | yes | 1 |
| `conversation.trash` / `.restore` | `POST`/`DELETE /conversations/:id/trash` | yes | 2 |
| `conversation.spam` / `.unspam` | `POST`/`DELETE /conversations/:id/spam` | yes | 2 |
| `conversation.snooze` / `.unsnooze` | `POST`/`DELETE /conversations/:id/snooze` | yes | 2 |
| `conversation.ignore` | `POST /conversations/:id/ignore` | yes | 2 |
| `conversation.set_mailboxes` | `PATCH /conversations/:id/mailboxes` | yes | 2 |
| `conversation.assign` / `.unassign` | `POST`/`DELETE /conversations/:id/assignments[/:member_id]` | yes | 1 |
| `conversation.label_apply` / `.label_remove` | `POST`/`DELETE /conversations/:id/labels[/:id]` | yes | 1 |
| `comment.create` | `POST /conversations/:id/comments` | **no** | 1 |
| `label.create` / `.update` / `.delete` | `POST`/`PATCH`/`DELETE /labels[/:id]` | no | 2 |
| `draft_conversation.create` | `POST /draft_conversations` | **no** | 3 |
| `draft_reply.create` | `POST /conversations/:id/draft_reply` | quasi | 3 |
| `draft.update` | `PATCH /messages/:id` | yes | 3 |
| `contact.upsert` | `POST /contacts` | yes | 2 |
| `autoresponder.update` | `PATCH /autoresponder` | yes | 2 |

### Read parity gaps to close alongside

Marmalade's mirror does not yet cover several documented read surfaces. These are
needed by the Plan 3 demo apps and are cheap next to the write work:

- `GET /conversations/search?q=` — cannot be mirrored meaningfully; **proxy live** to
  Jelly through the same rate-limited client, with results filtered by mailbox scope.
- `GET /labels`, `GET /saved_replies`, `GET /contacts/for_email` — mirror on a schedule.
- `GET /statistics?period=` — proxy live, admin-scoped.
- `GET /conversations/:id?timeline=true` — merged messages + comments; buildable from
  the existing mirror without a Jelly call.
- `GET /conversations/:id.markdown` — buildable from the mirror.
- `GET /attachments/:id` — proxy the `302`; never hand a client a raw Jelly URL, since
  Jelly deliberately requires token auth for download links to preserve auditability.

## Request lifecycle

```
client                marmalade                          jelly
  |  POST .../archive     |                                 |
  |  Idempotency-Key: k   |                                 |
  |---------------------->| 1. authenticate key             |
  |                       | 2. action scope? mailbox scope? |
  |                       |    mailbox writes_enabled?      |
  |                       | 3. dedupe on (key, k)           |
  |                       | 4. quota precheck               |
  |                       | 5. INSERT jelly_action pending  |
  |                       | 6. audit log: accepted          |
  |                       | 7. inline dispatch attempt ---->|
  |                       |                            200  |
  |                       | 8. apply to mirror              |
  |<-- 200 + action id ---| 9. log request                  |
```

If step 7 does not resolve within the inline budget (default 4s) or returns a retryable
error, Marmalade responds **`202 Accepted`** with the action id and a
`GET /actions/{id}` poll URL, and the worker takes over. Clients that want strict
fire-and-forget can pass `?async=true` to skip inline dispatch entirely.

This hybrid matters for the demo apps: a person pressing "Archive" wants to see it
archived, not to poll. Inline-first gives synchronous semantics in the common case
while keeping durability in the uncommon one.

## Idempotency

Three layers, because Jelly offers none of its own (`Idempotency-Key` is not documented).

1. **Client-supplied.** Honour an `Idempotency-Key` request header. Store it on the
   action, unique per `api_key_id`. A replay returns the original action row and its
   terminal state rather than enqueuing a second action. This is the only reliable
   protection for `comment.create` and `draft_conversation.create`.
2. **Auto-derived.** When the header is absent, derive a key from
   `sha256(actor, action_type, target_id, canonical(payload))` and treat it as unique
   within a 60-second window. This absorbs double-taps and retrying clients without
   rejecting legitimate repeats (e.g. two genuinely different comments).
3. **Unknown-outcome recovery.** If an attempt times out, Marmalade does not know
   whether Jelly applied it. For idempotent action types, just retry. For
   non-idempotent ones, **do not blind-retry.** Instead move the action to
   `status = pending` with a `reconcile` flag; the worker first re-reads the target
   (`GET /conversations/:id/comments`, `GET /conversations/:id`) and looks for a
   resource matching the payload before deciding to retry or mark succeeded. This costs
   one extra read per ambiguous attempt and is what stops duplicate internal comments.

`POST /conversations/:id/draft_reply` deserves a note: Jelly documents that when a draft
already exists it returns **the existing draft with status `409`**. That is a success,
not a failure. The error taxonomy below treats it as one.

## Failure taxonomy and retry policy

| Jelly response | Classification | Action |
|---|---|---|
| `2xx` | success | apply to mirror, mark `succeeded` |
| `409` on `draft_reply` | success | store returned draft, mark `succeeded` |
| `409` otherwise | conflict | terminal `failed`, surface body to client |
| `429` | throttled | honour `Retry-After` exactly; trip the circuit breaker for that bucket; does **not** count against `attempts` |
| `423` draft locked | contended | retry on a long backoff (1m, 5m, 15m), cap at 4 attempts, then `failed` with a clear "a teammate is editing this draft" message |
| `5xx`, network error, timeout | transient | exponential backoff with full jitter: 1s, 4s, 15s, 1m, 5m, 30m, 2h; `max_attempts = 8` |
| `422`, `400` | invalid | terminal `failed`, no retry, return the validation body |
| `401` | credential failure | terminal `dead`, halt the worker, alert admins — the team token is broken and every subsequent action will fail the same way |
| `404` | missing | if the target was created by Marmalade in the last 30s, retry twice for eventual consistency; otherwise terminal `failed` |

A `429` must not burn retry budget. Throttling means "not yet", not "this is going
wrong", and conflating them turns a busy hour into a pile of dead letters.

**Circuit breaker.** Track consecutive failures per bucket in memory *and* in
`jelly_quota_bucket`, since serverless instances do not share memory. On a `429` or five
consecutive `5xx`, set a `paused_until` timestamp on the team bucket; the drain query
skips buckets that are paused. This prevents a stampede of workers from converting one
`429` into a thousand.

## Quota governance

Before dispatch, check, in order:

1. `team`/`day` bucket against a configured ceiling below Jelly's 100,000 — start at
   80,000 to leave headroom for sync and manual use.
2. `team`/`five_minute` bucket against a ceiling below 5,000.
3. `api_key`/`day` bucket against that key's `max_actions_per_day`.
4. `mailbox`/`day` bucket against the mailbox's ceiling.

A failed precheck does not error the client. It sets `next_attempt_at` to the bucket's
reset time and returns `202` — the action is *scheduled*, which is exactly the "send
later" behaviour requested. The response includes `Retry-After` and the reason, so a
client can show "queued, quota resets in 12 minutes".

Reserve a slice of the daily budget for interactive traffic. A reasonable split: 60%
for queued/background actions, 30% for interactive reads, 10% held in reserve and never
spent by the worker. Otherwise a large backlog drain starves the demo apps.

## The worker

The drain loop is a single function, `drainActions(limit)`:

```sql
UPDATE jelly_action SET status = 'in_flight', locked_at = now(), locked_by = $worker
WHERE id IN (
  SELECT id FROM jelly_action
  WHERE status IN ('pending','scheduled')
    AND next_attempt_at <= now()
    AND scheduled_for <= now()
  ORDER BY next_attempt_at
  FOR UPDATE SKIP LOCKED
  LIMIT $limit
)
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` is what makes concurrent workers safe without a separate lock
service. A reaper pass releases actions whose `locked_at` is older than the lease
(2 minutes) back to `pending`, covering crashed workers.

**Runtime.** Marmalade is on Vercel, which has no always-on process. Three options:

- **Vercel Cron** hitting an internal `POST /api/internal/drain` once a minute, plus
  `waitUntil()` inline dispatch after the response. Minute granularity is the floor, so
  a queued action waits up to 60s. Acceptable, since queuing is the exception path.
- **Vercel Queues / QStash** for sub-second dispatch, at the cost of another dependency.
- **A small always-on node** running `pnpm --filter worker start`. The README already
  contemplated Nest with Cloudflare tunnels.

Recommendation: build `drainActions` as a plain exported function in a new
`packages/worker`, call it from a Vercel Cron route *and* from `waitUntil()`. That keeps
the migration to an always-on host a deployment change rather than a rewrite.

## Mirror write-back

On success, update Postgres immediately from the Jelly response — most conversation
actions return the updated conversation, so no extra read is needed. Then let the
webhook, when one exists, reconcile.

Note which actions have **no** webhook: Jelly only emits `new_message`, `assigned`,
`comment_added`, `conversation_archived`, and `conversation_unarchived`. Labels, trash,
spam, snooze, mailbox reassignment, contacts, and autoresponder changes will *never*
arrive by webhook. For those, the response-derived write-back is the only path, and a
periodic reconciliation sweep (compare mirror against `GET /conversations` for recently
touched threads) is the only backstop. Budget for that sweep in the quota split.

## Admin observability

Four surfaces under `apps/web/src/routes/_auth/admin/`, all served from `usage_rollup`
and `jelly_action` aggregates, never from raw logs.

### `/admin/health` — is the service working right now

- Worker heartbeat: last successful drain, and an alert if older than 5 minutes.
- Queue depth by status, and **oldest pending action age** — the single most useful
  number; if it climbs, something is wrong regardless of what else looks fine.
- In-flight count and count of leases reaped (a rising reaper count means crashes).
- Dead-letter count, with a one-click filtered link to `/admin/actions`.
- Circuit breaker state per bucket and `paused_until`.
- Jelly quota gauges: today's team usage against 80,000, current 5-minute window
  against its ceiling, and time to reset.
- **Webhook health**: last received event per event type, and consecutive delivery
  failures. Jelly deactivates a webhook after 10 consecutive failures in 24 hours and
  does **not retry**, so alert at 3. A silently deactivated webhook is the failure mode
  most likely to go unnoticed, because reads keep working from a mirror that quietly
  stops updating. Add a staleness check too: if no webhook of any type has arrived in
  N hours during business hours, warn.

### `/admin/usage` — who is spending what

Time-bucketed (1h / 24h / 7d / 30d), grouped by API key, by user, by mailbox, and by
action type: request count, action count, success rate, error rate by class
(`4xx` vs `429` vs `5xx`), p50/p95 Jelly latency, and quota headroom remaining. A
sortable "top consumers" table answers "who is about to get us rate-limited".

### `/admin/actions` — the queue browser

Filter by status, actor, action type, mailbox, and time range. Each row expands to the
payload, the attempt history, the last error, and the Jelly response. Operations:
retry now, cancel (only from `pending`/`scheduled`), force-fail, and bulk requeue of
dead letters. Every one of those operations is itself audit-logged with the admin's
user id — an admin retrying a stranger's action is exactly the event an audit trail
exists for.

### `/admin/audit` — extend the existing log

The current `auditRouter.list` returns the whole table unpaginated and
`teamAdminProtectedProcedure` is applied but the route is not registered in
`appRouter`. Fix both: register it, paginate it, filter it, and satisfy the README's
"more thoroughly audit log request attempts regardless of status" by logging
*rejections* — a write refused for missing scope is more interesting than one allowed.

### Alerting

Thresholds fire through the already-configured Loops transactional API, and optionally
Slack: worker stalled, dead letters above N, daily quota above 80% used, webhook
consecutive failures at 3, `401` from Jelly, oldest pending action older than 15
minutes.

## Security notes

Writes raise the blast radius of a leaked key from "read a mailbox" to "mutate a
mailbox". The README's open items become load-bearing:

- **Standardized key prefix and `revoke.hackclub.com` integration.** `revokePublic`
  already exists; finish the prefix standardisation so scanners can detect a leaked
  `mrmld_` key. Do this *before* enabling write scopes, not after.
- **`createApiKeyContext` writes `lastUsedAt` on every authenticated request**, an
  unconditional `UPDATE` per call. Under write traffic that is a hot row per key.
  Debounce to at most once a minute, or move it to the request log rollup.
- **Per-key write ceilings and an approval mode.** A newly created key with send-ish
  scopes (`comment.create`, `draft_*`) should start in a mode where its actions land in
  `pending` for admin approval, until an admin promotes it. Cheap to add, since approval
  is just a status the drain query skips.
- **`dryRun`.** Accept `?dryRun=true` on every write endpoint: validate, check scopes
  and quota, return the exact payload that *would* be sent, enqueue nothing. Makes the
  permission model testable by its users.
- **Admins must not mutate owners** (existing README item) — enforce in the write path
  too, not only in team management.

## Phasing

| Phase | Deliverable | Gate |
|---|---|---|
| 1 | Hardened `JellyApiClient`: timeouts, `Retry-After` handling, exponential backoff, circuit breaker, `jelly_request_log` on every call including existing reads | No user-facing change; closes an existing README todo and makes current sync observable |
| 2 | `jelly_action` + `jelly_quota_bucket` + `drainActions` + inline dispatch + idempotency, with exactly one action type: `conversation.archive` | End-to-end proof on the lowest-risk, idempotent, webhook-reconciled action |
| 3 | Action scopes on keys, mailbox `writes_enabled`, per-key ceilings, `dryRun`, and the UI to grant all of it | Permission model complete before the surface widens |
| 4 | Parity wave 1: unarchive, assign/unassign, label apply/remove, `comment.create` | First non-idempotent action (`comment.create`) exercises unknown-outcome recovery |
| 5 | Parity wave 2: trash, spam, snooze, ignore, set_mailboxes, label CRUD, contact upsert, autoresponder | Also adds the reconciliation sweep, since none of these emit webhooks |
| 6 | Parity wave 3: `draft_conversation.create`, `draft_reply.create`, `draft.update`, incl. `409`-as-success and `423` handling | The drafting path the demo apps need |
| 7 | Read parity: search proxy, labels, saved replies, contacts, statistics, timeline, markdown, attachment proxy; log retention + `usage_rollup` job | Plan 3 unblocked |
| 8 | Admin health / usage / actions / audit surfaces + alerting | Operable by someone who did not build it |
| 9 | `scheduled_for` as a first-class feature: schedule an action, list scheduled, cancel before dispatch | The "do it later" story, now deliberate rather than incidental |

## Open questions to resolve against the live API

The public docs do not settle these, and each changes an implementation detail:

1. Does Jelly return `X-RateLimit-*` headers? Only `Retry-After` is documented. If the
   remaining-quota headers exist, prefer them over Marmalade's own counters, which can
   only ever be an estimate of a budget shared with other consumers.
2. Are `POST /conversations/:id/labels` and the assignment endpoints truly idempotent on
   repeat, or do they 409? The docs say idempotent; verify before relying on it for
   retry classification.
3. What exactly does `PATCH /messages/:id` return on `423`, and does it include who holds
   the lock? That determines how good the error message can be.
4. Is there any undocumented send capability on the Royal Jelly plan? Worth asking Jelly
   directly, since it is the single biggest constraint on the demo apps.
