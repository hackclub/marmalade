import { ORPCError, type RouterClient } from "@orpc/server";

import { db } from "@marmalade-v2/db";
import { jellyTeamMember } from "@marmalade-v2/db/schema/team";
import { and, eq } from "drizzle-orm";
import { protectedProcedure, publicProcedure } from "../index";
import { mailboxRouter } from "./mailbox";
import { teamRouter } from "./team";
import { env } from "@marmalade-v2/env/server";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  privateData: protectedProcedure.handler(({ context }) => {
    return {
      message: "This is private",
      user: context.session?.user,
    };
  }),
  membershipInfo: protectedProcedure.handler(async ({ context }) => {
    const teamMember = await db
      .select()
      .from(jellyTeamMember)
      .where(
        and(
          eq(jellyTeamMember.email, context.session?.user.email ?? ""),
          eq(jellyTeamMember.jellyTeamId, env.JELLY_TEAM_ID),
          eq(jellyTeamMember.existsInJelly, true),
        ),
      );

    if (!teamMember || teamMember.length === 0 || !teamMember[0]) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "User is not a member of the team",
      });
    }
    return teamMember[0];
  }),

  mailbox: mailboxRouter,
  team: teamRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
