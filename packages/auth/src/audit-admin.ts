import { createDb } from "@marmalade-v2/db";
import { auditLog } from "@marmalade-v2/db/schema/audit";
import { env } from "@marmalade-v2/env/server";
import { createAuthMiddleware } from "better-auth/api";

/**
 * Admin-plugin endpoints worth recording, and what the audited subject is.
 *
 * These endpoints live under `/api/auth`, so they never pass through oRPC and
 * would otherwise leave no trace at all. Impersonation in particular has to be
 * accountable: without this, an admin can act as any user and the only
 * evidence is whatever that user's actions happened to log, attributed to the
 * user rather than to the admin.
 *
 * Read-only endpoints (`list-users`, `get-user`, `has-permission`) are
 * omitted deliberately — logging every list call would bury the actions that
 * matter.
 */
const AUDITED_PATHS: Record<string, string> = {
  "/admin/ban-user": "ban_user",
  "/admin/unban-user": "unban_user",
  "/admin/impersonate-user": "impersonate_user",
  "/admin/stop-impersonating": "stop_impersonating",
  "/admin/set-role": "set_role",
  "/admin/create-user": "create_user",
  "/admin/remove-user": "remove_user",
  "/admin/set-user-password": "set_user_password",
  "/admin/update-user": "update_user",
  "/admin/revoke-user-session": "revoke_user_session",
  "/admin/revoke-user-sessions": "revoke_user_sessions",
};

/** Body keys that identify the target, in the order the endpoints use them. */
const TARGET_KEYS = ["userId", "email", "sessionToken"] as const;

function targetOf(body: unknown): string {
  if (!body || typeof body !== "object") return "-1";
  const record = body as Record<string, unknown>;
  for (const key of TARGET_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "-1";
}

/**
 * Everything from the request body except anything that could be a secret.
 * A password set by an admin is an auditable event; the password is not.
 */
function safeMetadata(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).filter(
      ([key]) => !/password|token|secret/i.test(key),
    ),
  );
}

export const auditAdminActions = createAuthMiddleware(async (ctx) => {
  const action = AUDITED_PATHS[ctx.path];
  if (!action) return;

  try {
    const session = ctx.context.session;

    await createDb()
      .insert(auditLog)
      .values({
        // The admin who performed it, never the user it was performed on.
        userId: session?.user?.id ?? null,
        jellyTeamId: env.JELLY_TEAM_ID,
        action,
        resource: "auth_user",
        resourceId: targetOf(ctx.body),
        status: "success",
        ipAddress:
          ctx.headers?.get("x-forwarded-for") ??
          ctx.headers?.get("x-real-ip") ??
          null,
        userAgent: ctx.headers?.get("user-agent") ?? null,
        metadata: {
          path: ctx.path,
          actorEmail: session?.user?.email ?? null,
          // Already an impersonated session? Then an admin is acting through
          // someone else, and the chain matters more than the leaf.
          impersonatedBy:
            (session?.session as { impersonatedBy?: string } | undefined)
              ?.impersonatedBy ?? null,
          ...safeMetadata(ctx.body),
        },
      });
  } catch (error) {
    // Never let the audit write break the action it is recording. A failed
    // ban because the log was unavailable is worse than a missing row, and
    // the row is recoverable from Better Auth's own state.
    console.error("Failed to audit admin action", ctx.path, error);
  }
});
