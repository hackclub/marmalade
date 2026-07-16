import { ORPCError, os } from "@orpc/server";

import { db } from "@marmalade-v2/db";
import {
  jellyMailbox,
  jellyMailboxMember,
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

const requireApiKeyAuth = authOrApiKeyOrWebhookO.middleware(
  async ({ context, next }) => {
    const hasSession = "session" in context && Boolean(context.session?.user);
    const hasApiKey = "apiKey" in context && Boolean(context.apiKey);
    if (!hasSession && !hasApiKey) {
      throw new ORPCError("UNAUTHORIZED");
    }
    return next({ context });
  },
);
export const apiKeyOrSessionProcedure =
  authOrApiKeyOrWebhookO.use(requireApiKeyAuth);

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
        const rows = await db
          .select({ jellyMailboxId: jellyMailbox.jellyMailboxId })
          .from(jellyMailbox)
          .innerJoin(
            jellyMailboxMember,
            eq(jellyMailbox.jellyMailboxId, jellyMailboxMember.jellyMailboxId),
          )
          .innerJoin(
            jellyTeamContact,
            and(
              eq(jellyMailboxMember.jellyContactId, jellyTeamContact.id),
              eq(jellyTeamContact.email, context.session.user.email),
              eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID),
            ),
          );
        allowedMailboxIds = rows.map((r) => r.jellyMailboxId);
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
      if (allowedFields.includes(key) || allowedFields.includes("*") || alwaysInclude.includes(key)) {
        filtered[key] = data[key];
      }
    }
    return filtered as T;
  }

  return data;
}
