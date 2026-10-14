import { db } from "@marmalade-v2/db";
import { auditLog } from "@marmalade-v2/db/schema/audit";
import { jellyTeam } from "@marmalade-v2/db/schema/team";
import { env } from "@marmalade-v2/env/server";
import { ORPCError, call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import z from "zod";

import { instanceAdminProcedure } from "../index";
import { credentialHint } from "../lib/crypto";
import { createJellyClient } from "../lib/jelly";
import { ensureTeamSlug, slugify } from "../lib/team";
import {
  invalidateTeamCredentials,
  setTeamApiToken,
  setTeamWebhookSecret,
} from "../lib/team-credentials";
import { mailboxRouter } from "./mailbox";
import { teamRouter } from "./team";

const teamSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string().nullable(),
  apiBaseUrl: z.string(),
  active: z.boolean(),
  dailyCeiling: z.number(),
  hasApiToken: z.boolean(),
  hasWebhookSecret: z.boolean(),
  onboardedAt: z.date().nullable(),
  firstWebhookAt: z.date().nullable(),
  webhookUrl: z.string(),
});

function webhookUrlFor(slug: string) {
  return `${env.BETTER_AUTH_URL}/api/webhook/jelly/${slug}`;
}

/**
 * Instance operation: the surface that is about Marmalade rather than about
 * any one Jelly team.
 *
 * Deliberately separate from `teamCredentials`, which is the same operations
 * scoped to the caller's own team. Onboarding a team, seeing across teams and
 * holding credentials for a team the operator is not a member of cannot be
 * derived from a Jelly role, because no Jelly team should be able to grant
 * itself authority over another.
 */
