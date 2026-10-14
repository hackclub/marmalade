import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@marmalade-v2/db", async () => {
  const { testDb } = await import("./db");
  return { db: testDb, createDb: () => testDb };
});

// The context module pulls in Better Auth only to read a session, which no
// test here does. Stubbing it keeps the suite from needing an auth runtime.
vi.mock("@marmalade-v2/auth", () => ({
  auth: { api: { getSession: async () => null } },
}));

import { apiKey, apiKeyScope } from "@marmalade-v2/db/schema/index";

import { resetDb, testDb } from "./db";
import { ALPHA, BETA, PERSON, seedTwoTeams } from "./seed";

const { createApiKeyContext, hashSecret } = await import("../src/context");
const { ACTIVE_TEAM_HEADER } = await import("../src/lib/team");

const SECRET = "0".repeat(64);
const PREFIX = SECRET.slice(0, 8);

async function makeKey({ extraTeams }: { extraTeams: string[] }) {
  const [row] = await testDb
    .insert(apiKey)
    .values({
      keyPrefix: PREFIX,
      secretHash: hashSecret(SECRET),
      name: "test key",
      createdBy: PERSON.id,
      jellyTeamId: ALPHA,
    })
    .returning({ id: apiKey.id });

  for (const team of extraTeams) {
    await testDb.insert(apiKeyScope).values({
      apiKeyId: row!.id,
      scopeResourceType: "team",
      scopeResourceId: team,
    });
  }
}

const request = (headers: Record<string, string> = {}) =>
  new Request("https://marmalade.test/api/rpc/mailboxes", {
    headers: { authorization: `Bearer mrmld_${SECRET}`, ...headers },
  });

beforeEach(async () => {
  await resetDb();
  await seedTwoTeams();
});

describe("an API key names its own team", () => {
  it("resolves to the issuing team when the request says nothing", async () => {
    // The whole point of putting the tenant on the key: no existing
    // integration has to change under multi-team.
    await makeKey({ extraTeams: [] });
    const context = await createApiKeyContext({ req: request() });
    expect(context.team?.id).toBe(ALPHA);
    expect(context.apiKey.teamIds).toEqual([ALPHA]);
  });

  it("refuses a team it was not granted", async () => {
    await makeKey({ extraTeams: [] });
    await expect(
      createApiKeyContext({ req: request({ [ACTIVE_TEAM_HEADER]: "beta" }) }),
    ).rejects.toThrow(/not authorized for team/i);
  });

  it("accepts a team it was granted", async () => {
    await makeKey({ extraTeams: [BETA] });
    const context = await createApiKeyContext({
      req: request({ [ACTIVE_TEAM_HEADER]: "beta" }),
    });
    expect(context.team?.id).toBe(BETA);
    expect(context.apiKey.teamIds.sort()).toEqual([ALPHA, BETA].sort());
  });

  it("refuses an unknown team", async () => {
    await makeKey({ extraTeams: [BETA] });
    await expect(
      createApiKeyContext({ req: request({ [ACTIVE_TEAM_HEADER]: "nope" }) }),
    ).rejects.toThrow(/unknown team/i);
  });

  it("refuses a wrong secret that shares a prefix", async () => {
    // The prefix is printed in the UI and is not a secret.
    await makeKey({ extraTeams: [] });
    const wrong = `${PREFIX}${"f".repeat(56)}`;
    await expect(
      createApiKeyContext({
        req: new Request("https://marmalade.test/", {
          headers: { authorization: `Bearer mrmld_${wrong}` },
        }),
      }),
    ).rejects.toThrow(/invalid api key/i);
  });
});
