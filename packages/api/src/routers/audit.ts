import { db } from "@marmalade-v2/db";
import { auditLog } from "@marmalade-v2/db/schema/audit";
import { env } from "@marmalade-v2/env/server";

import z from "zod";

import { publicProcedure, teamAdminProtectedProcedure } from "../index";

export const auditRouter = {
  list: teamAdminProtectedProcedure.handler(async () => {
    return await db.select().from(auditLog);
  }),
  create: publicProcedure
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
      const ctx = context as any;

      let userId: string | null = null;
      let apiKeyId: number | null = null;
      let ipAddress: string | null = null;
      let userAgent: string | null = null;

      if (ctx.session) {
        userId = ctx.session.user.id;
        ipAddress = ctx.session.session.ipAddress ?? null;
        userAgent = ctx.session.session.userAgent ?? null;
      } else if (ctx.apiKey) {
        apiKeyId = ctx.apiKey.id;
      }

      return await db.insert(auditLog).values({
        userId,
        apiKeyId,
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
