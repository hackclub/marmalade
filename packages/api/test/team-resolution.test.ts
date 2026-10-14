import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@marmalade-v2/db", async () => {
  const { testDb } = await import("./db");
  return { db: testDb, createDb: () => testDb };
});

import { resetDb } from "./db";
import { ALPHA, ALPHA_ONLY, BETA, OPERATOR, PERSON, seedTwoTeams } from "./seed";

const {
  ACTIVE_TEAM_COOKIE,
  ACTIVE_TEAM_HEADER,
  resolveTeamFromRequest,
  teamsForEmail,
  slugify,
  assertRowBelongsToTeam,
} = await import("../src/lib/team");

const request = (headers: Record<string, string> = {}) =>
  new Request("https://marmalade.test/api/rpc/mailboxes", { headers });

beforeEach(async () => {
  await resetDb();
  await seedTwoTeams();
  delete process.env.JELLY_TEAM_ID;
});

describe("teamsForEmail", () => {
  it("returns every team the person is staff in", async () => {
    const teams = await teamsForEmail(PERSON.email);
    expect(teams.map((team) => team.id).sort()).toEqual([ALPHA, BETA]);
  });

  it("does not count a correspondent as a member", async () => {
    // `alpha@example.com` has a `contact` row in Beta. Sharing an address
    // with a user must not make Beta selectable.
    const teams = await teamsForEmail(ALPHA_ONLY.email);
    expect(teams.map((team) => team.id)).toEqual([ALPHA]);
  });

  it("returns nothing for a stranger", async () => {
    expect(await teamsForEmail("nobody@example.com")).toEqual([]);
  });
});

describe("resolveTeamFromRequest", () => {
  it("reads the team from the header", async () => {
    const team = await resolveTeamFromRequest(
      request({ [ACTIVE_TEAM_HEADER]: "beta" }),
      PERSON.email,
    );
    expect(team.id).toBe(BETA);
  });

  it("reads the team from the cookie when there is no header", async () => {
    // A server-rendered navigation is a plain document request and cannot
    // set a header, so the cookie has to work on its own.
    const team = await resolveTeamFromRequest(
      request({ cookie: `other=1; ${ACTIVE_TEAM_COOKIE}=beta` }),
      PERSON.email,
    );
    expect(team.id).toBe(BETA);
  });

  it("refuses a team the caller is not a member of", async () => {
    await expect(
      resolveTeamFromRequest(
        request({ [ACTIVE_TEAM_HEADER]: "beta" }),
        ALPHA_ONLY.email,
      ),
    ).rejects.toThrow(/not a member/i);
  });

  it("refuses an unknown slug", async () => {
    await expect(
      resolveTeamFromRequest(
        request({ [ACTIVE_TEAM_HEADER]: "nope" }),
        PERSON.email,
      ),
    ).rejects.toThrow(ORPCError);
  });

  it("lets an instance operator select a team they hold no role in", async () => {
    // They onboard teams they are not members of. Refusing them here would
    // mean the person responsible for a team cannot open it.
    const team = await resolveTeamFromRequest(
      request({ [ACTIVE_TEAM_HEADER]: "beta" }),
      OPERATOR.email,
      true,
    );
    expect(team.id).toBe(BETA);
  });

  it("defaults a single-team member to their own team", async () => {
    const team = await resolveTeamFromRequest(request(), ALPHA_ONLY.email);
    expect(team.id).toBe(ALPHA);
  });

  it("refuses to guess for someone in several teams", async () => {
    // Picking one would be a silent cross-tenant read the caller never asked
    // for. Better to say the request has to name a team.
    await expect(
      resolveTeamFromRequest(request(), PERSON.email),
    ).rejects.toThrow(/several Jelly teams/i);
  });

  it("falls back to the team id when a slug was never assigned", async () => {
    const team = await resolveTeamFromRequest(
      request({ [ACTIVE_TEAM_HEADER]: BETA }),
      PERSON.email,
    );
    expect(team.id).toBe(BETA);
  });
});

describe("slugify", () => {
  it("makes a URL-safe handle", () => {
    expect(slugify("Hack Club")).toBe("hack-club");
    expect(slugify("  Stardance!!  ")).toBe("stardance");
  });

  it("never returns an empty handle", () => {
    expect(slugify("!!!")).toBe("team");
  });
});

describe("assertRowBelongsToTeam", () => {
  it("passes for a row of this team", () => {
    expect(() =>
      assertRowBelongsToTeam("Message", "m1", ALPHA, ALPHA),
    ).not.toThrow();
  });

  it("passes for a row that has no team yet", () => {
    expect(() =>
      assertRowBelongsToTeam("Message", "m1", null, ALPHA),
    ).not.toThrow();
  });

  it("refuses to reuse another team's row", () => {
    // Jelly ids are primary keys and the webhook inserts with
    // `onConflictDoNothing`, so without this a collision is silent.
    expect(() => assertRowBelongsToTeam("Message", "m1", BETA, ALPHA)).toThrow(
      /already belongs to team/,
    );
  });
});
