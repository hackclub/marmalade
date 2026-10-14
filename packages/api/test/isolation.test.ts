import { ORPCError, call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@marmalade-v2/db", async () => {
  const { testDb } = await import("./db");
  return { db: testDb, createDb: () => testDb };
});

import { resetDb, testDb } from "./db";
import {
  ALPHA,
  BETA,
  BETA_ADMIN,
  PERSON,
  SHARED_MAILBOX,
  seedTwoTeams,
} from "./seed";

const { mailboxRouter } = await import("../src/routers/mailbox");
const { conversationRouter } = await import("../src/routers/convo");
const { resolveTeamById } = await import("../src/lib/team");

let alphaMailboxId: number;
let betaMailboxId: number;

beforeEach(async () => {
  await resetDb();
  const seeded = await seedTwoTeams();
  alphaMailboxId = seeded.alphaMailbox.id;
  betaMailboxId = seeded.betaMailbox.id;
});

async function sessionContext(
  person: { id: string; email: string; name: string },
  teamId: string,
) {
  return {
    auth: null,
    team: await resolveTeamById(teamId),
    session: {
      user: { ...person, role: "user" },
      session: { id: "s1", userId: person.id, token: "t", expiresAt: new Date() },
    },
  } as never;
}

describe("a mailbox id means nothing without a team", () => {
  it("lets a granted member read their own team's mailbox", async () => {
    const context = await sessionContext(PERSON, ALPHA);
    const rows = await call(
      conversationRouter.convo.list,
      { mailboxId: SHARED_MAILBOX },
      { context },
    );
    expect(rows).toEqual([]);
  });

  it("refuses the same mailbox id in a team they were not granted", async () => {
    // Both teams own a mailbox called `general` and this person is staff in
    // both. The grant exists only in Alpha. Checking the id alone would let
    // it through in Beta, which is the shape of the bug that was there.
    const context = await sessionContext(PERSON, BETA);
    await expect(
      call(
        conversationRouter.convo.list,
        { mailboxId: SHARED_MAILBOX },
        { context },
      ),
    ).rejects.toThrow(ORPCError);
  });
});

describe("mailbox handlers keyed by the surrogate id", () => {
  it("refuses to deactivate another team's mailbox", async () => {
    // `marmalade_mailbox_id` names a mailbox without saying whose. An admin
    // of Beta passing Alpha's row id must not reach it.
    const context = await sessionContext(BETA_ADMIN, BETA);
    await expect(
      call(
        mailboxRouter.deactivate,
        { marmaladeMailboxId: alphaMailboxId },
        { context },
      ),
    ).rejects.toThrow(/not found/i);

    const [alpha] = await testDb.query.marmaladeMailbox.findMany({
      where: (row, { eq }) => eq(row.id, alphaMailboxId),
    });
    expect(alpha?.active).toBe(true);
  });

  it("deactivates its own team's mailbox", async () => {
    const context = await sessionContext(BETA_ADMIN, BETA);
    await call(
      mailboxRouter.deactivate,
      { marmaladeMailboxId: betaMailboxId },
      { context },
    );

    const [beta] = await testDb.query.marmaladeMailbox.findMany({
      where: (row, { eq }) => eq(row.id, betaMailboxId),
    });
    expect(beta?.active).toBe(false);
  });

  it("refuses to grant access to another team's mailbox", async () => {
    const context = await sessionContext(BETA_ADMIN, BETA);
    await expect(
      call(
        mailboxRouter.createMember,
        {
          marmaladeMailboxId: alphaMailboxId,
          marmaladeMemberId: BETA_ADMIN.id,
        },
        { context },
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("records the team on a grant it does make", async () => {
    const context = await sessionContext(BETA_ADMIN, BETA);
    await call(
      mailboxRouter.createMember,
      { marmaladeMailboxId: betaMailboxId, marmaladeMemberId: BETA_ADMIN.id },
      { context },
    );

    const grants = await testDb.query.marmaladeMailboxMember.findMany({
      where: (row, { eq }) => eq(row.marmaladeUserId, BETA_ADMIN.id),
    });
    expect(grants).toHaveLength(1);
    // Null here would mean the row waits for a backfill to say whose it is.
    expect(grants[0]?.jellyTeamId).toBe(BETA);
  });
});

describe("an instance operator is not limited by Jelly membership", () => {
  it("reads a team they hold no role in", async () => {
    const context = (await sessionContext(
      { id: "user-operator", email: "operator@example.com", name: "Op" },
      BETA,
    )) as unknown as { session: { user: Record<string, unknown> } };
    context.session.user.role = "admin";

    const rows = await call(
      conversationRouter.convo.list,
      { mailboxId: SHARED_MAILBOX },
      { context: context as never },
    );
    expect(rows).toEqual([]);
  });
});
