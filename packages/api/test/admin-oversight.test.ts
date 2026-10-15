import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@marmalade-v2/db", async () => {
  const { testDb } = await import("./db");
  return { db: testDb, createDb: () => testDb };
});

import { auditLog } from "@marmalade-v2/db/schema/audit";
import {
  jellyWebhookDelivery,
  usageRollup,
} from "@marmalade-v2/db/schema/observability";

import { resetDb, testDb } from "./db";
import { ALPHA, BETA, BETA_ADMIN, PERSON, seedTwoTeams } from "./seed";

const { adminRouter } = await import("../src/routers/admin");
const { resolveTeamById } = await import("../src/lib/team");

async function adminContext(
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

beforeEach(async () => {
  await resetDb();
  await seedTwoTeams();
});

/**
 * These surfaces read the configured team before this branch was rebased, so
 * an admin of any team saw whichever team the deployment was set up with.
 * With two teams connected that is a cross-tenant read, and `setQuotaPolicy`
 * and `setKeyApproval` made it a cross-tenant write.
 */
describe("the admin surfaces show the caller's own team", () => {
  it("lists only this team's audit entries", async () => {
    await testDb.insert(auditLog).values([
      {
        jellyTeamId: ALPHA,
        action: "create",
        resource: "api_key",
        resourceId: "1",
        status: "success",
      },
      {
        jellyTeamId: BETA,
        action: "revoke",
        resource: "api_key",
        resourceId: "2",
        status: "success",
      },
    ]);

    const rows = await call(
      adminRouter.auditLog,
      { limit: 50 },
      { context: await adminContext(BETA_ADMIN, BETA) },
    );

    expect(rows.map((row) => row.action)).toEqual(["revoke"]);
  });

  it("reports usage for this team only", async () => {
    const bucketHour = new Date();
    await testDb.insert(usageRollup).values([
      {
        bucketHour,
        jellyTeamId: ALPHA,
        scope: "api_key",
        scopeId: "1",
        dimension: "/conversations",
        status: "success",
        count: 10,
      },
      {
        bucketHour,
        jellyTeamId: BETA,
        scope: "api_key",
        scopeId: "2",
        dimension: "/conversations",
        status: "success",
        count: 3,
      },
    ]);

    const usage = await call(
      adminRouter.usage,
      { window: "24h", scope: "api_key" },
      { context: await adminContext(BETA_ADMIN, BETA) },
    );

    // A key id says nothing about which team it belongs to, so this is the
    // case a `scope`-only filter gets wrong.
    expect(usage.consumers.map((row) => row.scopeId)).toEqual(["2"]);
    expect(usage.consumers[0]?.requests).toBe(3);
  });

  it("counts webhook deliveries for this team only", async () => {
    await testDb.insert(jellyWebhookDelivery).values([
      { event: "message.created", jellyTeamId: ALPHA, status: "failed" },
      { event: "message.created", jellyTeamId: BETA, status: "accepted" },
    ]);

    const health = await call(
      adminRouter.health,
      {},
      { context: await adminContext(BETA_ADMIN, BETA) },
    );

    expect(health.webhooks.consecutiveFailures).toBe(0);
  });

  it("refuses a member who is not an admin of the team", async () => {
    // PERSON is staff in both teams but an admin of neither.
    await expect(
      call(
        adminRouter.auditLog,
        { limit: 10 },
        { context: await adminContext(PERSON, BETA) },
      ),
    ).rejects.toThrow(/forbidden/i);
  });
});
