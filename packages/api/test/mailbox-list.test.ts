import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@marmalade-v2/db", async () => {
  const { testDb } = await import("./db");
  return { db: testDb, createDb: () => testDb };
});

import { jellyMailboxMember } from "@marmalade-v2/db/schema/index";

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
const { resolveTeamById } = await import("../src/lib/team");

async function context(
  person: { id: string; email: string; name: string },
  teamId: string,
  role?: string,
) {
  return {
    auth: null,
    team: await resolveTeamById(teamId),
    session: {
      user: { ...person, role: role ?? "user" },
      session: {
        id: "s1",
        userId: person.id,
        token: "t",
        expiresAt: new Date(),
      },
    },
  } as never;
}

beforeEach(async () => {
  await resetDb();
  await seedTwoTeams();
});

describe("the mailbox list an admin sees", () => {
  it("includes a mailbox nobody has joined", async () => {
    // Otherwise the team connected five minutes ago shows nothing, and the
    // control that registers a mailbox lives on the row that is missing.
    const list = await call(
      mailboxRouter.list,
      {},
      { context: await context(BETA_ADMIN, BETA) },
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.jellyMailbox.jellyMailboxId).toBe(SHARED_MAILBOX);
  });

  it("lists the Jelly members, not just how many there are", async () => {
    // A count with an empty array renders "Jelly Mailbox Members (29)" above
    // nothing at all.
    await testDb.insert(jellyMailboxMember).values({
      jellyContactId: "contact-beta-both",
      jellyMailboxId: SHARED_MAILBOX,
      jellyTeamId: BETA,
    });

    const list = await call(
      mailboxRouter.list,
      {},
      { context: await context(BETA_ADMIN, BETA) },
    );

    const mailbox = list[0]!.jellyMailbox;
    expect(mailbox.memberCount).toBe(1);
    expect(mailbox.members).toHaveLength(mailbox.memberCount);
    expect(mailbox.members[0]?.jelly?.email).toBe(PERSON.email);
  });

  it("does not count another team's members", async () => {
    // Both teams own a mailbox called `general`, so a membership row keyed
    // on the mailbox id alone would be counted in both.
    await testDb.insert(jellyMailboxMember).values({
      jellyContactId: "contact-alpha-both",
      jellyMailboxId: SHARED_MAILBOX,
      jellyTeamId: ALPHA,
    });

    const list = await call(
      mailboxRouter.list,
      {},
      { context: await context(BETA_ADMIN, BETA) },
    );
    expect(list[0]?.jellyMailbox.memberCount).toBe(0);
    expect(list[0]?.jellyMailbox.members).toEqual([]);
  });

  it("reports who has been granted API access", async () => {
    const list = await call(
      mailboxRouter.list,
      {},
      { context: await context(PERSON, ALPHA, "admin") },
    );
    const granted = list[0]?.marmaladeMailbox;
    expect(granted?.memberCount).toBe(1);
    expect(granted?.members[0]?.marmalade?.email).toBe(PERSON.email);
  });
});
