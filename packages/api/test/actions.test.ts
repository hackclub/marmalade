import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@marmalade-v2/db", async () => {
  const { testDb } = await import("./db");
  return { db: testDb, createDb: () => testDb };
});

import { jellyAction } from "@marmalade-v2/db/schema/action";
import { jellyQuotaBucket } from "@marmalade-v2/db/schema/observability";
import { jellyTeam } from "@marmalade-v2/db/schema/team";
import { eq } from "drizzle-orm";

import { resetDb, testDb } from "./db";
import { ALPHA, BETA, BETA_ADMIN, seedTwoTeams } from "./seed";

const { actionRouter } = await import("../src/routers/action");
const { reapStaleLeases, executeAction } =
  await import("../src/lib/actions/outbox");
const { checkTeamQuota, consumeQuota, INSTANCE_SCOPE_ID } =
  await import("../src/lib/quota");
const { resolveTeamById } = await import("../src/lib/team");

async function context(
  person: { id: string; email: string; name: string },
  teamId: string,
) {
  return {
    auth: null,
    team: await resolveTeamById(teamId),
    session: {
      user: { ...person, role: "user" },
      session: {
        id: "s1",
        userId: person.id,
        token: "t",
        expiresAt: new Date(),
      },
    },
  } as never;
}

/** A team-scoped action: no mailbox, which is the case that had no guard. */
async function seedAction(teamId: string, overrides = {}) {
  const [row] = await testDb
    .insert(jellyAction)
    .values({
      id: `act_${teamId}`,
      idempotencyKey: `key_${teamId}`,
      jellyTeamId: teamId,
      jellyMailboxId: null,
      actionType: "label.create",
      targetResourceType: "label",
      payload: { name: "x" },
      actorType: "user",
      actorKey: "user:someone",
      status: "pending",
      ...overrides,
    })
    .returning();
  return row!;
}

beforeEach(async () => {
  await resetDb();
  await seedTwoTeams();
});

describe("an action belongs to one team", () => {
  it("does not return another team's action", async () => {
    await seedAction(ALPHA);
    await expect(
      call(
        actionRouter.get,
        { actionId: `act_${ALPHA}` },
        { context: await context(BETA_ADMIN, BETA) },
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("does not cancel another team's action", async () => {
    // A team-scoped action has no mailbox, so the mailbox check that guarded
    // this route never ran and a session caller passed unexamined.
    await seedAction(ALPHA);
    await expect(
      call(
        actionRouter.cancel,
        { actionId: `act_${ALPHA}` },
        { context: await context(BETA_ADMIN, BETA) },
      ),
    ).rejects.toThrow(/not found/i);

    const [row] = await testDb
      .select()
      .from(jellyAction)
      .where(eq(jellyAction.id, `act_${ALPHA}`));
    expect(row?.status).toBe("pending");
  });

  it("does not retry another team's action", async () => {
    await seedAction(ALPHA, { status: "dead" });
    await expect(
      call(
        actionRouter.retry,
        { actionId: `act_${ALPHA}` },
        { context: await context(BETA_ADMIN, BETA) },
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("cancels its own team's action", async () => {
    await seedAction(BETA);
    await call(
      actionRouter.cancel,
      { actionId: `act_${BETA}` },
      { context: await context(BETA_ADMIN, BETA) },
    );
    const [row] = await testDb
      .select()
      .from(jellyAction)
      .where(eq(jellyAction.id, `act_${BETA}`));
    expect(row?.status).toBe("cancelled");
  });
});

describe("a lease that expires is an unknown outcome", () => {
  it("marks a reaped action for reconciliation", async () => {
    await seedAction(ALPHA, {
      status: "in_flight",
      lockedAt: new Date(Date.now() - 10 * 60_000),
      lockedBy: "inline",
    });

    expect(await reapStaleLeases()).toBe(1);

    const [row] = await testDb
      .select()
      .from(jellyAction)
      .where(eq(jellyAction.id, `act_${ALPHA}`));
    expect(row?.status).toBe("pending");
    // Without this the action is re-run blind, and for a draft that means a
    // second draft in a customer's thread.
    expect(row?.needsReconcile).not.toBeNull();
  });

  it("dead-letters an action that can be neither repeated nor checked", async () => {
    // `draft_reply.create` is not idempotent and has no reconcile.
    const action = await seedAction(ALPHA, {
      actionType: "draft_reply.create",
      targetResourceType: "draft_reply",
      needsReconcile: new Date(),
    });

    const result = await executeAction(action);

    expect(result.status).toBe("dead");
    expect(JSON.stringify(result.lastError)).toMatch(/unknown outcome/i);
  });
});

describe("quota ceilings", () => {
  it("uses the ceiling on the team row rather than a constant", async () => {
    await testDb
      .update(jellyTeam)
      .set({ dailyCeiling: 2 })
      .where(eq(jellyTeam.id, ALPHA));

    await consumeQuota([{ scope: "team", scopeId: ALPHA }]);
    await consumeQuota([{ scope: "team", scopeId: ALPHA }]);

    const verdict = await checkTeamQuota(ALPHA);
    expect(verdict.allowed).toBe(false);

    // The other team has its own budget and is unaffected.
    expect((await checkTeamQuota(BETA)).allowed).toBe(true);
  });

  it("refuses when the shared per-IP window is exhausted, whoever spent it", async () => {
    // Jelly limits by source address, so one team can exhaust the window for
    // every other team on the deployment.
    const { INSTANCE_FIVE_MINUTE_CEILING, windowStartFor } =
      await import("../src/lib/quota");
    await testDb.insert(jellyQuotaBucket).values({
      scope: "instance",
      scopeId: INSTANCE_SCOPE_ID,
      window: "five_minute",
      windowStart: windowStartFor("five_minute"),
      count: INSTANCE_FIVE_MINUTE_CEILING,
    });

    const verdict = await checkTeamQuota(BETA);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/shared/i);
  });
});

describe("the action list and the queue stay inside the team", () => {
  it("lists only this team's actions", async () => {
    await seedAction(ALPHA);
    await seedAction(BETA);

    const rows = await call(
      actionRouter.list,
      { limit: 50 },
      // An admin, because a plain member's list is filtered to the
      // mailboxes they hold and a team-scoped action has no mailbox.
      { context: await context(BETA_ADMIN, BETA) },
    );
    expect(rows.map((row) => row.id)).toEqual([`act_${BETA}`]);
  });
});

describe("time comparisons are made in UTC", () => {
  it("reaps and claims whatever the session time zone is", async () => {
    // The time columns hold UTC but have no zone, so comparing them against
    // `now()` reads them in the session's zone. West of UTC that silently
    // stops the queue: nothing is ever due and nothing is ever reaped.
    await testDb.execute("set time zone 'America/Chicago'");

    await seedAction(ALPHA, {
      status: "in_flight",
      lockedAt: new Date(Date.now() - 10 * 60_000),
      lockedBy: "worker",
    });

    expect(await reapStaleLeases()).toBe(1);

    const [row] = await testDb
      .select()
      .from(jellyAction)
      .where(eq(jellyAction.id, `act_${ALPHA}`));
    expect(row?.status).toBe("pending");

    await testDb.execute("set time zone 'UTC'");
  });
});
