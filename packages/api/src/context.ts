import { auth } from "@marmalade-v2/auth";
import { db } from "@marmalade-v2/db";
import {
  apiKey,
  apiKeyFieldScope,
  apiKeyScope,
} from "@marmalade-v2/db/schema/api";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@marmalade-v2/env/server";

export async function createAuthContext({ req }: { req: Request }) {
  const session = await auth.api.getSession({
    headers: req.headers,
  });
  return {
    auth: null,
    session,
  };
}

export async function createJellyWebhookContext({
  req,
  rawBody,
}: {
  req: Request;
  rawBody: string;
}) {
  const authHeader = req.headers.get("Authorization");
  // if (!authHeader?.startsWith("Basic ")) {
  //   throw new ORPCError("UNAUTHORIZED", {
  //     message: "Invalid webhook credentials",
  //   });
  // }

  // const credentials = Buffer.from(authHeader.slice(6), "base64").toString(
  //   "utf-8",
  // );
  // const separatorIndex = credentials.indexOf(":");
  // if (separatorIndex === -1) {
  //   throw new ORPCError("UNAUTHORIZED", {
  //     message: "Invalid webhook credentials",
  //   });
  // }

  // const username = credentials.slice(0, separatorIndex);
  // const password = credentials.slice(separatorIndex + 1);

  // const expectedUser = env.WEBHOOK_USERNAME || "jelly";
  // const expectedPass = env.WEBHOOK_PASSWORD;
  // if (!expectedPass || username !== expectedUser || password !== expectedPass) {
  //   throw new ORPCError("UNAUTHORIZED", {
  //     message: "Invalid webhook credentials",
  //   });
  // }

  const signatureHeader = req.headers.get("X-Jelly-Signature");
  if (!signatureHeader) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid Jelly signature",
    });
  }

  const secret = env.JELLY_WEBHOOK_SECRET;
  if (!secret) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Jelly webhook secret is not configured",
    });
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const normalizedSignature = signatureHeader
    .trim()
    .toLowerCase()
    .replace(/^sha256=/, "");

  const expectedBuffer = Buffer.from(expectedSignature, "utf-8");
  const providedBuffer = Buffer.from(normalizedSignature, "utf-8");

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid Jelly signature",
    });
  }

  return {
    rawBody,
    request: req,
  };
}

const KEY_PREFIX = "mrmld_";
const KEY_PREFIX_LENGTH = 8;

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export async function createApiKeyContext({ req }: { req: Request }) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid API key",
    });
  }

  const token = authHeader.slice(7);
  if (!token.startsWith(KEY_PREFIX)) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid API key format",
    });
  }
  const rawKey = token.slice(KEY_PREFIX.length);
  if (rawKey.length < KEY_PREFIX_LENGTH) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid API key",
    });
  }

  const keyPrefix = rawKey.slice(0, KEY_PREFIX_LENGTH);
  const secretHash = hashSecret(rawKey);

  const rows = await db
    .select({
      id: apiKey.id,
      keyPrefix: apiKey.keyPrefix,
      name: apiKey.name,
      secretHash: apiKey.secretHash,
      jellyTeamId: apiKey.jellyTeamId,
      active: apiKey.active,
      expiresAt: apiKey.expiresAt,
      revokedAt: apiKey.revokedAt,
      lastUsedAt: apiKey.lastUsedAt,
      scopeResourceType: apiKeyScope.scopeResourceType,
      scopeResourceId: apiKeyScope.scopeResourceId,
      fieldScopeResourceType: apiKeyFieldScope.scopeResourceType,
      fieldScopeField: apiKeyFieldScope.scopeField,
    })
    .from(apiKey)
    .leftJoin(apiKeyScope, eq(apiKey.id, apiKeyScope.apiKeyId))
    .leftJoin(apiKeyFieldScope, eq(apiKey.id, apiKeyFieldScope.apiKeyId))
    .where(eq(apiKey.keyPrefix, keyPrefix));

  if (rows.length === 0) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid API key",
    });
  }

  const keyRow = rows[0]!;

  const providedHash = Buffer.from(secretHash, "utf-8");
  const storedHash = Buffer.from(keyRow.secretHash, "utf-8");
  if (
    providedHash.length !== storedHash.length ||
    !timingSafeEqual(providedHash, storedHash)
  ) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid API key",
    });
  }

  if (!keyRow.active) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "API key is not active",
    });
  }

  if (keyRow.revokedAt) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "API key has been revoked",
    });
  }

  if (keyRow.expiresAt && keyRow.expiresAt < new Date()) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "API key has expired",
    });
  }

  const mailboxIds: string[] = [];
  const resourceScopes: string[] = [];
  const fieldScopes: Array<{ resourceType: string; field: string }> = [];

  for (const row of rows) {
    if (!row.scopeResourceType || !row.scopeResourceId) continue;
    if (
      row.scopeResourceType === "mailbox" &&
      !mailboxIds.includes(row.scopeResourceId)
    ) {
      mailboxIds.push(row.scopeResourceId);
    }
    if (
      row.scopeResourceType === "router" &&
      !resourceScopes.includes(row.scopeResourceId)
    ) {
      resourceScopes.push(row.scopeResourceId);
    }
    if (row.fieldScopeResourceType && row.fieldScopeField) {
      if (
        !fieldScopes.some(
          (f) =>
            f.resourceType === row.fieldScopeResourceType &&
            f.field === row.fieldScopeField,
        )
      ) {
        fieldScopes.push({
          resourceType: row.fieldScopeResourceType,
          field: row.fieldScopeField,
        });
      }
    }
  }

  await db
    .update(apiKey)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKey.id, keyRow.id));

  return {
    apiKey: {
      id: keyRow.id,
      keyPrefix: keyRow.keyPrefix,
      name: keyRow.name,
      mailboxIds,
      resourceScopes,
      fieldScopes,
      jellyTeamId: keyRow.jellyTeamId,
    },
  };
}

export type AuthContext = Awaited<ReturnType<typeof createAuthContext>>;
export type ApiKeyContext = Awaited<ReturnType<typeof createApiKeyContext>>;
export type WebhookContext = Awaited<
  ReturnType<typeof createJellyWebhookContext>
>;
export type AppContext = AuthContext | ApiKeyContext | WebhookContext;
