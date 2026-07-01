import { ORPCError, os } from "@orpc/server";

import { db } from "@marmalade-v2/db";
import { jellyTeamMember } from "@marmalade-v2/db/schema/team";
import { env } from "@marmalade-v2/env/server";
import { and, eq } from "drizzle-orm";
import type { Context } from "./context";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
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
      console.log("teamMember", teamMember);
      if (!teamMember || teamMember.length === 0 || !teamMember[0]?.role) {
        throw new ORPCError("FORBIDDEN");
      }
      role = teamMember[0].role;
      console.log("role", role);
      if (role !== "admin" && role !== "owner") {
        throw new ORPCError("FORBIDDEN");
      }
      return next({
        context: {
          session: context.session,
        },
      });
    } catch (e) {
      console.log(e);
      throw new ORPCError("FORBIDDEN");
    }
  },
);
