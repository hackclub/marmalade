import { db } from "@marmalade-v2/db";
import { auditLog } from "@marmalade-v2/db/schema/audit";
import {
  comment,
  conversation,
  conversationMailbox,
  message,
} from "@marmalade-v2/db/schema/convo";
import { jellyTeamContact } from "@marmalade-v2/db/schema/team";
import { env } from "@marmalade-v2/env/server";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import z from "zod";
import {
  apiKeyOrSessionProcedure,
  jellyWebhookProcedure,
  mailboxScopedProcedure,
} from "../index";

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
          .where(eq(conversation.id, input.jellyConversationId))
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
              .where(eq(conversation.id, input.jellyConversationId))
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
          .where(eq(conversation.id, input.jellyConversationId));

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
  list: mailboxScopedProcedure
    .route({ method: "GET", path: "/conversations" })
    .input(
      z.object({
        mailboxId: z.string().min(1).optional(),
        status: z.string().optional(),
      }),
    )
    .handler(async ({ input }) => {
      const conditions = [];
      if (input.mailboxId) {
        conditions.push(
          eq(conversationMailbox.jellyMailboxId, input.mailboxId),
        );
      }
      if (input.status) {
        conditions.push(eq(conversation.status, input.status));
      }

      const rows = await db
        .select({
          conversation,
          mailboxId: conversationMailbox.jellyMailboxId,
        })
        .from(conversation)
        .leftJoin(
          conversationMailbox,
          eq(conversation.id, conversationMailbox.conversationId),
        )
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(conversation.lastMessageAt));

      return rows;
    }),
  get: apiKeyOrSessionProcedure
    .route({ method: "GET", path: "/conversations/{conversationId}" })
    .input(
      z.object({
        conversationId: z.string().min(1),
      }),
    )
    .handler(async ({ input }) => {
      const rows = await db
        .select()
        .from(conversation)
        .where(eq(conversation.id, input.conversationId))
        .limit(1);

      if (rows.length === 0) {
        throw new ORPCError("NOT_FOUND", {
          message: "Conversation not found",
        });
      }

      const convo = rows[0];

      const messages = await db
        .select()
        .from(message)
        .where(eq(message.conversationId, input.conversationId))
        .orderBy(asc(message.sentAt));

      const comments = await db
        .select()
        .from(comment)
        .where(eq(comment.conversationId, input.conversationId))
        .orderBy(asc(comment.createdAt));

      return { ...convo, messages, comments };
    }),
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
          .where(eq(jellyTeamContact.email, input.senderEmail))
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
            metadata: {
              attachments_count: input.attachmentsCount ?? 0,
            },
            sentAt: input.sentAt ? new Date(input.sentAt) : new Date(),
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
    list: apiKeyOrSessionProcedure
      .route({
        method: "GET",
        path: "/conversations/{conversationId}/messages",
      })
      .input(
        z.object({
          conversationId: z.string().min(1),
        }),
      )
      .handler(async ({ input }) => {
        const rows = await db
          .select()
          .from(message)
          .where(eq(message.conversationId, input.conversationId))
          .orderBy(asc(message.sentAt));

        return rows;
      }),
    get: apiKeyOrSessionProcedure
      .route({ method: "GET", path: "/messages/{messageId}" })
      .input(
        z.object({
          messageId: z.string().min(1),
        }),
      )
      .handler(async ({ input }) => {
        const rows = await db
          .select()
          .from(message)
          .where(eq(message.id, input.messageId))
          .limit(1);

        if (rows.length === 0) {
          throw new ORPCError("NOT_FOUND", {
            message: "Message not found",
          });
        }

        return rows[0];
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
          .where(eq(jellyTeamContact.id, input.authorId ?? ""))
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
    list: apiKeyOrSessionProcedure
      .route({
        method: "GET",
        path: "/conversations/{conversationId}/comments",
      })
      .input(
        z.object({
          conversationId: z.string().min(1),
        }),
      )
      .handler(async ({ input }) => {
        const rows = await db
          .select()
          .from(comment)
          .where(eq(comment.conversationId, input.conversationId))
          .orderBy(asc(comment.createdAt));

        return rows;
      }),
    get: apiKeyOrSessionProcedure
      .route({ method: "GET", path: "/comments/{commentId}" })
      .input(
        z.object({
          commentId: z.string().min(1),
        }),
      )
      .handler(async ({ input }) => {
        const rows = await db
          .select()
          .from(comment)
          .where(eq(comment.id, input.commentId))
          .limit(1);

        if (rows.length === 0) {
          throw new ORPCError("NOT_FOUND", {
            message: "Comment not found",
          });
        }

        return rows[0];
      }),
  },
};
