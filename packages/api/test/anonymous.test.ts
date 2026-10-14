import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@marmalade-v2/db", async () => {
  const { testDb } = await import("./db");
  return { db: testDb, createDb: () => testDb };
});

import { resetDb } from "./db";
import { ALPHA, PERSON, seedTwoTeams } from "./seed";

const { teamRouter } = await import("../src/routers/team");
const { mailboxRouter } = await import("../src/routers/mailbox");
const { INTERNAL_CONTEXT } = await import("../src/index");
const { resolveTeamById } = await import("../src/lib/team");

beforeEach(async () => {
  await resetDb();
  await seedTwoTeams();
});

/**
 * These spend Jelly's rate-limited quota, and the five-minute limit is per
 * source IP — shared across every team on the deployment. An anonymous
 * caller who could drive them could exhaust the budget for all of them.
 */
describe("the resyncs refuse an anonymous caller", () => {
  const anonymous = { auth: null, session: null, team: null } as never;

  it("refuses team.resync", async () => {
    await expect(
      call(teamRouter.resync, {}, { context: anonymous }),
    ).rejects.toThrow(/unauthorized/i);
  });

  it("refuses mailbox.resync", async () => {
    await expect(
      call(mailboxRouter.resync, {}, { context: anonymous }),
    ).rejects.toThrow(/unauthorized/i);
  });

  it("gets past the gate for Marmalade calling itself", async () => {
    // It fails later, at the Jelly call, which is the point: the refusal
    // above is the gate and not a missing fixture.
    await expect(
      call(
        teamRouter.resync,
        {},
        {
          context: {
            ...INTERNAL_CONTEXT,
            auth: null,
            session: null,
            team: await resolveTeamById(ALPHA),
          } as never,
        },
      ),
    ).rejects.not.toThrow(/unauthorized/i);
  });

  it("gets past the gate for a signed-in user", async () => {
    await expect(
      call(
        teamRouter.resync,
        {},
        {
          context: {
            auth: null,
            team: await resolveTeamById(ALPHA),
            session: { user: { ...PERSON, role: "user" }, session: {} },
          } as never,
        },
      ),
    ).rejects.not.toThrow(/unauthorized/i);
  });
});
