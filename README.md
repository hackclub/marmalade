# marmalade

🍊 is a permissionful api access layer for jelly

## goals

- simple to use
- everything opt-in
- least-permissioned and fully audit-trailed
- no slopcoding

## tasks

**key:** ‼️ = mvp-critical

- [ ] jelly sync
  - [x] ‼️ manually sync mailboxes and team members
  - [ ] routinely resync mailboxes and team members
  - [x] resync mailboxes and team members on registration
  - [ ] ‼️ sync through jelly webhook
    - [ ] markdown
    - [x] new_message
    - [ ] assigned
    - [x] comment_added
    - [ ] conversation_archived
    - [ ] conversation_unarchived
- [ ] mailboxes
  - [ ] admin actions
    - [x] ‼️ create marmalade mailbox for jelly mailbox
    - [x] de/re-activate marmalade mailboxes
    - [ ] view all mailboxes regardless of membership (toggle)
  - [ ] member actions
    - [ ] request marmalade mailbox created for jelly mailbox
- [ ] mailbox members
  - [ ] admin actions
    - [x] ‼️ create marmalade mailbox member for jelly mailbox member
    - [x] grant/rescind api perms (symbolically) for marmalade mailbox members
  - [ ] member actions
    - [ ] request own/other member access to be granted
- [ ] keys
  - [ ] admin actions
    - [ ] view all keys regardless of ownership (toggle)
  - [ ] member actions
    - [ ] view all apikeys in permissioned mailboxes
    - [ ] ‼️ create api keys
    - [ ] rescind api keys
- [ ] convos
- [ ] messages
- [ ] comments
- [ ] attachments
- [ ] security/access
  - [x] ‼️ hack club oidc auth
    - [ ] + email/password auth?
  - [x] ‼️ basic audit logging
    - [ ] audit changelogs (e.g. deletion archives & update diffs)
  - [ ] ‼️ orpc openapi setup!
    - [ ] permissions with keys
  - [ ] more throroughly audit log request attempts regardless of status
    - [ ] evlog for audit logs
  - [ ] ensure all admin routes are protected appropriately
  - [ ] admins should not be able to mutate owners
- [ ] plumbing
  - [ ] ensure uniqueness of relational tables and make references "official"
  - [ ] first time sync on registration and scheduled/manual org teammember resyncs
  - [ ] track jelly requests made and add builtin quotas to avoid ratelimits
    - [ ] for now, simply track every jelly request in db and monitor success/fail
  - [ ] indexes
  - [ ] host on nest w/ cf tunnels
  - [ ] CI
  - [ ] custom error pages
  - [ ] standardized key prefix (for [revokability](https://revoke.hackclub.com))

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
