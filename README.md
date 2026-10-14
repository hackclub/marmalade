# marmalade

🍊 is a permissionful api access layer for jelly

## goals

- simple to use
- everything opt-in
- finely-grained & least-privelidged api access
- fully audit-trailed

> note: currently marmalade's api access is read-only, while write access (required for use cases such as fully-featured custom clients) is being worked on

## demonstration

https://github.com/user-attachments/assets/e429cb9e-7683-47f1-8c1f-77882715e129

## (interactive) api docs!

on your own instance or an instance where you have access, open the [docs](https://marmalade.hackclub.dev/docs) and play around with different endpoints.

<img width="2084" height="1476" alt="image" src="https://github.com/user-attachments/assets/84f334a0-53ca-41b1-86ee-35e16955be9a" />

## stuff that does stuff

- **TypeScript** - For type safety and improved developer experience
- **TanStack Start** - SSR framework with TanStack Router
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **oRPC** - End-to-end type-safe APIs with OpenAPI integration
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Turborepo** - Optimized monorepo build system

## development

First, install the dependencies:

```bash
pnpm install
```

### db

This project uses PostgreSQL with Drizzle ORM.

1. Make sure you have a PostgreSQL database set up.
2. Set `DATABASE_URL` in your environment or update your local `apps/web/.env` file with your PostgreSQL connection details.

3. Apply the schema to your database:

```bash
pnpm run db:push
```

`db:push` is how schema reaches a database here, including production — there
is no `drizzle.__drizzle_migrations` table. The files under
`packages/db/src/migrations` are generated for reference and for anyone who
prefers `db:migrate`; they are **not** the deploy path.

Two consequences worth knowing before adding schema:

- A `NOT NULL` column with no default makes `db:push` stop and ask for one,
  which fails a non-interactive deploy. Give it a default or make it nullable.
- Data changes written into a migration file never run. Put them in
  application code that is safe to run repeatedly — `team.resync` repairing
  `exists_in_jelly` is the pattern to copy.

Then, run the development server:

```bash
pnpm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the fullstack application.
Use the Expo Go app to run the mobile application.

### deployment

- Target: web + server
- Config: `docker-compose.yml` (app Dockerfiles live in `apps/*/Dockerfile`)
- Build images: pnpm run docker:build
- Start: pnpm run docker:up
- Logs: pnpm run docker:logs
- Stop: pnpm run docker:down

Environment variables are read from each app's `.env` file (baked into web builds for public variables) and overridden in `docker-compose.yml` for container networking.

### jelly credentials

Jelly API tokens and webhook signing secrets live in the `jelly_team` table,
encrypted with AES-256-GCM, rather than in the environment. Connecting a team is
a row, not a redeploy, and a token can be rotated without one.

`MARMALADE_ENCRYPTION_KEY` is required and protects those columns at rest:

```bash
openssl rand -base64 32
```

A missing key stops the process at boot. That is deliberate — the alternative
is a fallback that quietly stores Jelly tokens in plaintext.

An existing deployment needs no manual migration: if `JELLY_API_KEY` and
`JELLY_WEBHOOK_SECRET` are still set, they are encrypted into the team row the
first time Marmalade talks to Jelly, and both variables can then be removed.

After that, manage credentials through the admin API:

| Endpoint                          | Purpose                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `GET /admin/team`                 | whether credentials are present, and the webhook URL to give Jelly |
| `POST /admin/team/api-token`      | store a token (validated against Jelly before it is saved)         |
| `POST /admin/team/webhook-secret` | generate a secret, returned once                                   |
| `PUT /admin/team/webhook-secret`  | store the secret Jelly generated                                   |

No endpoint returns a stored secret.

## jelly rate limits

Jelly publishes two limits, and they do not scale the same way. The
difference matters as soon as a deployment serves more than one team.

| Limit                   | Scope             | What that means here                                                                      |
| ----------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| **100,000 per day**     | per **team**      | each connected team brings its own budget                                                 |
| **5,000 per 5 minutes** | per **source IP** | shared across every team on the deployment, because they all egress from the same address |

The daily ceiling lives on `jelly_team.daily_ceiling`, defaulting to 80,000 so
there is headroom for work Marmalade does not drive. Adding a team adds its
own 100,000; one team exhausting its budget does not pause another.

The five-minute limit is the one to watch. It is **not** per team, so ten
teams at 4,000 requests per 5 minutes each would stay under their own
ceilings and collectively hit a 429 that no per-team gauge predicted. A
deployment therefore needs an instance-wide five-minute bucket checked on
every outbound call, and a 429 on that limit has to pause every team rather
than the one that happened to trip it. That bucket is not implemented yet.

Worth measuring rather than assuming: on a host with rotating egress
addresses the per-IP limit is pessimistic rather than wrong, so ceilings
tuned around it should be checked against real numbers.

Marmalade is a read-through mirror, which is what keeps it well under both:
reads are served from Postgres and only sync and write actions reach Jelly.

## choosing a team

A request acts in exactly one Jelly team, resolved at the context boundary.

| Caller  | How the team is chosen                                                               |
| ------- | ------------------------------------------------------------------------------------ |
| API key | the team on the key row; override with `X-Marmalade-Team` if the key is granted more |
| Webhook | the endpoint, `/api/webhook/jelly/{slug}`                                            |
| Session | the navbar team switcher, which sets `X-Marmalade-Team` and a matching cookie        |

**Nothing about an existing integration changes.** A key names its team, so a
request that sends no header behaves exactly as it did before multi-team.

A key can be granted further teams at creation with `teamIds`, and then names
one per request:

```bash
curl https://<host>/api/rpc/mailboxes \
  -H "Authorization: Bearer mrmld_..." \
  -H "X-Marmalade-Team: haven"
```

A team the key was not granted is refused with 403 rather than silently
falling back to its own. A key cannot be granted reach its creator does not
have: a session can only grant teams it is a staff contact in, and a key
minting another key can only pass on teams it already holds.

Mailbox scopes are resolved against the active team, because a mailbox id is
unique within a team and not across teams. Two teams with a mailbox of the
same name do not share a scope.

## tasks

**key:** ‼️ = poc-critical

- [ ] jelly sync
  - [x] ‼️ manually sync mailboxes and team members
  - [ ] routinely resync mailboxes and team members
  - [x] resync mailboxes and team members on registration
  - [x] ‼️ sync through jelly webhook
    - [x] new_message
    - [x] assigned
    - [x] comment_added
    - [x] conversation_archived
    - [x] conversation_unarchived
- [ ] mailboxes
  - [ ] admin actions
    - [x] ‼️ create marmalade mailbox for jelly mailbox
    - [x] de/re-activate marmalade mailboxes
    - [x] view all mailboxes regardless of membership (toggle)
    - [ ] immune from member deletions
  - [ ] member actions
    - [ ] request marmalade mailbox created for jelly mailbox
- [ ] mailbox members
  - [ ] admin actions
    - [x] ‼️ create marmalade mailbox member for jelly mailbox member
    - [x] grant/rescind api perms for marmalade mailbox members
      - [x] mailbox-scoped perms
      - [ ] data-scoped perms
        - [ ] perm presets
          - [ ] metadata vs content
  - [ ] member actions
    - [ ] request own/other member access to be granted
- [ ] admin panel
  - [x] see all better auth users
    - [x] bans
    - [x] impersonation
  - [x] instance admins are separate from jelly team roles
  - [x] admin actions audited (incl. who impersonated whom)
  - [ ] see all audit logs
- [x] keys
  - [x] admin actions
    - [x] view all keys regardless of ownership (toggle)
  - [x] member actions
    - [x] view all apikeys in permissioned mailboxes
    - [x] view all their apikeys
    - [x] ‼️ create api keys
    - [x] rescind api keys
- [x] convos
- [x] conversation assignment
- [x] messages
- [x] comments
- [x] attachments
- [ ] labels
- [ ] security/access
  - [x] ‼️ hack club oidc auth
    - [x] + email OTP auth?
  - [x] ‼️ basic audit logging
    - [ ] audit changelogs (e.g. deletion archives & update diffs)
  - [x] ‼️ orpc openapi setup!
    - [x] permissions with keys
      - [x] mailbox-scoped keys
      - [x] data-scoped keys
        - [x] metadata
        - [x] content
  - [ ] more throroughly audit log request attempts regardless of status
    - [ ] evlog for audit logs
  - [ ] ensure all admin routes are protected appropriately
  - [ ] admins should not be able to mutate owners
  - [ ] standardized key prefix
    - [ ] [revokability](https://revoke.hackclub.com))
      - [x] `POST /revoke` checks the whole key, not just its printed prefix
  - [x] jelly credentials encrypted at rest in `jelly_team`, not in env
  - [x] rotate the jelly api token and webhook secret without a redeploy
  - [x] enforce mailbox scoping on conversation/message/comment reads
- [ ] plumbing
  - [x] ensure uniqueness of relational tables and make references "official"
  - [ ] multiple jelly teams
    - [x] credentials per team, encrypted
    - [x] `mailbox` and `jelly_contact` uniqueness fit for more than one team
    - [x] `jelly_team_id` on the content tables
    - [x] team resolved from the request instead of `JELLY_TEAM_ID`
    - [x] per-team webhook endpoints, `/api/webhook/jelly/{slug}`
    - [x] instance operators, separate from jelly team admins, who onboard teams
    - [x] team switcher for session users who belong to more than one team
    - [x] api keys can be granted more than one team and pick one per request
    - [ ] instance-wide 5-minute quota bucket (jelly rate-limits per IP, not per team)
    - [ ] per-team worker fairness in the action drain
    - [ ] row-level security
  - [x] first time sync on registration and scheduled/manual org teammember resyncs
  - [ ] track jelly requests made and add builtin quotas to avoid ratelimits
    - [ ] for now, simply track every jelly request in db and monitor success/fail
  - [ ] completely jelly-backwards-compatible api? (api v2)
  - [x] indexes
  - [x] ~~host on nest w/ cf tunnels~~ host on vercel
    - [ ] move to enterprise vercel
- qol
  - [ ] use better auth's apikey [system](https://better-auth.com/docs/plugins/api-key/advanced#rate-limiting) cause im a dumb dumb
  - [ ] custom error pages/toasts
  - [x] "unauthorized" redirects to /login
  - [ ] CI
  - [ ] store markdown in addition to html content?
- dx
  - [x] ~~swagger~~ scalar api docs
    - [x] documented output schemas
