import { ORPCError, os } from "@orpc/server";

import { db } from "@marmalade-v2/db";
import {
  marmaladeMailbox,
  marmaladeMailboxMember,
} from "@marmalade-v2/db/schema/mailbox";
import { jellyTeamContact } from "@marmalade-v2/db/schema/team";
import { env } from "@marmalade-v2/env/server";
import { and, eq, inArray } from "drizzle-orm";
import type {
  ApiKeyContext,
  AppContext,
  AuthContext,
  WebhookContext,
} from "./context";
import { resolveDefaultTeam, type ResolvedTeam } from "./lib/team";
import { NON_SCOPABLE_FIELDS } from "./schemas/output";

/**
 * The team this request acts on.
 *
 * Throws rather than falling back to a configured default. A fallback here
 * would be invisible at the call site and would turn every handler that
 * forgot to resolve a team into a silent cross-tenant read.
 */
export function teamOf(context: { team?: ResolvedTeam | null }): ResolvedTeam {
  if (!context.team) {
    throw new ORPCError("BAD_REQUEST", {
      message: "No Jelly team resolved for this request",
    });
  }
  return context.team;
}

export function teamIdOf(context: { team?: ResolvedTeam | null }): string {
  return teamOf(context).id;
}

/**
 * The team for a handler that internal code reaches through `call()` with a
 * synthetic context — the Better Auth signup hook does this for `team.resync`
 * and `mailbox.resync`.
 *
 * Those call sites have no request and so no team, and the configured
 * `JELLY_TEAM_ID` is the only honest answer. Reserved for exactly that case:
 * a request-backed handler uses `teamIdOf`, which has no fallback.
 */
export async function teamOfOrDefault(context: {
  team?: ResolvedTeam | null;
}): Promise<ResolvedTeam> {
  return context.team ?? resolveDefaultTeam();
}

export async function teamIdOrDefault(context: {
  team?: ResolvedTeam | null;
}): Promise<string> {
  return (await teamOfOrDefault(context)).id;
}

/**
 * The same resolution, typed nullable for a middleware that puts the team
 * back into the context.
 *
 * oRPC intersects the context types of every procedure in a router. A
 * middleware that injects a non-nullable `team` therefore makes the whole
 * router demand one, including the health check and the OpenAPI document,
 * which have no team and are not supposed to need one.
 */
async function teamForContext(context: {
  team?: ResolvedTeam | null;
}): Promise<ResolvedTeam | null> {
  return teamOfOrDefault(context);
}

export const authO = os.$context<AuthContext>();
export const webhookO = os.$context<WebhookContext>();
export const apiKeyO = os.$context<ApiKeyContext>();
export const authOrWebhookO = os.$context<AuthContext | WebhookContext>();
export const authOrApiKeyOrWebhookO = os.$context<
  AuthContext | ApiKeyContext | WebhookContext
>();

export const publicProcedure = authO;

export const jellyWebhookProcedure = webhookO;
export const authOrWebhookProcedure = authOrWebhookO;

const requireAuth = authO.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({
    context: {
      session: context.session,
    },
  });
});

const requireAuthOrWebhook = authOrWebhookO.middleware(
  async ({ context, next }) => {
    const hasAuthenticatedSession =
      "session" in context && Boolean(context.session?.user);
    const hasVerifiedWebhookContext =
      "request" in context && "rawBody" in context;

    if (!hasAuthenticatedSession && !hasVerifiedWebhookContext) {
      throw new ORPCError("UNAUTHORIZED");
    }

    return next({
      context,
    });
  },
);
export const requireApiKey = apiKeyO.middleware(async ({ context, next }) => {
  if (!context.apiKey) throw new ORPCError("UNAUTHORIZED");
  return next({ context: { apiKey: context.apiKey } });
});

const requireAuthOrApiKeyOrWebhook = authOrApiKeyOrWebhookO.middleware(
  async ({ context, next }) => {
    const hasSession = "session" in context && Boolean(context.session?.user);
    const hasApiKey = "apiKey" in context && Boolean(context.apiKey);
    const hasWebhook = "request" in context && "rawBody" in context;
    if (!hasSession && !hasApiKey && !hasWebhook)
      throw new ORPCError("UNAUTHORIZED");
    return next({ context });
  },
);
export const apiKeyOrSessionOrWebhookProcedure = authOrApiKeyOrWebhookO.use(
  requireAuthOrApiKeyOrWebhook,
);

