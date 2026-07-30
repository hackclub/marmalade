import { db } from "@marm/db";
import {
  apiKey,
  apiKeyFieldScope,
  apiKeyScope,
} from "@marm/db/schema/api";
import { user as authUser } from "@marm/db/schema/auth";
import { jellyTeamContact } from "@marm/db/schema/team";
import { env } from "@marm/env/server";
import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  apiKeyCreateInputSchema,
  apiKeyCreateOutputSchema,
  apiKeyDeleteInputSchema,
  apiKeyDeleteOutputSchema,
  apiKeyListMailboxInputSchema,
  apiKeyListMailboxOutputSchema,
  apiKeyListTeamOutputSchema,
  apiKeyRevokeInputSchema,
  apiKeyRevokeOutputSchema,
  apiKeyRevokePublicInputSchema,
  apiKeyRevokePublicOutputSchema,
  apiKeyRevokeTeamKeyInputSchema,
  apiKeyRevokeTeamKeyOutputSchema,
  routes,
} from "@marm/contract/schemas/procedures";
import { hashSecret } from "../context";
import {
  mailboxScopedProcedure,
  publicProcedure,
  teamAdminProtectedProcedure,
  teamMemberProtectedProcedure,
} from "../index";
import { auditRouter } from "./audit";

const KEY_PREFIX = "mrmld_";
const KEY_PREFIX_LENGTH = 8;

async function getUniqueKeyName(
  baseName: string,
  teamId: string,
): Promise<string> {
  let candidate = baseName;
  let suffix = 1;
  while (true) {
    const [existing] = await db
      .select({ id: apiKey.id })
      .from(apiKey)
      .where(and(eq(apiKey.name, candidate), eq(apiKey.jellyTeamId, teamId)))
      .limit(1);
    if (!existing) return candidate;
    candidate = `${baseName}-${suffix}`;
    suffix++;
  }
}

async function listKeysForMailbox(
  mailboxId: string,
  teamId: string,
  createdBy?: string,
) {
  const conditions = [
    eq(apiKeyScope.scopeResourceType, "mailbox"),
    eq(apiKeyScope.scopeResourceId, mailboxId),
    eq(apiKey.jellyTeamId, teamId),
  ];
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
      scopeResourceType: apiKeyScope.scopeResourceType,
      scopeResourceId: apiKeyScope.scopeResourceId,
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
      scopeResourceType: apiKeyScope.scopeResourceType,
      scopeResourceId: apiKeyScope.scopeResourceId,
      fieldScopeResourceType: apiKeyFieldScope.scopeResourceType,
      fieldScopeField: apiKeyFieldScope.scopeField,
      createdByName: authUser.name,
    })
    .from(apiKey)
    .leftJoin(apiKeyScope, eq(apiKey.id, apiKeyScope.apiKeyId))
    .leftJoin(apiKeyFieldScope, eq(apiKey.id, apiKeyFieldScope.apiKeyId))
    .leftJoin(authUser, eq(apiKey.createdBy, authUser.id))
    .where(and(...conditions));

  return aggregateKeys(rows);
}

function aggregateKeys(
  rows: Array<{
    id: number;
    keyPrefix: string;
    name: string;
    description: string | null;
    active: boolean;
    createdAt: Date;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    scopeResourceType: string | null;
    scopeResourceId: string | null;
    fieldScopeResourceType?: string | null;
    fieldScopeField?: string | null;
    createdByName?: string | null;
  }>,
) {
  const keyMap = new Map<
    number,
    {
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
      resourceScopes: string[];
      fieldScopes: Array<{ resourceType: string; field: string }>;
      createdByName: string | null;
    }
  >();

  for (const row of rows) {
    const existing = keyMap.get(row.id);
    if (existing) {
      if (row.scopeResourceType === "mailbox" && row.scopeResourceId) {
        if (!existing.mailboxIds.includes(row.scopeResourceId)) {
          existing.mailboxIds.push(row.scopeResourceId);
        }
      }
      if (row.scopeResourceType === "router" && row.scopeResourceId) {
        if (!existing.resourceScopes.includes(row.scopeResourceId)) {
          existing.resourceScopes.push(row.scopeResourceId);
        }
      }
      if (row.fieldScopeResourceType && row.fieldScopeField) {
        const exists = existing.fieldScopes.some(
          (s) =>
            s.resourceType === row.fieldScopeResourceType &&
            s.field === row.fieldScopeField,
        );
        if (!exists) {
          existing.fieldScopes.push({
            resourceType: row.fieldScopeResourceType,
            field: row.fieldScopeField,
          });
        }
      }
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
        mailboxIds:
          row.scopeResourceType === "mailbox" && row.scopeResourceId
            ? [row.scopeResourceId]
            : [],
        resourceScopes:
          row.scopeResourceType === "router" && row.scopeResourceId
            ? [row.scopeResourceId]
            : [],
        fieldScopes:
          row.fieldScopeResourceType && row.fieldScopeField
            ? [
                {
                  resourceType: row.fieldScopeResourceType,
                  field: row.fieldScopeField,
                },
              ]
            : [],
        createdByName: row.createdByName ?? null,
      });
    }
  }

  return Array.from(keyMap.values());
}

