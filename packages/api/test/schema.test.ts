import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@marmalade-v2/db", async () => {
  const { testDb } = await import("./db");
  return { db: testDb, createDb: () => testDb };
});

import {
  conversation,
  jellyTeam,
  jellyTeamContact,
  marmaladeMailbox,
  marmaladeMailboxMember,
} from "@marmalade-v2/db/schema/index";
import { eq, isNull } from "drizzle-orm";

import { resetDb, testDb } from "./db";
import { ALPHA, BETA, PERSON, SHARED_MAILBOX, seedTwoTeams } from "./seed";

const { backfillTeamIds } = await import("../src/lib/team");

let alphaMailboxId: number;

beforeEach(async () => {
  await resetDb();
  const seeded = await seedTwoTeams();
  alphaMailboxId = seeded.alphaMailbox.id;
});

/**
 * The constraints are the part of the tenant boundary that holds even when a
 * handler forgets. Worth asserting that they are actually in the database
 * rather than only in the schema file, since the two are applied separately.
 */
describe("uniqueness that makes two teams representable", () => {
  it("allows the same mailbox id in two teams", async () => {
    const rows = await testDb.select().from(marmaladeMailbox);
    const names = rows.map((row) => `${row.jellyTeamId}/${row.jellyMailboxId}`);
    expect(names.sort()).toEqual([
      `${ALPHA}/${SHARED_MAILBOX}`,
      `${BETA}/${SHARED_MAILBOX}`,
    ]);
  });

  it("refuses the same mailbox twice within one team", async () => {
    const now = new Date().toISOString();
    await expect(
      testDb.insert(marmaladeMailbox).values({
        jellyMailboxId: SHARED_MAILBOX,
        jellyTeamId: ALPHA,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow();
  });

  it("allows one email to be a contact of two teams", async () => {
    const rows = await testDb
      .select()
      .from(jellyTeamContact)
      .where(isNull(jellyTeamContact.name));
    expect(rows.filter((row) => row.email === PERSON.email)).toHaveLength(2);
  });

  it("refuses the same email twice within one team", async () => {
    await expect(
      testDb.insert(jellyTeamContact).values({
        id: "contact-duplicate",
        email: PERSON.email,
        role: "member",
        jellyTeamId: ALPHA,
      }),
    ).rejects.toThrow();
  });

  it("refuses to grant the same person the same mailbox twice", async () => {
    const now = new Date().toISOString();
    await expect(
      testDb.insert(marmaladeMailboxMember).values({
        marmaladeUserId: PERSON.id,
        marmaladeMailboxId: alphaMailboxId,
        jellyTeamId: ALPHA,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow();
  });

  it("refuses two teams sharing a slug", async () => {
    await expect(
      testDb.insert(jellyTeam).values({ id: "third", slug: "alpha" }),
    ).rejects.toThrow();
  });
});

describe("backfillTeamIds", () => {
  const unlabelled = () =>
    testDb.insert(conversation).values({
      id: "conversation-from-before",
      lastMessageAt: new Date(),
    });

  it("claims unlabelled rows only while one team is connected", async () => {
    await unlabelled();
    // Two teams are seeded, and a row that predates the column carries no
    // evidence of whose it is. Claiming it would hand one team the other's
    // history on whichever resync ran next.
    await backfillTeamIds(ALPHA);

    const rows = await testDb
      .select()
      .from(conversation)
      .where(isNull(conversation.jellyTeamId));
    expect(rows).toHaveLength(1);
  });

  it("claims them when there is only one team", async () => {
    await testDb.delete(jellyTeam).where(eq(jellyTeam.id, BETA));
    await unlabelled();

    await backfillTeamIds(ALPHA);

    const [row] = await testDb.select().from(conversation);
    expect(row?.jellyTeamId).toBe(ALPHA);
  });
});
