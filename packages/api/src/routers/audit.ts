import { db } from "@marmalade-v2/db";
import { auditLog } from "@marmalade-v2/db/schema/audit";
import { env } from "@marmalade-v2/env/server";

import z from "zod";

import { protectedProcedure, teamAdminProtectedProcedure } from "../index";

export const auditRouter = {
  list: teamAdminProtectedProcedure.handler(async () => {
    return await db.select().from(auditLog);
  }),
  create: protectedProcedure
    .input(
      z.object({
        resource: z.string().min(1),
        action: z.string().min(1),
        resourceId: z.string().optional(),
        status: z.string().optional(),
        changes: z.any().optional(),
        metadata: z.any().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const ipAddress = context.session.session.ipAddress;
      const userAgent = context.session.session.userAgent;

      return await db.insert(auditLog).values({
        userId: context.session.user.id,
        jellyTeamId: env.JELLY_TEAM_ID,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId ?? "-1",
        status: input.status ?? "unknown",
        changes: input.changes ?? null,
        metadata: input.metadata ?? null,
        ipAddress,
        userAgent,
      });
    }),
};
