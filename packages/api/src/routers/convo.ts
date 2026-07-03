import { db } from "@marmalade-v2/db";
import { auditLog } from "@marmalade-v2/db/schema/audit";
import { conversations, messages } from "@marmalade-v2/db/schema/convo";
import { env } from "@marmalade-v2/env/server";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import z from "zod";
import { jellyWebhookProcedure } from "../index";

const SYSTEM_WEBHOOK_USER_ID = "system:webhook";

export const conversationRouter = {
  convo: {
    create: jellyWebhookProcedure
      .input(
        z.object({
          inboxId: z.number().int().positive(),
          jellyConversationId: z.string().min(1),
          subject: z.string().nullable().optional(),
          status: z.string().optional(),
          sentAt: z.string().optional(),
        }),
      )
      .handler(async ({ input }) => {
        const existingConversationRows = await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            eq(conversations.jellyConversationId, input.jellyConversationId),
          )
          .limit(1);

        let conversationId = existingConversationRows[0]?.id ?? null;

        if (conversationId === null) {
          const createdConversationRows = await db
            .insert(conversations)
            .values({
              jellyConversationId: input.jellyConversationId,
              inboxId: input.inboxId,
              subject: input.subject ?? null,
              status: input.status ?? "open",
              lastMessageAt: input.sentAt ? new Date(input.sentAt) : new Date(),
            })
            .onConflictDoNothing()
            .returning({ id: conversations.id });

          conversationId = createdConversationRows[0]?.id ?? null;

          if (conversationId === null) {
            const refreshedConversationRows = await db
              .select({ id: conversations.id })
              .from(conversations)
              .where(
                eq(
                  conversations.jellyConversationId,
                  input.jellyConversationId,
                ),
              )
              .limit(1);

            conversationId = refreshedConversationRows[0]?.id ?? null;
          }
        }

        if (conversationId === null) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Conversation could not be created",
          });
        }

        await db.insert(auditLog).values({
          userId: SYSTEM_WEBHOOK_USER_ID,
          teamId: env.JELLY_TEAM_ID,
          action: "create",
          resource: "conversation",
          resourceId: conversationId.toString(),
          status: "success",
          changes: null,
          metadata: {
            source: "jelly_webhook",
            jellyConversationId: input.jellyConversationId,
            inboxId: input.inboxId,
          },
          ipAddress: null,
          userAgent: null,
        });

        return { id: conversationId };
      }),
    setStatus: jellyWebhookProcedure
      .input(
        z.object({
          jellyConversationId: z.string().min(1),
          status: z.string().min(1),
        }),
      )
      .handler(async ({ input }) => {
        await db
          .update(conversations)
          .set({
            status: input.status,
            updatedAt: new Date(),
          })
          .where(
            eq(conversations.jellyConversationId, input.jellyConversationId),
          );

        await db.insert(auditLog).values({
          userId: SYSTEM_WEBHOOK_USER_ID,
          teamId: env.JELLY_TEAM_ID,
          action: "update_status",
          resource: "conversation",
          resourceId: input.jellyConversationId,
          status: "success",
          changes: null,
          metadata: {
            source: "jelly_webhook",
            jellyConversationId: input.jellyConversationId,
            status: input.status,
          },
          ipAddress: null,
          userAgent: null,
        });

        return { success: true };
      }),
  },
  message: {
    create: jellyWebhookProcedure
      .input(
        z.object({
          jellyMessageId: z.string().min(1),
          conversationId: z.number().int().positive(),
          inboxId: z.number().int().positive(),
          content: z.string().nullable().optional(),
          contentHtml: z.string().nullable().optional(),
          senderName: z.string().nullable().optional(),
          senderEmail: z.string().nullable().optional(),
          isInbound: z.boolean().optional(),
          attachmentsCount: z.number().int().min(0).optional(),
          sentAt: z.string().optional(),
        }),
      )
      .handler(async ({ input }) => {
        await db
          .insert(messages)
          .values({
            jellyMessageId: input.jellyMessageId,
            conversationId: input.conversationId,
            inboxId: input.inboxId,
            content: input.content ?? null,
            contentHtml: input.contentHtml ?? null,
            senderName: input.senderName ?? null,
            senderEmail: input.senderEmail ?? null,
            isInbound: input.isInbound ?? true,
            status: "received",
            metadata: {
              attachments_count: input.attachmentsCount ?? 0,
            },
            receivedAt: input.sentAt ? new Date(input.sentAt) : new Date(),
          })
          .onConflictDoNothing();

        await db.insert(auditLog).values({
          userId: SYSTEM_WEBHOOK_USER_ID,
          teamId: env.JELLY_TEAM_ID,
          action: "create",
          resource: "message",
          resourceId: input.jellyMessageId,
          status: "success",
          changes: null,
          metadata: {
            source: "jelly_webhook",
            jellyMessageId: input.jellyMessageId,
            conversationId: input.conversationId,
            inboxId: input.inboxId,
          },
          ipAddress: null,
          userAgent: null,
        });

        return { success: true };
      }),
  },
};
