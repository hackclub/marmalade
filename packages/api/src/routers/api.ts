import { db } from "@marmalade-v2/db";
import { apiKey, apiKeyScope } from "@marmalade-v2/db/schema/api";
import { user as authUser } from "@marmalade-v2/db/schema/auth";
import { jellyTeamContact } from "@marmalade-v2/db/schema/team";
import { env } from "@marmalade-v2/env/server";
import { ORPCError } from "@orpc/client";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import z from "zod";
import { hashSecret } from "../context";
import { mailboxScopedProcedure, protectedProcedure, teamAdminProtectedProcedure } from "../index";
import { auditRouter } from "./audit";
import { call } from "@orpc/server";

const KEY_PREFIX_LENGTH = 8;

async function listKeysForMailbox(mailboxId: string, teamId: string, createdBy?: string) {
  const conditions = [eq(apiKeyScope.scopeMailbox, mailboxId), eq(apiKey.jellyTeamId, teamId)];
  if (createdBy) {
    conditions.push(eq(apiKey.createdBy, createdBy));
  }
  const rows = await db
    .select({
      id: apiKey.id,
      keyPrefix: apiKey.keyPrefix,
      name: apiKey.name,
      description: apiKey.description,
      active: apiKey.active,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt,
      expiresAt: apiKey.expiresAt,
      revokedAt: apiKey.revokedAt,
      scopeMailbox: apiKeyScope.scopeMailbox,
    })
    .from(apiKey)
    .innerJoin(apiKeyScope, eq(apiKey.id, apiKeyScope.apiKeyId))
    .where(and(...conditions));

  return aggregateKeys(rows);
}

async function listKeysForTeam(teamId: string, createdBy?: string) {
  const conditions = [eq(apiKey.jellyTeamId, teamId)];
  if (createdBy) {
    conditions.push(eq(apiKey.createdBy, createdBy));
  }
  const rows = await db
    .select({
      id: apiKey.id,
      keyPrefix: apiKey.keyPrefix,
      name: apiKey.name,
      description: apiKey.description,
      active: apiKey.active,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt,
      expiresAt: apiKey.expiresAt,
      revokedAt: apiKey.revokedAt,
      scopeMailbox: apiKeyScope.scopeMailbox,
      createdByName: authUser.name,
    })
    .from(apiKey)
    .leftJoin(apiKeyScope, eq(apiKey.id, apiKeyScope.apiKeyId))
    .leftJoin(authUser, eq(apiKey.createdBy, authUser.id))
    .where(and(...conditions));

  return aggregateKeys(rows);
}

function aggregateKeys(rows: Array<{
  id: number;
  keyPrefix: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  scopeMailbox: string | null;
  createdByName?: string | null;
}>) {
  const keyMap = new Map<number, {
    id: number;
    keyPrefix: string;
    name: string;
    description: string | null;
    active: boolean;
    createdAt: Date;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    mailboxIds: string[];
    createdByName: string | null;
  }>();

  for (const row of rows) {
    const existing = keyMap.get(row.id);
    if (existing) {
      if (row.scopeMailbox) existing.mailboxIds.push(row.scopeMailbox);
    } else {
      keyMap.set(row.id, {
        id: row.id,
        keyPrefix: row.keyPrefix,
        name: row.name,
        description: row.description,
        active: row.active,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        mailboxIds: row.scopeMailbox ? [row.scopeMailbox] : [],
        createdByName: row.createdByName ?? null,
      });
    }
  }

  return Array.from(keyMap.values());
}

