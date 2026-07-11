import { db } from "@marmalade-v2/db";
import { auditLog } from "@marmalade-v2/db/schema/audit";
import { comment, conversation, message } from "@marmalade-v2/db/schema/convo";
import { env } from "@marmalade-v2/env/server";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import z from "zod";
import { jellyWebhookProcedure } from "../index";
import { jellyTeamContact } from "@marmalade-v2/db/schema/team";

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
          .select({ id: conversation.id })
          .from(conversation)
          .where(
            eq(conversation.id, input.jellyConversationId),
          )
          .limit(1);

        let conversationId = existingConversationRows[0]?.id ?? null;

        if (conversationId === null) {
          const createdConversationRows = await db
            .insert(conversation)
            .values({
              id: input.jellyConversationId,
              subject: input.subject ?? null,
              status: input.status ?? "open",
              lastMessageAt: input.sentAt ? new Date(input.sentAt) : new Date(),
            })
            .onConflictDoNothing()
            .returning({ id: conversation.id });

          conversationId = createdConversationRows[0]?.id ?? null;

          if (conversationId === null) {
            const refreshedConversationRows = await db
              .select({ id: conversation.id })
              .from(conversation)
              .where(
                eq(conversation.id, input.jellyConversationId),
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
          jellyTeamId: env.JELLY_TEAM_ID,
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
          .update(conversation)
          .set({
            status: input.status,
            updatedAt: new Date(),
          })
          .where(
            eq(conversation.id, input.jellyConversationId),
          );

        await db.insert(auditLog).values({
          userId: SYSTEM_WEBHOOK_USER_ID,
          jellyTeamId: env.JELLY_TEAM_ID,
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
          conversationId: z.string().min(1),
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
        // lookup inpug.senderEmail in jellyTeamContact to see if this contact exists in our system before creating the message
        if (!input.senderEmail) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Message sender email is required",
          });
        }
        const existingContactRows = await db
            .select({ id: jellyTeamContact.id })
            .from(jellyTeamContact)
            .where(
              eq(jellyTeamContact.email, input.senderEmail),
            )
            .limit(1);

          if (!existingContactRows || existingContactRows.length === 0) {
            throw new ORPCError("BAD_REQUEST", {
              message: "Message sender is not a known contact",
            });
          }
        await db
          .insert(message)
          .values({
            id: input.jellyMessageId,
            conversationId: input.conversationId,
            content: input.content ?? null,
            contentHtml: input.contentHtml ?? null,
            senderId: existingContactRows[0]?.id ?? null,
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
          jellyTeamId: env.JELLY_TEAM_ID,
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
  comment: {
    create: jellyWebhookProcedure
      .input(
        z.object({
          jellyCommentId: z.string().min(1),
          conversationId: z.string().min(1),
          inboxId: z.number().int().positive(),
          body: z.string().nullable(),
          authorName: z.string().nullable(),
          authorEmail: z.string().nullable(),
          authorId: z.string().nullable(),
          createdAt: z.string(),
        }),
      )
      .handler(async ({ input }) => {

        // comments are only created by people who are already contacts, so verify this contact exists in our system before creating the comment
        const existingContactRows = await db
          .select({ id: jellyTeamContact.id })
          .from(jellyTeamContact)
          .where(
            eq(jellyTeamContact.id, input.authorId ?? ""),
          )
          .limit(1);

        if (!existingContactRows || existingContactRows.length === 0) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Comment author is not a known contact",
          });
        }

        await db
          .insert(comment)
          .values({
            id: input.jellyCommentId,
            conversationId: input.conversationId,
            //   inboxId: input.inboxId,
            body: input.body ?? "",
            authorId: input.authorId ?? null,
            createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
          })
          .onConflictDoNothing();

        await db.insert(auditLog).values({
          userId: SYSTEM_WEBHOOK_USER_ID,
          jellyTeamId: env.JELLY_TEAM_ID,
          action: "create",
          resource: "comment",
          resourceId: input.jellyCommentId,
          status: "success",
          changes: null,
          metadata: {
            source: "jelly_webhook",
            jellyCommentId: input.jellyCommentId,
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