export const apiKeyRouter = {
  create: mailboxScopedProcedure
    .route(routes.apiKey.create)
    .input(apiKeyCreateInputSchema)
    .output(apiKeyCreateOutputSchema)
    .handler(async ({ input, context }) => {
      const ctx = context as any;
      if (!ctx.allowedMailboxIds) {
        throw new ORPCError("UNAUTHORIZED");
      }

      const targetMailboxIds = input.mailboxIds ?? [];

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
        "session" in ctx
          ? ctx.session?.user.id
          : "apiKey" in ctx
            ? `api-key:${ctx.apiKey.id}`
            : "webhook";
      const teamId =
        "apiKey" in ctx ? ctx.apiKey.jellyTeamId : env.JELLY_TEAM_ID;

      const uniqueName = await getUniqueKeyName(input.name, teamId);

      const [key] = await db
        .insert(apiKey)
        .values({
          keyPrefix,
          secretHash,
          name: uniqueName,
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

      const scopes: Array<{
        apiKeyId: number;
        scopeResourceType: string;
        scopeResourceId: string;
      }> = [];

      for (const mbId of targetMailboxIds) {
        scopes.push({
          apiKeyId: key.id,
          scopeResourceType: "mailbox",
          scopeResourceId: mbId,
        });
      }

      if (input.resourceScopes) {
        for (const router of input.resourceScopes) {
          scopes.push({
            apiKeyId: key.id,
            scopeResourceType: "router",
            scopeResourceId: router,
          });
        }
      }

      if (scopes.length > 0) {
        await db.insert(apiKeyScope).values(scopes);
      }

      if (input.fieldScopes && input.fieldScopes.length > 0) {
        await db.insert(apiKeyFieldScope).values(
          input.fieldScopes.map((scope) => ({
            apiKeyId: key.id,
            scopeResourceType: scope.resourceType,
            scopeField: scope.field,
          })),
        );
      }

      await call(
        auditRouter.create,
        {
          resource: "api_key",
          action: "create",
          resourceId: key.id.toString(),
        },
        { context: ctx },
      );

      return {
        id: key.id,
        keyPrefix,
        secret: `${KEY_PREFIX}${secret}`,
        name: input.name,
        mailboxIds: targetMailboxIds,
        resourceScopes: input.resourceScopes ?? [],
        fieldScopes: input.fieldScopes ?? [],
        expiresAt: input.expiresAt ?? null,
      };
    }),

  listMailbox: mailboxScopedProcedure
    .route(routes.apiKey.listMailbox)
    .input(apiKeyListMailboxInputSchema)
    .output(apiKeyListMailboxOutputSchema)
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
      const createdBy =
        "session" in ctx && ctx.session?.user?.id
          ? isAdmin
            ? undefined
            : ctx.session.user.id
          : undefined;
      return listKeysForMailbox(input.mailboxId, teamId, createdBy);
    }),

  listTeam: teamMemberProtectedProcedure
    .route(routes.apiKey.listTeam)
    .output(apiKeyListTeamOutputSchema)
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

  revokeTeamKey: teamMemberProtectedProcedure
    .route(routes.apiKey.revokeTeamKey)
    .input(apiKeyRevokeTeamKeyInputSchema)
    .output(apiKeyRevokeTeamKeyOutputSchema)
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
    .route(routes.apiKey.revoke)
    .input(apiKeyRevokeInputSchema)
    .output(apiKeyRevokeOutputSchema)
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
            eq(apiKeyScope.scopeResourceType, "mailbox"),
            eq(apiKeyScope.scopeResourceId, input.mailboxId),
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

      await call(
        auditRouter.create,
        {
          resource: "api_key",
          action: "revoke",
          resourceId: input.keyId.toString(),
        },
        { context: ctx },
      );

      return { message: "API key revoked" };
    }),
  revokePublic: publicProcedure
    .route(routes.apiKey.revokePublic)
    .input(apiKeyRevokePublicInputSchema)
    .output(apiKeyRevokePublicOutputSchema)
    .handler(async ({ input, context }) => {
      if (!input.key.startsWith(KEY_PREFIX)) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Invalid API key format",
        });
      }
      const rawKey = input.key.slice(KEY_PREFIX.length);
      const keyPrefix = rawKey.slice(0, KEY_PREFIX_LENGTH);
      const [key] = await db
        .select()
        .from(apiKey)
        .where(eq(apiKey.keyPrefix, keyPrefix));

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
        .where(eq(apiKey.id, key.id));

      await call(
        auditRouter.create,
        {
          resource: "api_key",
          action: "revoke",
          resourceId: key.id.toString(),
          metadata: input.revoker
            ? { revoker: input.revoker }
            : { revoker: "public" },
        },
        { context },
      );

      return { message: "API key revoked" };
    }),

  delete: teamAdminProtectedProcedure
    .route(routes.apiKey.delete)
    .input(apiKeyDeleteInputSchema)
    .output(apiKeyDeleteOutputSchema)
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
