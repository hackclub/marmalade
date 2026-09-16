# marmalade

🍊 is a permissionful api access layer for jelly

## goals

- simple to use
- everything opt-in
- finely-grained & least-privelidged api access
- fully audit-trailed

> note: write access runs through a durable action queue (`jelly_action`). every
> mutation is persisted before dispatch, retried on transient failure, and
> audited. jelly's api cannot send customer-facing email — api tokens may create
> drafts and internal comments only — so marmalade's "send" is "compose a draft a
> teammate finishes in jelly".

see [`docs/plans`](./docs/plans) for the design behind the write path, the admin
oversight work, and the mobile app.

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
  - [x] see all audit logs (paginated + filterable, rejections included)
  - [x] service health: worker, queue depth, quota gauges, webhook liveness
  - [x] usage by key/user/endpoint from hourly rollups
  - [x] action queue browser with retry/cancel/approve/force-fail
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
  - [x] more throroughly audit log request attempts regardless of status
    - [ ] evlog for audit logs
  - [ ] ensure all admin routes are protected appropriately
  - [ ] admins should not be able to mutate owners
  - [ ] standardized key prefix
    - [ ] [revokability](https://revoke.hackclub.com))
- [ ] write actions
  - [x] durable action outbox with idempotency, retry and backoff
  - [x] inline dispatch with queue fallback (202 + poll)
  - [x] action scopes on api keys (fail closed) + per-mailbox write opt-in
  - [x] feature parity with jelly's documented write surface
  - [x] scheduled actions + cancel before dispatch
  - [x] `dryRun` on every write
  - [x] per-key and per-mailbox write ceilings (`quota_policy`)
  - [x] admin queue browser and dead-letter requeue
  - [x] approval mode for keys that are not trusted yet
- [ ] plumbing
  - [x] ensure uniqueness of relational tables and make references "official"
  - [x] first time sync on registration and scheduled/manual org teammember resyncs
  - [x] track jelly requests made and add builtin quotas to avoid ratelimits
    - [x] for now, simply track every jelly request in db and monitor success/fail
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
