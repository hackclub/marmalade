import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { testDb } from "./db";

// Every module under test reaches the database through this import.
vi.mock("@marmalade-v2/db", async () => {
  const { testDb } = await import("./db");
  return { db: testDb, createDb: () => testDb };
});

const {
  checkRouterScope,
  filterFieldsByScope,
  isInstanceAdmin,
  requireMailboxAccess,
  teamIdOf,
  teamOf,
} = await import("../src/index");

const sessionFor = (user: Record<string, unknown>) => ({
  session: { user, session: {} },
}) as never;

describe("requireMailboxAccess", () => {
  const ctx = (ids: string[]) => ({ allowedMailboxIds: ids }) as never;

  it("admits a mailbox the caller holds", () => {
    expect(() => requireMailboxAccess(ctx(["general"]), "general")).not.toThrow();
  });

  it("admits anything when the caller holds the wildcard", () => {
    expect(() => requireMailboxAccess(ctx(["*"]), "anything")).not.toThrow();
  });

  it("refuses a mailbox the caller does not hold", () => {
    expect(() => requireMailboxAccess(ctx(["general"]), "secret")).toThrow(
      ORPCError,
    );
  });

  it("refuses when the caller holds nothing", () => {
    // The state every non-admin was in when #22 made `mailbox_member` the
    // gate and nothing had been written to it.
    expect(() => requireMailboxAccess(ctx([]), "general")).toThrow(ORPCError);
  });
});

describe("checkRouterScope", () => {
  it("admits a key scoped to the router", () => {
    const ctx = { apiKey: { resourceScopes: ["convo"] } } as never;
    expect(() => checkRouterScope(ctx, "convo")).not.toThrow();
  });

  it("refuses a key scoped to a different router", () => {
    const ctx = { apiKey: { resourceScopes: ["mailbox"] } } as never;
    expect(() => checkRouterScope(ctx, "convo")).toThrow(ORPCError);
  });

  it("refuses a key with no scopes at all", () => {
    const ctx = { apiKey: { resourceScopes: [] } } as never;
    expect(() => checkRouterScope(ctx, "convo")).toThrow(ORPCError);
  });
});

describe("filterFieldsByScope", () => {
  it("drops a field the key is not scoped to", () => {
    const ctx = {
      apiKey: { fieldScopes: [{ resourceType: "message", field: "id" }] },
    } as never;
    const filtered = filterFieldsByScope(ctx, "message", {
      id: "m1",
      content: "secret",
    });
    expect(filtered).toEqual({ id: "m1" });
  });

  it("returns everything to a session", () => {
    const ctx = sessionFor({ id: "u1" });
    const data = { id: "m1", content: "secret" };
    expect(filterFieldsByScope(ctx, "message", data)).toEqual(data);
  });
});

describe("isInstanceAdmin", () => {
  beforeEach(() => {
    delete process.env.BETTER_AUTH_ADMIN_USER_IDS;
    vi.resetModules();
  });

  it("recognises the admin role", () => {
    expect(isInstanceAdmin({ id: "u1", role: "admin" })).toBe(true);
  });

  it("does not promote an ordinary user", () => {
    expect(isInstanceAdmin({ id: "u1", role: "user" })).toBe(false);
  });

  it("does not promote on a missing user", () => {
    expect(isInstanceAdmin(null)).toBe(false);
    expect(isInstanceAdmin(undefined)).toBe(false);
  });

  it("is not satisfied by a Jelly team role", () => {
    // The distinction #24 drew and this suite has to keep: being an owner
    // in Jelly confers nothing at instance level.
    expect(isInstanceAdmin({ id: "u1", role: "owner" })).toBe(false);
  });
});

describe("teamOf", () => {
  it("returns the resolved team", () => {
    const team = { id: "alpha-team", slug: "alpha" } as never;
    expect(teamIdOf({ team })).toBe("alpha-team");
    expect(teamOf({ team })).toBe(team);
  });

  it("throws rather than defaulting when no team was resolved", () => {
    // A fallback here would be invisible at the call site and would turn
    // every handler that forgot to resolve a team into a cross-tenant read.
    expect(() => teamIdOf({ team: null })).toThrow(ORPCError);
    expect(() => teamIdOf({})).toThrow(ORPCError);
  });
});

describe("the test database", () => {
  it("is reachable", async () => {
    const rows = await testDb.execute("select 1 as ok");
    expect(rows.rows[0]).toEqual({ ok: 1 });
  });
});
