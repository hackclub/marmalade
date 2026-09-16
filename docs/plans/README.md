# Marmalade plans

Three sequenced plans. Plan 1 is a prerequisite for Plan 3; Plan 2 is independent of
Plan 1 and can run in parallel.

| # | Plan | Depends on | Summary |
|---|------|-----------|---------|
| 1 | [Write API actions](./01-write-actions.md) | — | Durable action outbox, quota governance, write-scoped keys, admin observability |
| 2 | [Native app template](./02-native-template.md) | — | Bring a Better-T-Stack Expo app into the turborepo |
| 3 | [Demo clients](./03-demo-apps.md) | 1, 2 | Web + mobile Jelly clients built only on Marmalade, at feature parity |

## The constraint that shapes everything

Jelly's API **cannot send customer-facing email**. From
<https://letsjelly.com/help/advanced/api>:

> Only people can send customer-facing replies. API tokens can add internal comments,
> but they cannot send a message to the customer.

> The draft appears in the Jelly UI, ready for a team member to review and send.
> Nothing is sent to the recipient until a team member sends it.

Consequences:

- **There is no "send" action to implement.** The closest primitives are
  `POST /api/draft_conversations`, `POST /api/conversations/:id/draft_reply`, and
  `PATCH /api/messages/:id`. A Marmalade "send" is *compose a draft that a human
  finishes in the Jelly UI*.
- **"Send later if a send fails" is still worth building**, but it is about durable
  retry of *write actions* (draft creation, comments, archive, assign, label), not
  about deferred email delivery. The queue that provides it is the same queue that
  provides quota governance and audit, so the work is not wasted. If Jelly later ships
  a send endpoint, it becomes one more action type on an existing rail.
- **Do not route around this with our own transport.** Marmalade already has a Loops
  API key, so sending mail directly is technically available. Resist it for v1: mail
  sent outside Jelly does not join the conversation thread, does not inherit the
  mailbox's DKIM alignment, does not appear in Jelly's UI for the humans who own the
  inbox, and quietly converts Marmalade from an access layer into a second mail
  system with its own deliverability reputation to manage. Revisit only as an
  explicit, separately-scoped product decision.

The demo apps in Plan 3 are therefore **triage and drafting clients**: read a mailbox,
read a thread, comment internally, compose a draft, archive/assign/label/snooze. That
is a genuinely useful email interface, and it is the honest one.

## What already exists

Marmalade today is a **read-through mirror**. Jelly webhooks (`new_message`,
`assigned`, `comment_added`, `conversation_archived`, `conversation_unarchived`) and
manual sync populate Postgres; every read endpoint serves from Postgres, never from
Jelly. `packages/api/src/lib/jelly.ts` is used only by `routers/mailbox.ts` and
`routers/team.ts` for sync, and it has no retry, no timeout, no rate-limit awareness,
and no request logging.

Writes reverse that direction for the first time: Marmalade becomes an outbound
client of a rate-limited third-party API, on behalf of credentials it did not issue.
Plan 1 is mostly about making that direction safe.
