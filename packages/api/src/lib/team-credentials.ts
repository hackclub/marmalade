import { db } from "@marmalade-v2/db";
import { jellyTeam } from "@marmalade-v2/db/schema/team";
import { env } from "@marmalade-v2/env/server";
import { eq } from "drizzle-orm";
import { credentialHint, open, seal } from "./crypto";

export const API_TOKEN_PURPOSE = "jelly_api_token";
export const WEBHOOK_SECRET_PURPOSE = "jelly_webhook_secret";

export type TeamCredentials = {
  teamId: string;
  slug: string;
  name: string | null;
  apiBaseUrl: string;
  apiToken: string;
  active: boolean;
};

/**
 * Decrypted credentials are cached per team so that a request does not cost a
 * row read plus a decrypt. `credentialsUpdatedAt` is the cache key alongside
 * the id, so a rotation invalidates every instance's entry the next time it
 * reads the row, without any cross-process invalidation machinery.
 */
type CacheEntry = { stamp: number; value: TeamCredentials };
const cache = new Map<string, CacheEntry>();

export function invalidateTeamCredentials(teamId?: string): void {
  if (teamId) cache.delete(teamId);
  else cache.clear();
}

/**
 * One-time migration from the environment into the database.
 *
 * Deploys that still carry `JELLY_API_KEY` adopt it automatically on first
 * use, so moving credentials into `jelly_team` needs no manual step and no
 * window where the app cannot reach Jelly. Once the row is populated the
 * environment variable is ignored and can be deleted.
 */
async function adoptEnvCredentials(teamId: string): Promise<boolean> {
  if (!env.JELLY_API_KEY) return false;

  const values = {
    apiTokenEncrypted: seal(env.JELLY_API_KEY, teamId, API_TOKEN_PURPOSE),
    webhookSecretEncrypted: env.JELLY_WEBHOOK_SECRET
      ? seal(env.JELLY_WEBHOOK_SECRET, teamId, WEBHOOK_SECRET_PURPOSE)
      : undefined,
    credentialsUpdatedAt: new Date(),
  };

  await db
    .insert(jellyTeam)
    .values({
      id: teamId,
      slug: teamId,
      apiBaseUrl: env.JELLY_API_URL,
      ...values,
    })
    .onConflictDoUpdate({
      target: jellyTeam.id,
      set: values,
    });

  console.warn(
    `[marmalade] Adopted Jelly credentials for team ${teamId} from the environment ` +
      "into jelly_team. JELLY_API_KEY and JELLY_WEBHOOK_SECRET can now be removed.",
  );
  return true;
}

export async function getTeamCredentials(
  teamId: string,
): Promise<TeamCredentials> {
  const [row] = await db
    .select()
    .from(jellyTeam)
    .where(eq(jellyTeam.id, teamId))
    .limit(1);

  if (!row?.apiTokenEncrypted) {
    if (await adoptEnvCredentials(teamId)) {
      invalidateTeamCredentials(teamId);
      return getTeamCredentials(teamId);
    }
    throw new Error(
      `No Jelly API token stored for team ${teamId}. Set one through the admin API.`,
    );
  }

  const stamp = row.credentialsUpdatedAt?.getTime() ?? 0;
  const cached = cache.get(teamId);
  if (cached && cached.stamp === stamp) return cached.value;

  const value: TeamCredentials = {
    teamId: row.id,
    slug: row.slug,
    name: row.name,
    apiBaseUrl: row.apiBaseUrl,
    apiToken: open(row.apiTokenEncrypted, row.id, API_TOKEN_PURPOSE),
    active: row.active,
  };

  cache.set(teamId, { stamp, value });
  return value;
}

export async function getTeamWebhookSecret(
  teamId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ secret: jellyTeam.webhookSecretEncrypted })
    .from(jellyTeam)
    .where(eq(jellyTeam.id, teamId))
    .limit(1);

  if (row?.secret) {
    return open(row.secret, teamId, WEBHOOK_SECRET_PURPOSE);
  }
  // Bootstrap: a deploy that has not yet adopted its env credentials.
  return env.JELLY_WEBHOOK_SECRET ?? null;
}

export async function setTeamApiToken(
  teamId: string,
  token: string,
): Promise<{ hint: string }> {
  await db
    .update(jellyTeam)
    .set({
      apiTokenEncrypted: seal(token, teamId, API_TOKEN_PURPOSE),
      credentialsUpdatedAt: new Date(),
    })
    .where(eq(jellyTeam.id, teamId));

  invalidateTeamCredentials(teamId);
  return { hint: credentialHint(token) };
}

export async function setTeamWebhookSecret(
  teamId: string,
  secret: string,
): Promise<{ hint: string }> {
  await db
    .update(jellyTeam)
    .set({
      webhookSecretEncrypted: seal(secret, teamId, WEBHOOK_SECRET_PURPOSE),
      credentialsUpdatedAt: new Date(),
    })
    .where(eq(jellyTeam.id, teamId));

  invalidateTeamCredentials(teamId);
  return { hint: credentialHint(secret) };
}