export const apiKeyRouter = {
  create: mailboxScopedProcedure
    .route({ method: "POST", path: "/team/{teamId}/mailboxes/{mailboxId}/keys" })
    .input(
      z.object({
        mailboxId: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        mailboxIds: z.array(z.string().min(1)).optional(),
        expiresAt: z.string().datetime().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const ctx = context as any;
      if (!ctx.allowedMailboxIds) {
        throw new ORPCError("UNAUTHORIZED");
      }

      const targetMailboxIds = input.mailboxIds ?? [input.mailboxId];

      for (const mbId of targetMailboxIds) {
        if (
          !ctx.allowedMailboxIds.includes("*") &&
          !ctx.allowedMailboxIds.includes(mbId)
        ) {
          throw new ORPCError("FORBIDDEN", {
            message: `Not authorized for mailbox ${mbId}`,
          });
        }
      }

      const secret = randomBytes(32).toString("hex");
      const keyPrefix = secret.slice(0, KEY_PREFIX_LENGTH);
      const secretHash = hashSecret(secret);

      const userId =
        "session" in ctx ? ctx.session?.user.id : "apiKey" in ctx ? `api-key:${ctx.apiKey.id}` : "webhook";
      const teamId = "apiKey" in ctx ? ctx.apiKey.jellyTeamId : env.JELLY_TEAM_ID;

      const [key] = await db
        .insert(apiKey)
        .values({
          keyPrefix,
          secretHash,
          name: input.name,
          description: input.description ?? null,
          createdBy: userId,
          jellyTeamId: teamId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        })
        .returning({ id: apiKey.id });

      if (!key) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to create API key",
        });
      }

      await db.insert(apiKeyScope).values(
        targetMailboxIds.map((mbId) => ({
          apiKeyId: key.id,
          scopeMailbox: mbId,
        })),
      );

      if ("session" in ctx) {
        await call(
          auditRouter.create,
          {
            resource: "api_key",
            action: "create",
            resourceId: key.id.toString(),
          },
          { context: ctx },
        );
      }

      return {
        id: key.id,
        keyPrefix,
        secret,
        name: input.name,
        mailboxIds: targetMailboxIds,
        expiresAt: input.expiresAt ?? null,
      };
    }),

  createTeam: teamAdminProtectedProcedure
    .route({ method: "POST", path: "/team/{teamId}/keys" })
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        expiresAt: z.string().datetime().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const secret = randomBytes(32).toString("hex");
      const keyPrefix = secret.slice(0, KEY_PREFIX_LENGTH);
      const secretHash = hashSecret(secret);

      const [key] = await db
        .insert(apiKey)
        .values({
          keyPrefix,
          secretHash,
          name: input.name,
          description: input.description ?? null,
          createdBy: context.session.user.id,
          jellyTeamId: env.JELLY_TEAM_ID,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        })
        .returning({ id: apiKey.id });

      if (!key) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to create API key",
        });
      }

      await call(
        auditRouter.create,
        {
          resource: "api_key",
          action: "create",
          resourceId: key.id.toString(),
        },
        { context },
      );

      return {
        id: key.id,
        keyPrefix,
        secret,
        name: input.name,
        mailboxIds: [],
        expiresAt: input.expiresAt ?? null,
      };
    }),

  listMailbox: mailboxScopedProcedure
    .route({ method: "GET", path: "/team/{teamId}/mailboxes/{mailboxId}/keys" })
    .input(
      z.object({
        mailboxId: z.string().min(1),
      }),
    )
    .handler(async ({ input, context }) => {
      const ctx = context as any;
      if (!ctx.allowedMailboxIds) {
        throw new ORPCError("UNAUTHORIZED");
      }

      if (
        !ctx.allowedMailboxIds.includes("*") &&
        !ctx.allowedMailboxIds.includes(input.mailboxId)
      ) {
        throw new ORPCError("FORBIDDEN", {
          message: "Not authorized for this mailbox",
        });
      }

      const teamId = "apiKey" in ctx ? ctx.apiKey.jellyTeamId : "";
      const isAdmin = ctx.role === "admin" || ctx.role === "owner";
      const createdBy = "session" in ctx && ctx.session?.user?.id
        ? (isAdmin ? undefined : ctx.session.user.id)
        : undefined;
      return listKeysForMailbox(input.mailboxId, teamId, createdBy);
    }),

  listTeam: protectedProcedure
    .route({ method: "GET", path: "/team/{teamId}/keys" })
    .handler(async ({ context }) => {
      const userEmail = (context as any).session?.user.email;
      const userId = (context as any).session?.user.id;
      const result = await db
        .select({ role: jellyTeamContact.role })
        .from(jellyTeamContact)
        .where(
          and(
            eq(jellyTeamContact.email, userEmail),
            eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID),
          ),
        );
      const role = result[0]?.role ?? null;
      const isAdmin = role === "admin" || role === "owner";
      return listKeysForTeam(env.JELLY_TEAM_ID, isAdmin ? undefined : userId);
    }),

  revokeTeamKey: protectedProcedure
    .route({ method: "POST", path: "/team/{teamId}/keys/{keyId}/revoke" })
    .input(z.object({ keyId: z.coerce.number().min(1) }))
    .handler(async ({ input, context }) => {
      const [key] = await db
        .select()
        .from(apiKey)
        .where(
          and(
            eq(apiKey.id, input.keyId),
            eq(apiKey.jellyTeamId, env.JELLY_TEAM_ID),
          ),
        );

      if (!key) {
        throw new ORPCError("NOT_FOUND", { message: "API key not found" });
      }

      if (key.revokedAt) {
        throw new ORPCError("CONFLICT", {
          message: "API key is already revoked",
        });
      }

      await db
        .update(apiKey)
        .set({ revokedAt: new Date(), active: false })
        .where(eq(apiKey.id, input.keyId));

      await call(
        auditRouter.create,
        {
          resource: "api_key",
          action: "revoke",
          resourceId: input.keyId.toString(),
        },
        { context },
      );

      return { message: "API key revoked" };
    }),

  revoke: mailboxScopedProcedure
    .route({ method: "DELETE", path: "/team/{teamId}/mailboxes/{mailboxId}/keys/{keyId}" })
    .input(
      z.object({
        mailboxId: z.string().min(1),
        keyId: z.coerce.number().min(1),
      }),
    )
    .handler(async ({ input, context }) => {
      const ctx = context as any;
      if (!ctx.allowedMailboxIds) {
        throw new ORPCError("UNAUTHORIZED");
      }

      if (
        !ctx.allowedMailboxIds.includes("*") &&
        !ctx.allowedMailboxIds.includes(input.mailboxId)
      ) {
        throw new ORPCError("FORBIDDEN", {
          message: "Not authorized for this mailbox",
        });
      }

      const [key] = await db
        .select()
        .from(apiKey)
        .innerJoin(apiKeyScope, eq(apiKey.id, apiKeyScope.apiKeyId))
        .where(
          and(
            eq(apiKey.id, input.keyId),
            eq(apiKeyScope.scopeMailbox, input.mailboxId),
          ),
        );

      if (!key) {
        throw new ORPCError("NOT_FOUND", { message: "API key not found" });
      }

      if (key.api_key.revokedAt) {
        throw new ORPCError("CONFLICT", {
          message: "API key is already revoked",
        });
      }

      await db
        .update(apiKey)
        .set({ revokedAt: new Date(), active: false })
        .where(eq(apiKey.id, input.keyId));

      if ("session" in ctx) {
        await call(
          auditRouter.create,
          {
            resource: "api_key",
            action: "revoke",
            resourceId: input.keyId.toString(),
          },
          { context: ctx },
        );
      }

      return { message: "API key revoked" };
    }),

  delete: teamAdminProtectedProcedure
    .route({ method: "DELETE", path: "/team/{teamId}/admin/keys/{keyId}" })
    .input(z.object({ keyId: z.coerce.number().min(1) }))
    .handler(async ({ input, context }) => {
      const [key] = await db
        .select()
        .from(apiKey)
        .where(eq(apiKey.id, input.keyId));

      if (!key) {
        throw new ORPCError("NOT_FOUND", { message: "API key not found" });
      }

      await db.delete(apiKey).where(eq(apiKey.id, input.keyId));

      await call(
        auditRouter.create,
        {
          resource: "api_key",
          action: "delete",
          resourceId: input.keyId.toString(),
        },
        { context },
      );

      return { message: "API key deleted" };
    }),
};
