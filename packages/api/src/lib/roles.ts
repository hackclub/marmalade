/**
 * Whether a role may administer the team currently selected.
 *
 * `instance` is what the middlewares report for a Marmalade instance
 * operator, who holds no Jelly role in the team they are looking at. The web
 * app has the same predicate, and the two have to agree: when they do not,
 * the server accepts a write whose control the page never rendered.
 */
export function canAdministerTeam(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "instance";
}

/**
 * How a role reads to a person.
 *
 * `instance` is not a Jelly role, so prefixing it with "team" the way the
 * others are prefixed produced "team instance", which describes nothing.
 */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return "guest";
  return role === "instance" ? "instance admin" : `team ${role}`;
}
