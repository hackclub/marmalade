# Plan 3 — Demo clients: web and mobile

## What these are for

Two small email clients for Jelly that talk **only** to Marmalade, never to Jelly
directly. They exist to prove three claims the project makes about itself:

1. A finely-grained, least-privileged key is enough to build a real client.
2. The permission model is legible from the outside — a client can tell a user what it
   is and is not allowed to do, rather than discovering it through errors.
3. The action queue is an asset, not an implementation detail: a client can show a
   write as pending, retrying, or scheduled, which a direct Jelly integration cannot.

They are also the forcing function for feature parity. Building the same app twice,
against the same SDK, surfaces every place the API is awkward.

## Scope, given the send constraint

Jelly's API cannot send customer-facing email (see the
[index](./README.md#the-constraint-that-shapes-everything)). Both apps are therefore
**triage and drafting clients**:

- read mailboxes, conversations, threads, attachments
- search
- comment internally
- compose a draft reply or a new draft conversation, which a human finishes in the
  Jelly UI
- archive / unarchive, assign / unassign, label, snooze
- an **Outbox** showing queued, retrying, scheduled, and failed actions

The compose screen must be honest about this. After creating a draft, it says *"Draft
saved to Jelly — a teammate needs to open it in Jelly and press send"*, with a deep link
to the conversation. Pretending otherwise produces a demo that lies about what the
product does, which is worse than a smaller demo.

If Jelly ever adds a send endpoint, the compose screen changes one label and gains one
action type. The rest is already built.

## `packages/client` — the shared SDK

Parity between two apps is not maintained by discipline; it is maintained by both apps
consuming the same thing. Add a workspace package that owns:

- a typed oRPC client built from `AppRouterClient`, configured with either a session
  (web) or a bearer API key (mobile),
- TanStack Query option factories per resource, so cache keys are identical across apps,
- optimistic mutation helpers that write to the local cache, tag the entity as
  `pending`, and reconcile when the action reaches a terminal state,
- an action-polling hook for `202` responses,
- a **capability manifest**: the client reads its own key's scopes once at startup and
  exposes `can('conversation.archive')`. Both apps gate UI on it, so a read-only key
  renders a read-only app instead of a broken one.

Also add `packages/client/src/features.ts`: a single list of feature ids with a
`web`/`native` support flag. Both apps render their feature list from it, and a test
fails when one app implements something the other does not. Parity becomes a build
error rather than a code review note.

## Screen-by-screen parity

| Feature | Web | Mobile | Notes |
|---|---|---|---|
| Sign in | Hack Club OIDC | email OTP, OIDC via `expo-auth-session` | both already supported by `packages/auth` |
| Mailbox list | sidebar | tab root | only mailboxes the key/session can see |
| Conversation list | infinite scroll, status filter | same | cursor pagination from the mirror |
| Search | header search | search tab | live proxy to Jelly, mailbox-filtered |
| Thread view | messages + comments merged | same | `timeline=true` equivalent, built from mirror |
| Attachments | inline preview + download | download / share sheet | through the Marmalade proxy, never a raw Jelly URL |
| Internal comment | composer | composer | `comment.create` |
| Draft reply | composer | composer | `draft_reply.create`, with `409`-is-fine handling |
| New draft conversation | composer | composer | `draft_conversation.create` |
| Archive / unarchive | swipe + button | swipe | optimistic |
| Assign | picker | sheet | optimistic |
| Label | picker | sheet | optimistic |
| Snooze | date picker | sheet | uses `scheduled_for` |
| Outbox | full page | tab | pending / retrying / scheduled / failed, with retry and cancel |
| Capability view | settings page | settings screen | renders the key's actual scopes |

## The Outbox is the demo

Most of these features are table stakes. The Outbox is the one screen that only exists
because of Marmalade's architecture, and it is what the demo should lead with:

- A write made while offline or during a Jelly rate-limit window appears immediately as
  **pending**, with the reason (`quota resets in 12 minutes`, `retrying in 30s, attempt
  3 of 8`).
- A user can cancel a scheduled action before it dispatches.
- A failed action shows Jelly's actual validation message, not "something went wrong".
- Nothing is lost when the app is closed, because the state lives in `jelly_action`, not
  in the client.

Mobile makes this visceral: turn on airplane mode, archive three threads and write a
comment, turn it back on, watch the Outbox drain. That is a 20-second demo of the entire
value proposition.

## Mobile specifics

- **Credential storage.** `expo-secure-store` for the session token or API key. Never
  `AsyncStorage`.
- **Push notifications.** The Jelly `new_message` and `assigned` webhooks already land
  in Marmalade. Fan them out to `expo-notifications` for members assigned to the
  conversation. This needs a device-token table and an opt-in per user; treat it as a
  stretch goal, not part of the parity baseline, and mark it `native: true, web: false`
  in the feature manifest with a matching web-push follow-up rather than quietly
  letting the two apps diverge.
- **Offline reads.** Persist the TanStack Query cache so a cold launch without network
  still shows the last known mailbox.

## Web specifics

The demo should live at its own route group (`apps/web/src/routes/demo/`) rather than a
third app, so it shares the existing auth, layout, and `packages/ui` primitives. It uses
a **real Marmalade API key** obtained through the existing key UI, not the ambient
session — otherwise it demonstrates nothing about the permission model. Show the key's
scopes in the UI and let the user swap keys to watch the app's capabilities change.
That is the most convincing single interaction in either demo.

## Phasing

| Phase | Deliverable |
|---|---|
| 1 | `packages/client` with the oRPC client, query factories, and the capability manifest |
| 2 | Web demo, read-only: mailboxes, conversations, thread view, attachments, search |
| 3 | Mobile demo, read-only, to the same feature list |
| 4 | Writes in both: archive, assign, label, comment — with optimistic updates |
| 5 | Outbox in both, including retry, cancel, and failure detail |
| 6 | Drafting in both, with the "a teammate must press send" flow made explicit |
| 7 | Feature-manifest parity test in CI; snooze and scheduled actions |
| 8 | Stretch: push notifications, offline cache persistence |

## Dependencies

Phases 2–3 need Plan 1 phase 7 (read parity: search, labels, attachments proxy,
timeline). Phase 4 needs Plan 1 phases 2–4. Phase 6 needs Plan 1 phase 6. The mobile
app needs Plan 2 complete. Plan 2 and the read-only slices of Plan 1 can proceed in
parallel.
