import { ORPCError, os } from "@orpc/server";

import { db } from "@marmalade-v2/db";
import {
  marmaladeMailbox,
  marmaladeMailboxMember,
} from "@marmalade-v2/db/schema/mailbox";
import { jellyTeamContact } from "@marmalade-v2/db/schema/team";
import { env } from "@marmalade-v2/env/server";
import { and, eq } from "drizzle-orm";
import type {
  ApiKeyContext,
  AppContext,
  AuthContext,
  WebhookContext,
} from "./context";
import { NON_SCOPABLE_FIELDS } from "./schemas/output";

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
export const teamAdminProtectedProcedure = protectedProcedure.use(
  async ({ context, next }) => {
    const userEmail = context.session.user.email;
    let role;
    try {
      const teamMember = await db
        .select()
        .from(jellyTeamContact)
        .where(
          and(
            eq(jellyTeamContact.email, userEmail),
            eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID),
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
    let role;
    try {
      const teamMember = await db
        .select()
        .from(jellyTeamContact)
        .where(
          and(
            eq(jellyTeamContact.email, userEmail),
            eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID),
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

    if ("apiKey" in context) {
      allowedMailboxIds = context.apiKey.mailboxIds;
    } else if ("session" in context && !!context.session) {
      const teamMember = await db
        .select({ role: jellyTeamContact.role })
        .from(jellyTeamContact)
        .where(
          and(
            eq(jellyTeamContact.email, context.session.user.email),
            eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID),
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
              eq(marmaladeMailbox.jellyTeamId, env.JELLY_TEAM_ID),
            ),
          );
        allowedMailboxIds = [...new Set(rows.map((r) => r.jellyMailboxId))];
      }
    } else {
      allowedMailboxIds = ["*"];
    }

    return next({ context: { ...context, allowedMailboxIds, role } });
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

/**
 * Gate a mutating action on the caller's write scopes.
 *
 * Fails closed. `filterFieldsByScope` treats "no field scopes configured" as
 * "allow every field", which is a reasonable default for reads and a dangerous
 * one for writes — a read-only key must never gain write access because nobody
 * configured it. An empty `actionScopes` array means no writes, full stop.
 */
export function checkActionScope(context: AppContext, actionType: string) {
  // A signed-in team member acts as themselves. Their reach is bounded by
  // mailbox membership, which `mailboxScopedProcedure` has already resolved.
  if ("session" in context && Boolean(context.session?.user)) return;

  // Webhooks are inbound-only. Nothing Jelly sends us should turn into a
  // write back to Jelly without a human or a key behind it.
  if ("request" in context && "rawBody" in context) {
    throw new ORPCError("FORBIDDEN", {
      message: "Webhook context cannot perform write actions",
    });
  }

  if ("apiKey" in context && context.apiKey) {
    const actionScopes = context.apiKey.actionScopes ?? [];
    if (actionScopes.length === 0) {
      throw new ORPCError("FORBIDDEN", {
        message:
          "This API key is read-only. Grant it an action scope to perform writes.",
      });
    }
    if (actionScopes.includes("*")) return;
    if (actionScopes.includes(actionType)) return;
    const family = `${actionType.split(".")[0]}.*`;
    if (actionScopes.includes(family)) return;
  }

  throw new ORPCError("FORBIDDEN", {
    message: `Not authorized for action: ${actionType}`,
  });
}

/**
 * Writes require a second, independent opt-in: an admin must enable writes on
 * the Marmalade mailbox itself. Holding a write scope is not enough.
 */
export async function requireMailboxWritesEnabled(jellyMailboxId: string) {
  const [row] = await db
    .select({
      active: marmaladeMailbox.active,
      writesEnabled: marmaladeMailbox.writesEnabled,
    })
    .from(marmaladeMailbox)
    .where(
      and(
        eq(marmaladeMailbox.jellyMailboxId, jellyMailboxId),
        eq(marmaladeMailbox.jellyTeamId, env.JELLY_TEAM_ID),
      ),
    )
    .limit(1);

  if (!row) {
    throw new ORPCError("FORBIDDEN", {
      message: "This mailbox is not managed by Marmalade",
    });
  }
  if (!row.active) {
    throw new ORPCError("FORBIDDEN", {
      message: "This Marmalade mailbox is deactivated",
    });
  }
  if (!row.writesEnabled) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "Writes are not enabled for this mailbox. An admin must turn them on first.",
    });
  }
}

export type ResolvedActor = {
  actorType: "api_key" | "user" | "system";
  apiKeyId: number | null;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

export function resolveActor(context: AppContext): ResolvedActor {
  if ("apiKey" in context && context.apiKey) {
    return {
      actorType: "api_key",
      apiKeyId: context.apiKey.id,
      userId: null,
      ipAddress: null,
      userAgent: null,
    };
  }
  if ("session" in context && context.session?.user) {
    return {
      actorType: "user",
      apiKeyId: null,
      userId: context.session.user.id,
      ipAddress: context.session.session.ipAddress ?? null,
      userAgent: context.session.session.userAgent ?? null,
    };
  }
  return {
    actorType: "system",
    apiKeyId: null,
    userId: null,
    ipAddress: null,
    userAgent: null,
  };
}
