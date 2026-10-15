import { ORPCError, type RouterClient } from "@orpc/server";

import { db } from "@marmalade-v2/db";
import { jellyTeamContact } from "@marmalade-v2/db/schema/team";
import { and, eq } from "drizzle-orm";
import z from "zod";
import {
  isInstanceAdmin,
  publicProcedure,
  teamIdOf,
  teamMemberProtectedProcedure,
} from "../index";
import { teamMemberSchema } from "../schemas/output";
import { actionRouter } from "./action";
import { adminRouter } from "./admin";
import { apiKeyRouter } from "./api";
import { auditRouter } from "./audit";
import { conversationRouter } from "./convo";
import { instanceRouter } from "./instance";
import { mailboxRouter } from "./mailbox";
import { teamRouter } from "./team";
import { teamCredentialsRouter } from "./teamCredentials";

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
            eq(jellyTeamContact.jellyTeamId, teamIdOf(context)),
            eq(jellyTeamContact.existsInJelly, true),
          ),
        );

      if (teamMember[0]) return teamMember[0];

      // The `_auth` layout calls this on every navigation and redirects to
      // the login page when it fails, so an operator who selected a team
      // they hold no Jelly role in was bounced out of the whole app rather
      // than shown the team they had just connected.
      if (isInstanceAdmin(context.session?.user)) {
        return {
          id: context.session!.user.id,
          name: context.session!.user.name,
          email: context.session!.user.email,
          role: "instance",
          active: true,
          jellyTeamId: teamIdOf(context),
          existsInJelly: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }

      throw new ORPCError("UNAUTHORIZED", {
        message: "User is not a member of the team",
      });
    }),

  // Only `list`. `audit.create` is written to by handlers through `call()`
  // and has no business being reachable from outside: mounting it would put
  // a writer for the record of everything else on the public router.
  audit: { list: auditRouter.list },
  mailbox: mailboxRouter,
  team: teamRouter,
  instance: instanceRouter,
  teamCredentials: teamCredentialsRouter,
  apiKey: apiKeyRouter,
  convo: conversationRouter,
  action: actionRouter,
  admin: adminRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
