import { ORPCError, type RouterClient } from "@orpc/server";

import { db } from "@marmalade-v2/db";
import { jellyTeamContact } from "@marmalade-v2/db/schema/team";
import { env } from "@marmalade-v2/env/server";
import { and, eq } from "drizzle-orm";
import z from "zod";
import { publicProcedure, teamMemberProtectedProcedure } from "../index";
import { teamMemberSchema } from "../schemas/output";
import { apiKeyRouter } from "./api";
import { conversationRouter } from "./convo";
import { mailboxRouter } from "./mailbox";
import { teamRouter } from "./team";

export const appRouter = {
  healthCheck: publicProcedure
    .route({ method: "GET", path: "/health" })
    .output(z.literal("OK"))
    .handler(() => {
      return "OK";
    }),
  privateData: teamMemberProtectedProcedure
    .route({ method: "GET", path: "/me" })
    .output(
      z.object({
        message: z.string(),
        user: z
          .object({
            id: z.string(),
            name: z.string(),
            email: z.string(),
            image: z.string().nullable().optional(),
          })
          .nullable(),
      }),
    )
    .handler(({ context }) => {
      return {
        message: "This is private",
        user: context.session?.user,
      };
    }),
  membershipInfo: teamMemberProtectedProcedure
    .route({ method: "GET", path: "/membership" })
    .output(teamMemberSchema)
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
