import { env } from "@marmalade-v2/env/server";

/**
 * A Marmalade instance operator.
 *
 * Deliberately not a Jelly role. Onboarding a team, holding its credentials
 * and looking across teams are facts about Marmalade, and no Jelly team
 * should be able to grant itself authority over another.
 *
 * `BETTER_AUTH_ADMIN_USER_IDS` is break-glass: it survives a database whose
 * `user.role` has been changed by someone who should not have.
 *
 * Lives in its own module because the context, the procedures and the team
 * router all need it, and importing it from any of those would make a cycle.
 */
export function isInstanceAdmin(
  user: { id?: string | null; role?: string | null } | null | undefined,
): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;

  const breakGlass = (env.BETTER_AUTH_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return Boolean(user.id && breakGlass.includes(user.id));
}
