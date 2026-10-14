import { auth } from "@marmalade-v2/auth";
import { db } from "@marmalade-v2/db";
import {
  apiKey,
  apiKeyFieldScope,
  apiKeyScope,
} from "@marmalade-v2/db/schema/api";
import { ORPCError } from "@orpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { jellyTeam } from "@marmalade-v2/db/schema/team";
import { env } from "@marmalade-v2/env/server";
import {
  resolveTeamById,
  resolveTeamBySlug,
  resolveTeamFromRequest,
  type ResolvedTeam,
} from "./lib/team";
import { getTeamWebhookSecret } from "./lib/team-credentials";

export async function createAuthContext({ req }: { req: Request }) {
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  // Unauthenticated and team-less routes exist — the health check and the
  // OpenAPI document among them — so having no resolvable team is not an
  // error here. It becomes one in `teamIdOf`, the moment a handler actually
  // needs a team, which is the only place that can tell.
  //
  // A request that *named* a team and was refused is different: swallowing
  // that would turn "you are not a member of this team" into the far less
  // useful "no team resolved" from whatever handler ran next.
  let team: ResolvedTeam | null = null;
  try {
    team = await resolveTeamFromRequest(req, session?.user.email);
  } catch (error) {
    if (error instanceof ORPCError && error.code !== "BAD_REQUEST") throw error;
    team = null;
  }

  return {
    auth: null,
    session,
    team,
  };
}

/**
 * `team` is declared nullable to match the session context.
 *
 * It is never null in a value this function returns — resolution above throws
 * first — but a router holds session, API key and webhook procedures side by
 * side, and oRPC intersects their context requirements. Were it non-nullable
 * here, every session-authenticated route in the same router would start
 * demanding a team that a health check does not have.
 */
type JellyWebhookContext = {
  rawBody: string;
  request: Request;
  team: ResolvedTeam | null;
};

/** Same reasoning as `JellyWebhookContext.team`: nullable to stay mergeable. */
type MarmaladeApiKeyContext = {
  team: ResolvedTeam | null;
  apiKey: {
    id: number;
    keyPrefix: string;
    name: string;
    mailboxIds: string[];
    resourceScopes: string[];
    fieldScopes: Array<{ resourceType: string; field: string }>;
    jellyTeamId: string;
  };
};

export async function createJellyWebhookContext({
  req,
  rawBody,
  slug,
}: {
  req: Request;
  rawBody: string;
  /**
   * Which team this delivery is for, from the endpoint URL.
   *
   * Jelly's payload carries no team identifier and the signing secret is
   * per-webhook-configuration, so the URL is the only thing that can route a
   * delivery. Absent on the legacy single-team endpoint.
   */
  slug?: string;
}): Promise<JellyWebhookContext> {
  // Basic auth on the webhook is optional in Jelly and currently unused; the
  // HMAC signature below is what authenticates the delivery.
  // const authHeader = req.headers.get("Authorization");
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

  // Resolve the team before verifying, not after: the secret is per team, so
  // there is no signature to check until it is known which team's secret to
  // check against.
  const team = slug
    ? await resolveTeamBySlug(slug)
    : await resolveDefaultWebhookTeam();
  if (!team) {
    throw new ORPCError("NOT_FOUND", {
      message: `Unknown team ${slug ?? ""}`.trim(),
    });
  }
  if (!team.active) {
    throw new ORPCError("FORBIDDEN", {
      message: `Jelly team ${team.id} is not active`,
    });
  }

  // Read from the team row, not the environment, so rotating a webhook secret
  // is a write rather than a redeploy. Falls back to the environment until the
  // team has adopted its credentials.
  const secret = await getTeamWebhookSecret(team.id);
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

  // A verified delivery is the only proof the Jelly side of the integration is
  // configured. Record the first one so "waiting for first webhook" is a fact
  // rather than an inference from a quiet mirror.
  await db
    .update(jellyTeam)
    .set({ firstWebhookAt: new Date() })
    .where(and(eq(jellyTeam.id, team.id), isNull(jellyTeam.firstWebhookAt)));

  return {
    rawBody,
    request: req,
    team,
  };
}

/**
 * The team for a delivery to the legacy `/api/webhook/jelly` endpoint, which
 * carries no slug.
 *
 * Kept so existing Jelly integrations do not break on deploy. It can only ever
 * mean the configured team: with several teams and no slug there is nothing in
 * the request to tell them apart, and guessing would attach one team's mail to
 * another.
 */
async function resolveDefaultWebhookTeam(): Promise<ResolvedTeam | null> {
  if (!env.JELLY_TEAM_ID) return null;
  return resolveTeamById(env.JELLY_TEAM_ID);
}

const KEY_PREFIX = "mrmld_";
const KEY_PREFIX_LENGTH = 8;

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export async function createApiKeyContext({
  req,
}: {
  req: Request;
}): Promise<MarmaladeApiKeyContext> {
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

  // The key row already names its team, which is why the public API needs no
  // team segment and no new header: existing integrations keep working
  // unchanged under multi-team.
  const team = await resolveTeamById(keyRow.jellyTeamId);
  if (!team) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "API key belongs to a team that is no longer connected",
    });
  }
  if (!team.active) {
    throw new ORPCError("FORBIDDEN", {
      message: `Jelly team ${team.id} is not active`,
    });
  }

  return {
    team,
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
