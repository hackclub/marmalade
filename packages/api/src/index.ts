import { ORPCError, os } from "@orpc/server";

import { db } from "@marmalade-v2/db";
import { jellyTeamMember } from "@marmalade-v2/db/schema/team";
import { env } from "@marmalade-v2/env/server";
import { and, eq } from "drizzle-orm";
import type { AuthContext, WebhookContext } from "./context";

export const authO = os.$context<AuthContext>();
export const webhookO = os.$context<WebhookContext>();

export const publicProcedure = authO;

export const jellyWebhookProcedure = webhookO;

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

export const protectedProcedure = publicProcedure.use(requireAuth);
export const teamAdminProtectedProcedure = protectedProcedure.use(
  async ({ context, next }) => {
    const userEmail = context.session.user.email;
    let role;
    try {
      const teamMember = await db
        .select()
        .from(jellyTeamMember)
        .where(
          and(
            eq(jellyTeamMember.email, userEmail),
            eq(jellyTeamMember.jellyTeamId, env.JELLY_TEAM_ID),
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
    } catch (e) {
      throw new ORPCError("FORBIDDEN");
    }
  },
);