export const instanceRouter = {
  listTeams: instanceAdminProcedure
    .route({ method: "GET", path: "/instance/teams" })
    .output(z.array(teamSummarySchema))
    .handler(async () => {
      const rows = await db.select().from(jellyTeam);
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug ?? row.id,
        name: row.name,
        apiBaseUrl: row.apiBaseUrl,
        active: row.active,
        dailyCeiling: row.dailyCeiling,
        hasApiToken: Boolean(row.apiTokenEncrypted),
        hasWebhookSecret: Boolean(row.webhookSecretEncrypted),
        onboardedAt: row.onboardedAt,
        firstWebhookAt: row.firstWebhookAt,
        webhookUrl: webhookUrlFor(row.slug ?? row.id),
      }));
    }),

  /**
   * Connect a Jelly team. A form, not a deploy — which is the whole point of
   * moving credentials onto the row.
   *
   * The token is validated against Jelly before anything is stored. A team
   * onboarded with a bad token looks connected and silently never syncs, and
   * the cause surfaces much later as an unexplained empty mirror.
   */
  onboardTeam: instanceAdminProcedure
    .route({ method: "POST", path: "/instance/teams" })
    .input(
      z.object({
        /** Jelly's own team id. It is the value stored in every `jelly_team_id`. */
        id: z.string().min(1),
        slug: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        token: z.string().min(8),
        apiBaseUrl: z.url().optional(),
        dailyCeiling: z.number().int().positive().optional(),
      }),
    )
    .output(
      z.object({
        team: teamSummarySchema,
        /**
         * Shown once. Marmalade generates it rather than waiting for Jelly's,
         * so the operator can finish the Jelly side in the same sitting.
         */
        webhookSecret: z.string(),
        memberCount: z.number(),
      }),
    )
    .handler(async ({ input, context }) => {
      const existing = await db
        .select({ id: jellyTeam.id })
        .from(jellyTeam)
        .where(eq(jellyTeam.id, input.id))
        .limit(1);
      if (existing.length > 0) {
        throw new ORPCError("CONFLICT", {
          message: `Team ${input.id} is already connected`,
        });
      }

      const apiBaseUrl = input.apiBaseUrl ?? env.JELLY_API_URL;

      let memberCount: number;
      try {
        const probe = createJellyClient(apiBaseUrl, input.token);
        memberCount = (await probe.listMembers()).length;
      } catch (error) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Jelly rejected this token: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }

      const slug = slugify(input.slug ?? input.name ?? input.id);
      const slugTaken = await db
        .select({ id: jellyTeam.id })
        .from(jellyTeam)
        .where(eq(jellyTeam.slug, slug))
        .limit(1);
      if (slugTaken.length > 0) {
        throw new ORPCError("CONFLICT", {
          message: `The slug ${slug} is already in use`,
        });
      }

      await db.insert(jellyTeam).values({
        id: input.id,
        slug,
        name: input.name ?? null,
        apiBaseUrl,
        dailyCeiling: input.dailyCeiling,
        active: true,
        onboardedAt: new Date(),
      });

      await setTeamApiToken(input.id, input.token);

      const webhookSecret = randomBytes(32).toString("hex");
      await setTeamWebhookSecret(input.id, webhookSecret);

      // First sync for this team only. Teams already connected are untouched,
      // so onboarding costs one team's worth of Jelly requests rather than
      // every team's.
      const syncContext = {
        ...context,
        team: toTeam(input.id, slug, apiBaseUrl, input.dailyCeiling),
      };
      try {
        await call(teamRouter.resync, {}, { context: syncContext });
        await call(mailboxRouter.resync, {}, { context: syncContext });
      } catch (error) {
        // The team is connected and its credentials are valid; a sync that
        // fails here is recoverable by pressing resync. Losing the webhook
        // secret, which is shown once, is not.
        console.error("First sync failed for team", input.id, error);
      }

      await db.insert(auditLog).values({
        userId: context.session.user.id,
        jellyTeamId: input.id,
        action: "onboard_team",
        resource: "jelly_team",
        resourceId: input.id,
        status: "success",
        ipAddress: context.session.session.ipAddress ?? null,
        userAgent: context.session.session.userAgent ?? null,
        metadata: {
          slug,
          apiBaseUrl,
          tokenHint: credentialHint(input.token),
          memberCount,
        },
      });

      const [row] = await db
        .select()
        .from(jellyTeam)
        .where(eq(jellyTeam.id, input.id))
        .limit(1);

      return {
        team: {
          id: row!.id,
          slug: row!.slug ?? row!.id,
          name: row!.name,
          apiBaseUrl: row!.apiBaseUrl,
          active: row!.active,
          dailyCeiling: row!.dailyCeiling,
          hasApiToken: Boolean(row!.apiTokenEncrypted),
          hasWebhookSecret: Boolean(row!.webhookSecretEncrypted),
          onboardedAt: row!.onboardedAt,
          firstWebhookAt: row!.firstWebhookAt,
          webhookUrl: webhookUrlFor(row!.slug ?? row!.id),
        },
        webhookSecret,
        memberCount,
      };
    }),

  setTeamActive: instanceAdminProcedure
    .route({ method: "POST", path: "/instance/teams/{id}/active" })
    .input(z.object({ id: z.string().min(1), active: z.boolean() }))
    .output(z.object({ message: z.string() }))
    .handler(async ({ input, context }) => {
      const updated = await db
        .update(jellyTeam)
        .set({ active: input.active })
        .where(eq(jellyTeam.id, input.id))
        .returning({ id: jellyTeam.id });
      if (updated.length === 0) {
        throw new ORPCError("NOT_FOUND", { message: "Team not found" });
      }

      invalidateTeamCredentials(input.id);

      await db.insert(auditLog).values({
        userId: context.session.user.id,
        jellyTeamId: input.id,
        action: input.active ? "activate_team" : "deactivate_team",
        resource: "jelly_team",
        resourceId: input.id,
        status: "success",
        ipAddress: context.session.session.ipAddress ?? null,
        userAgent: context.session.session.userAgent ?? null,
      });

      return {
        message: input.active ? "Team activated" : "Team deactivated",
      };
    }),

  /** Give a team a slug, or repair one that predates the column. */
  ensureSlug: instanceAdminProcedure
    .route({ method: "POST", path: "/instance/teams/{id}/slug" })
    .input(z.object({ id: z.string().min(1) }))
    .output(z.object({ slug: z.string(), webhookUrl: z.string() }))
    .handler(async ({ input }) => {
      const slug = await ensureTeamSlug(input.id);
      return { slug, webhookUrl: webhookUrlFor(slug) };
    }),
};

/** The minimum a resync needs to act on a team that was just created. */
function toTeam(
  id: string,
  slug: string,
  apiBaseUrl: string,
  dailyCeiling = 80_000,
) {
  return { id, slug, name: null, apiBaseUrl, dailyCeiling, active: true };
}
