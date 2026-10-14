/**
 * Whether a role may administer the team currently selected.
 *
 * `instance` is what `membershipInfo` reports for a Marmalade instance
 * operator, who holds no Jelly role in the team they are looking at. Without
 * it here the server would accept their writes while the UI hid every
 * control that makes them — which is how an operator ends up unable to
 * register a mailbox for a team they themselves connected.
 */
export function canAdministerTeam(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "instance";
}
