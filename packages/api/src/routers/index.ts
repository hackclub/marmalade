import { ORPCError, type RouterClient } from "@orpc/server";

import { db } from "@marmalade-v2/db";
import { jellyTeamContact } from "@marmalade-v2/db/schema/team";
import { env } from "@marmalade-v2/env/server";
import { and, eq } from "drizzle-orm";
import { protectedProcedure, publicProcedure } from "../index";
import { apiKeyRouter } from "./api";
import { conversationRouter } from "./convo";
import { mailboxRouter } from "./mailbox";
import { teamRouter } from "./team";

export const appRouter = {
  healthCheck: publicProcedure
    .route({ method: "GET", path: "/health" })
    .handler(() => {
      return "OK";
    }),
  privateData: protectedProcedure
    .route({ method: "GET", path: "/me" })
    .handler(({ context }) => {
      return {
        message: "This is private",
        user: context.session?.user,
      };
    }),
  membershipInfo: protectedProcedure
    .route({ method: "GET", path: "/membership" })
    .handler(async ({ context }) => {
      const teamMember = await db
        .select()
        .from(jellyTeamContact)
        .where(
          and(
            eq(jellyTeamContact.email, context.session?.user.email ?? ""),
            eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID),
            eq(jellyTeamContact.existsInJelly, true),
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
  apiKey: apiKeyRouter,
  convo: conversationRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