export const protectedProcedure = publicProcedure.use(requireAuth);
export const authOrWebhookProtectedProcedure =
  authOrWebhookProcedure.use(requireAuthOrWebhook);
/**
 * A Marmalade instance operator, as distinct from a Jelly team admin.
 *
 * Deliberately not derived from a Jelly role: onboarding a team, holding its
 * credentials and seeing across teams are facts about Marmalade, and no Jelly
 * team should be able to grant them to itself. Backed by Better Auth's admin
 * plugin so operators are not another bespoke table.
 */
export const instanceAdminProcedure = protectedProcedure.use(
  async ({ context, next }) => {
    const user = context.session.user as { id: string; role?: string | null };
    const breakGlass = (env.BETTER_AUTH_ADMIN_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (user.role !== "admin" && !breakGlass.includes(user.id)) {
      throw new ORPCError("FORBIDDEN", {
        message: "Instance operator access is required",
      });
    }
    return next({ context });
  },
);

export const teamAdminProtectedProcedure = protectedProcedure.use(
  async ({ context, next }) => {
    const userEmail = context.session.user.email;
    const team = await teamForContext(context);
    let role;
    try {
      const teamMember = await db
        .select()
        .from(jellyTeamContact)
        .where(
          and(
            eq(jellyTeamContact.email, userEmail),
            eq(jellyTeamContact.jellyTeamId, teamIdOf({ team })),
          ),
        );
      if (!teamMember || teamMember.length === 0 || !teamMember[0]?.role) {
        throw new ORPCError("FORBIDDEN");
      }
      role = teamMember[0].role;
      if (role !== "admin" && role !== "owner") {
        throw new ORPCError("FORBIDDEN");
      }
      return next({
        context: {
          session: context.session,
          team,
        },
      });
    } catch {
      throw new ORPCError("FORBIDDEN");
    }
  },
);
export const teamMemberProtectedProcedure = protectedProcedure.use(
  async ({ context, next }) => {
    const userEmail = context.session.user.email;
    const team = await teamForContext(context);
    let role;
    try {
      const teamMember = await db
        .select()
        .from(jellyTeamContact)
        .where(
          and(
            eq(jellyTeamContact.email, userEmail),
            eq(jellyTeamContact.jellyTeamId, teamIdOf({ team })),
          ),
        );
      if (!teamMember || teamMember.length === 0 || !teamMember[0]?.role) {
        throw new ORPCError("FORBIDDEN");
      }
      role = teamMember[0].role;
      if (role !== "member" && role !== "admin" && role !== "owner") {
        throw new ORPCError("FORBIDDEN");
      }
      return next({
        context: {
          session: context.session,
          team,
        },
      });
    } catch {
      throw new ORPCError("FORBIDDEN");
    }
  },
);

export const mailboxScopedProcedure = authO
  .use(requireAuthOrApiKeyOrWebhook)
  .use(async ({ context, next }) => {
    let allowedMailboxIds: string[];
    let role: string | null = null;
    const team = await teamForContext(context);

    if ("apiKey" in context) {
      // A mailbox id is unique within a team, not across teams, so a key's
      // mailbox scopes cannot be taken at face value once the key can act in
      // more than one team: two teams with a mailbox of the same name would
      // otherwise share the scope. Intersect with the mailboxes Marmalade
      // actually manages for the active team.
      if (context.apiKey.mailboxIds.includes("*")) {
        allowedMailboxIds = ["*"];
      } else if (context.apiKey.teamIds.length < 2) {
        allowedMailboxIds = context.apiKey.mailboxIds;
      } else if (context.apiKey.mailboxIds.length === 0) {
        allowedMailboxIds = [];
      } else {
        const rows = await db
          .select({ jellyMailboxId: marmaladeMailbox.jellyMailboxId })
          .from(marmaladeMailbox)
          .where(
            and(
              eq(marmaladeMailbox.jellyTeamId, teamIdOf({ team })),
              inArray(
                marmaladeMailbox.jellyMailboxId,
                context.apiKey.mailboxIds,
              ),
            ),
          );
        allowedMailboxIds = rows.map((row) => row.jellyMailboxId);
      }
    } else if ("session" in context && !!context.session) {
      const teamMember = await db
        .select({ role: jellyTeamContact.role })
        .from(jellyTeamContact)
        .where(
          and(
            eq(jellyTeamContact.email, context.session.user.email),
            eq(jellyTeamContact.jellyTeamId, teamIdOf({ team })),
          ),
        );
      role = teamMember[0]?.role ?? null;
      if (role === "admin" || role === "owner") {
        allowedMailboxIds = ["*"];
      } else {
        // `mailbox_member` is the gate: it is the row "Grant api perms"
        // writes, and the row "Rescind access" removes.
        //
        // This previously resolved access from `jelly_mailbox_member` — Jelly
        // mailbox membership — and never read `mailbox_member` at all. The
        // grant/rescind UI therefore wrote a table no authorization check
        // consulted: the badge was accurate about the table's contents, and
        // the table decided nothing. Rescinding access removed nothing.
        //
        // Jelly membership is deliberately not also required. It is only
        // populated by a manual resync, so treating stale sync data as an
        // authorization input would deny people an admin had explicitly
        // granted. The consequence to know: removing someone from a mailbox
        // in Jelly does not revoke their Marmalade access on its own —
        // an admin has to rescind it here too.
        const rows = await db
          .select({ jellyMailboxId: marmaladeMailbox.jellyMailboxId })
          .from(marmaladeMailbox)
          .innerJoin(
            marmaladeMailboxMember,
            and(
              eq(
                marmaladeMailboxMember.marmaladeMailboxId,
                marmaladeMailbox.id,
              ),
              eq(
                marmaladeMailboxMember.marmaladeUserId,
                context.session.user.id,
              ),
            ),
          )
          .where(
            and(
              eq(marmaladeMailbox.active, true),
              eq(marmaladeMailbox.jellyTeamId, teamIdOf({ team })),
            ),
          );
        allowedMailboxIds = [...new Set(rows.map((r) => r.jellyMailboxId))];
      }
    } else {
      allowedMailboxIds = ["*"];
    }

    return next({ context: { ...context, team, allowedMailboxIds, role } });
  });

export function requireMailboxAccess(
  context: AppContext & { allowedMailboxIds: string[] },
  jellyMailboxId: string,
) {
  if (context.allowedMailboxIds.includes("*")) return;
  if (!context.allowedMailboxIds.includes(jellyMailboxId)) {
    throw new ORPCError("FORBIDDEN", {
      message: "Not authorized for this mailbox",
    });
  }
}

export function checkRouterScope(context: AppContext, routerName: string) {
  const hasSession =
    "session" in context && Boolean((context as any).session?.user);
  const hasWebhook = "request" in context && "rawBody" in context;

  if (hasSession || hasWebhook) return;

  if ("apiKey" in context && context.apiKey) {
    const { resourceScopes } = context.apiKey;
    if (resourceScopes.includes("*") || resourceScopes.includes(routerName))
      return;
  }

  throw new ORPCError("FORBIDDEN", {
    message: `Not authorized for router: ${routerName}`,
  });
}

export function filterFieldsByScope<T extends Record<string, any>>(
  context: AppContext,
  resourceType: string,
  data: T,
): T {
  if ("session" in context || ("request" in context && "rawBody" in context)) {
    return data;
  }

  if ("apiKey" in context && context.apiKey) {
    const { fieldScopes } = context.apiKey;
    const allowedFields = fieldScopes
      .filter((f) => f.resourceType === resourceType)
      .map((f) => f.field);

    if (allowedFields.length === 0) {
      return data;
    }

    const alwaysInclude = NON_SCOPABLE_FIELDS[resourceType] ?? [];
    const filtered: Record<string, any> = {};
    for (const key of Object.keys(data)) {
      if (
        allowedFields.includes(key) ||
        allowedFields.includes("*") ||
        alwaysInclude.includes(key)
      ) {
        filtered[key] = data[key];
      }
    }
    return filtered as T;
  }

  return data;
}
