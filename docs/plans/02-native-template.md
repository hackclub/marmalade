# Plan 2 — Bring the Better-T-Stack native app into the turborepo

## Situation

`bts.jsonc` records that this repo was scaffolded with Better-T-Stack 3.34.0 and that
the original command included a native frontend:

```
--frontend tanstack-start native-unistyles
```

but the recorded config is `"frontend": ["tanstack-start"]`, so `apps/native` was
removed at some point. Traces of it survive and are useful:

- `packages/env/src/native.ts` exists and expects `EXPO_PUBLIC_SERVER_URL`.
- `@better-auth/expo` is pinned in the pnpm catalog at `1.6.11`.
- `packages/auth` already registers the `expo()` plugin and trusts the origins
  `marmalade-v2://`, `exp://`, and `http://localhost:8081`.
- The root `package.json` already has `"dev:native": "turbo -F native dev"`.
- `pnpm-workspace.yaml` already globs `apps/*`.
- The README already says "Use the Expo Go app to run the mobile application."

So the wiring is largely in place and only the app itself is missing.

## The blocker: `add` cannot add a frontend

`create-better-t-stack add` supports `--addons` and `--package` only. Per the CLI
reference it has no flag for adding a frontend to an existing project, native or
otherwise. `pnpm dlx create-better-t-stack add --frontend native-unistyles` is not a
thing.

The workable approach is to **scaffold a throwaway project with the identical stack
plus the native frontend, and transplant `apps/native`**. Because the original
reproducible command is recorded verbatim in `bts.jsonc`, the throwaway can be made
byte-comparable to this repo everywhere except the new app, which makes the diff
trivial to review.

## Steps

### 1. Scaffold the donor

In a scratch directory, pin the same CLI version so the template matches what this repo
was built from:

```bash
pnpm create better-t-stack@3.34.0 marmalade-donor \
  --frontend tanstack-start native-unistyles \
  --backend self --runtime none \
  --database postgres --orm drizzle --api orpc \
  --auth better-auth --payments none \
  --addons turborepo --examples todo \
  --db-setup docker --web-deploy docker --server-deploy none \
  --package-manager pnpm --no-install --yes
```

Then `diff -r marmalade-donor/apps/web marmalade-v2/apps/web` to confirm the donor is
the same template this repo started from. Divergence there is expected (this repo has
moved on) but a *structural* divergence means the version pin is wrong and the native
app will not drop in cleanly either.

### 2. Transplant

Copy `marmalade-donor/apps/native` to `apps/native`. Then reconcile it with this repo's
conventions, which differ from a fresh scaffold in four ways:

- **Catalog versions.** The donor pins concrete versions in `apps/native/package.json`.
  This repo uses a pnpm catalog plus `overrides`. Move every dependency that already has
  a catalog entry to `"catalog:"`, and add new shared ones (`expo`, `react-native`,
  `expo-router`, `react-native-unistyles`) to the catalog so web and native cannot drift
  on React or Zod versions.
- **Workspace packages.** Point the app at `@marmalade-v2/api` (for `AppRouterClient`
  types), `@marmalade-v2/env`, and later `@marmalade-v2/client` from Plan 3. Drop the
  donor's local duplicates.
- **Auth client.** The donor generates its own Better Auth Expo client. Replace its
  `baseURL` with `env.EXPO_PUBLIC_SERVER_URL` from `packages/env/src/native.ts`, and
  confirm the scheme it registers matches the `marmalade-v2://` already in
  `trustedOrigins`.
- **Turbo tasks.** Add `dev`, `build`, `check-types`, and `lint` entries so
  `turbo -F native dev` (already scripted) resolves. Expo's dev server is persistent and
  uncacheable — mark it `"cache": false, "persistent": true` like the existing `dev`
  task.

### 3. Strip the example, keep the wiring

Delete the todo example screens. Keep exactly the parts that prove the stack works
end to end: the oRPC client setup, the TanStack Query provider, the auth flow, and one
screen that calls `healthCheck` and `membershipInfo`. That screen becomes the smoke
test for Plan 3.

### 4. Record it

Update `bts.jsonc` to `"frontend": ["tanstack-start", "native-unistyles"]` so a future
`add` run does not get confused about the project's shape, and update the README's task
list and dev instructions.

### 5. Verify

```bash
pnpm install
pnpm check-types          # must pass across the whole workspace
pnpm dev:native           # Metro starts, app connects to the web server
```

## Decision to make first: Unistyles or NativeWind

`native-unistyles` is what the original command chose, but **Unistyles 3 is a Nitro
module and requires a custom Expo dev client — it does not run in Expo Go.** The README
currently tells contributors to use Expo Go, and for a demo app whose whole point is
being easy for other people to run, an EAS build step is real friction.

Two options:

- **Keep `native-unistyles`.** Matches the recorded stack; better theming ergonomics;
  costs everyone a dev-client build and makes the README instruction wrong.
- **Switch to `native-uniwind` / NativeWind.** Runs in Expo Go; shares Tailwind class
  vocabulary with `packages/ui`, so the web and mobile demos in Plan 3 look and read
  alike, which is exactly the parity goal; diverges from `bts.jsonc`.

Recommendation: **NativeWind**, for Expo Go compatibility and Tailwind parity with the
existing web app. Update `bts.jsonc` to match reality rather than the other way round.
This is a genuine fork in the road, so it is worth a decision before step 1 — the
scaffold flag changes.

## Risks

- **Expo SDK versus React 19.2.** The web app is on React 19.2.6. The native app must
  land on an Expo SDK whose React Native version accepts that React. If the pinned BTS
  template predates it, expect to bump Expo and re-pin. Resolve before writing app code.
- **Overrides bleed.** `pnpm-workspace.yaml` has repo-wide `overrides` (`undici`,
  `hono`, `postcss`, …). Some are unnecessary for native and one of them forcing a
  version into the Metro dependency tree is the likeliest install-time failure. Scope
  overrides narrowly if it happens.
- **`minimumReleaseAgeExclude`.** The repo delays new releases; Expo ships frequently.
  Expect to add exclusions.
- **Better Auth Expo cookie handling.** The Expo plugin stores the session differently
  from the web cookie flow. Verify against the real deployed server, not just localhost,
  before building Plan 3 on top of it.
