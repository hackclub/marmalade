import { describe, expect, it } from "vitest";

import { canAdministerTeam, roleLabel } from "../src/lib/roles";

/**
 * The UI's idea of "may administer" has to agree with the server's, or the
 * server accepts a write whose button the page never showed. That is how an
 * operator ended up unable to register a mailbox for a team they themselves
 * connected.
 */
describe("canAdministerTeam", () => {
  it("admits Jelly admins and owners", () => {
    expect(canAdministerTeam("admin")).toBe(true);
    expect(canAdministerTeam("owner")).toBe(true);
  });

  it("admits an instance operator, who holds no Jelly role", () => {
    expect(canAdministerTeam("instance")).toBe(true);
  });

  it("refuses an ordinary member", () => {
    expect(canAdministerTeam("member")).toBe(false);
  });

  it("refuses a correspondent", () => {
    expect(canAdministerTeam("contact")).toBe(false);
  });

  it("refuses an absent role", () => {
    expect(canAdministerTeam(null)).toBe(false);
    expect(canAdministerTeam(undefined)).toBe(false);
  });
});

describe("roleLabel", () => {
  it("reads an instance operator as an instance admin", () => {
    // "team instance" described nothing: `instance` is not a Jelly role.
    expect(roleLabel("instance")).toBe("instance admin");
  });

  it("prefixes a Jelly role with the team it is in", () => {
    expect(roleLabel("admin")).toBe("team admin");
    expect(roleLabel("member")).toBe("team member");
  });

  it("says something for a missing role", () => {
    expect(roleLabel(null)).toBe("guest");
  });
});
