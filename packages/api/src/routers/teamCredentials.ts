import { db } from "@marmalade-v2/db";
import { auditLog } from "@marmalade-v2/db/schema/audit";
import { jellyTeam } from "@marmalade-v2/db/schema/team";
import { env } from "@marmalade-v2/env/server";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import z from "zod";
import { teamAdminProtectedProcedure } from "../index";
import { credentialHint, seal } from "../lib/crypto";
import { createJellyClient } from "../lib/jelly";
import {
  API_TOKEN_PURPOSE,
  WEBHOOK_SECRET_PURPOSE,
  invalidateTeamCredentials,
  setTeamApiToken,
  setTeamWebhookSecret,
} from "../lib/team-credentials";

/**
 * Credential management for a connected Jelly team.
 *
 * Nothing here ever returns a stored secret. Reads report whether a credential
 * is present and when it changed; that is enough to operate and audit, and a
 * decrypt endpoint would undo the point of encrypting the column.
 */
export const teamCredentialsRouter = {
  get: teamAdminProtectedProcedure
    .route({ method: "GET", path: "/admin/team" })
    .output(
      z.object({
        id: z.string(),
        name: z.string().nullable(),
        apiBaseUrl: z.string(),
        active: z.boolean(),
        hasApiToken: z.boolean(),
        hasWebhookSecret: z.boolean(),
        credentialsUpdatedAt: z.date().nullable(),
        /**
         * Where Jelly should POST webhooks for this team. Shown here so the
         * value an operator pastes into Jelly comes from the app rather than
         * from memory.
         */
        webhookUrl: z.string(),
      }),
    )
    .handler(async () => {
      const [row] = await db
        .select()
        .from(jellyTeam)
        .where(eq(jellyTeam.id, env.JELLY_TEAM_ID))
        .limit(1);

      if (!row) {
        throw new ORPCError("NOT_FOUND", {
          message: "This Jelly team has not been synced yet",
        });
      }

      return {
        id: row.id,
        name: row.name,
        apiBaseUrl: row.apiBaseUrl,
        active: row.active,
        hasApiToken: Boolean(row.apiTokenEncrypted),
        hasWebhookSecret: Boolean(row.webhookSecretEncrypted),
        credentialsUpdatedAt: row.credentialsUpdatedAt,
        webhookUrl: `${env.BETTER_AUTH_URL}/api/webhook/jelly`,
      };
    }),

  /**
   * Store a Jelly API token after proving it works.
   *
   * The token is validated against Jelly before anything is written: accepting
   * a bad token would leave the team unable to sync with no obvious cause, and
   * the failure would surface later as a mysterious 401 in the request log.
   */
  setApiToken: teamAdminProtectedProcedure
    .route({ method: "POST", path: "/admin/team/api-token" })
    .input(
      z.object({
        token: z.string().min(8),
        apiBaseUrl: z.url().optional(),
      }),
    )
    .output(
      z.object({
        message: z.string(),
        hint: z.string(),
        memberCount: z.number(),
      }),
    )
    .handler(async ({ input, context }) => {
      const apiBaseUrl = input.apiBaseUrl ?? env.JELLY_API_URL;

      let memberCount: number;
      try {
        const probe = createJellyClient(apiBaseUrl, input.token);
        memberCount = (await probe.listMembers()).length;
      } catch (error) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Jelly rejected this token: ${error instanceof Error ? error.message : String(error)}`,
        });
      }

      if (input.apiBaseUrl) {
        await db
          .update(jellyTeam)
          .set({ apiBaseUrl })
          .where(eq(jellyTeam.id, env.JELLY_TEAM_ID));
      }

      const { hint } = await setTeamApiToken(env.JELLY_TEAM_ID, input.token);

      await db.insert(auditLog).values({
        userId: context.session.user.id,
        jellyTeamId: env.JELLY_TEAM_ID,
        action: "set_api_token",
        resource: "jelly_team",
        resourceId: env.JELLY_TEAM_ID,
        status: "success",
        ipAddress: context.session.session.ipAddress ?? null,
        userAgent: context.session.session.userAgent ?? null,
        // The hint, never the token.
        metadata: { hint, apiBaseUrl },
      });

      return {
        message: "Jelly API token stored",
        hint,
        memberCount,
      };
    }),

  /**
   * Generate a webhook signing secret and return it exactly once, because the
   * operator has to paste it into Jelly's integration settings and it cannot
   * be read back afterwards.
   */
  rotateWebhookSecret: teamAdminProtectedProcedure
    .route({ method: "POST", path: "/admin/team/webhook-secret" })
    .output(
      z.object({
        message: z.string(),
        secret: z.string(),
        webhookUrl: z.string(),
      }),
    )
    .handler(async ({ context }) => {
      const secret = randomBytes(32).toString("hex");
      await setTeamWebhookSecret(env.JELLY_TEAM_ID, secret);

      await db.insert(auditLog).values({
        userId: context.session.user.id,
        jellyTeamId: env.JELLY_TEAM_ID,
        action: "rotate_webhook_secret",
        resource: "jelly_team",
        resourceId: env.JELLY_TEAM_ID,
        status: "success",
        ipAddress: context.session.session.ipAddress ?? null,
        userAgent: context.session.session.userAgent ?? null,
        metadata: { hint: credentialHint(secret) },
      });

      return {
        message:
          "Paste this into Jelly under Settings -> Integrations. It cannot be shown again.",
        secret,
        webhookUrl: `${env.BETTER_AUTH_URL}/api/webhook/jelly`,
      };
    }),

  /**
   * Store a webhook secret Jelly generated, rather than one of ours.
   *
   * Jelly auto-generates a signing secret when a webhook is created, so the
   * usual direction is Jelly -> Marmalade, not the other way around.
   */
  setWebhookSecret: teamAdminProtectedProcedure
    .route({ method: "PUT", path: "/admin/team/webhook-secret" })
    .input(z.object({ secret: z.string().min(8) }))
    .output(z.object({ message: z.string(), hint: z.string() }))
    .handler(async ({ input, context }) => {
      const { hint } = await setTeamWebhookSecret(
        env.JELLY_TEAM_ID,
        input.secret,
      );

      await db.insert(auditLog).values({
        userId: context.session.user.id,
        jellyTeamId: env.JELLY_TEAM_ID,
        action: "set_webhook_secret",
        resource: "jelly_team",
        resourceId: env.JELLY_TEAM_ID,
        status: "success",
        ipAddress: context.session.session.ipAddress ?? null,
        userAgent: context.session.session.userAgent ?? null,
        metadata: { hint },
      });

      return { message: "Webhook secret stored", hint };
    }),

  /**
   * Re-encrypt both credentials under the current `MARMALADE_ENCRYPTION_KEY`.
   *
   * Needed when the envelope format or the key itself changes; without it a
   * key rotation would mean re-entering every credential by hand.
   */
  reseal: teamAdminProtectedProcedure
    .route({ method: "POST", path: "/admin/team/reseal" })
    .input(
      z.object({
        apiToken: z.string().min(8).optional(),
        webhookSecret: z.string().min(8).optional(),
      }),
    )
    .output(z.object({ message: z.string(), resealed: z.array(z.string()) }))
    .handler(async ({ input, context }) => {
      const resealed: string[] = [];
      const patch: Record<string, unknown> = {
        credentialsUpdatedAt: new Date(),
      };

      if (input.apiToken) {
        patch.apiTokenEncrypted = seal(
          input.apiToken,
          env.JELLY_TEAM_ID,
          API_TOKEN_PURPOSE,
        );
        resealed.push("apiToken");
      }
      if (input.webhookSecret) {
        patch.webhookSecretEncrypted = seal(
          input.webhookSecret,
          env.JELLY_TEAM_ID,
          WEBHOOK_SECRET_PURPOSE,
        );
        resealed.push("webhookSecret");
      }

      if (resealed.length === 0) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Supply at least one credential to reseal",
        });
      }

      await db
        .update(jellyTeam)
        .set(patch)
        .where(eq(jellyTeam.id, env.JELLY_TEAM_ID));
      invalidateTeamCredentials(env.JELLY_TEAM_ID);

      await db.insert(auditLog).values({
        userId: context.session.user.id,
        jellyTeamId: env.JELLY_TEAM_ID,
        action: "reseal_credentials",
        resource: "jelly_team",
        resourceId: env.JELLY_TEAM_ID,
        status: "success",
        metadata: { resealed },
      });

      return { message: "Credentials resealed", resealed };
    }),
};
