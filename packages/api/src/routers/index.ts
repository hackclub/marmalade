import { ORPCError, type RouterClient } from "@orpc/server";

import { db } from "@marm/db";
import { jellyTeamContact } from "@marm/db/schema/team";
import { env } from "@marm/env/server";
import { and, eq } from "drizzle-orm";
import { publicProcedure, teamMemberProtectedProcedure } from "../index";
import {
  healthCheckOutputSchema,
  membershipInfoOutputSchema,
  privateDataOutputSchema,
  routes,
} from "@marm/contract/schemas/procedures";
import { apiKeyRouter } from "./api";
import { conversationRouter } from "./convo";
import { mailboxRouter } from "./mailbox";
import { teamRouter } from "./team";

export const appRouter = {
  healthCheck: publicProcedure
    .route(routes.healthCheck)
    .output(healthCheckOutputSchema)
    .handler(() => {
      return "OK";
    }),
  privateData: teamMemberProtectedProcedure
    .route(routes.privateData)
    .output(privateDataOutputSchema)
    .handler(({ context }) => {
      return {
        message: "This is private",
        user: context.session?.user,
      };
    }),
  membershipInfo: teamMemberProtectedProcedure
    .route(routes.membershipInfo)
    .output(membershipInfoOutputSchema)
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
