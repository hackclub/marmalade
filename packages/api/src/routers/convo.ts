import { db } from "@marmalade-v2/db";
import { auditLog } from "@marmalade-v2/db/schema/audit";
import {
  comment,
  conversation,
  conversationMailbox,
  message,
  conversationAssignment,
  messageAttachment,
} from "@marmalade-v2/db/schema/convo";
import { jellyMailbox } from "@marmalade-v2/db/schema/mailbox";
import { jellyTeamContact } from "@marmalade-v2/db/schema/team";
import { env } from "@marmalade-v2/env/server";
import { ORPCError } from "@orpc/server";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import z from "zod";
import {
  apiKeyOrSessionOrWebhookProcedure,
  checkRouterScope,
  filterFieldsByScope,
  jellyWebhookProcedure,
  mailboxScopedProcedure,
} from "../index";
import {
  commentSchema,
  conversationSchema,
  messageSchema,
} from "../schemas/output";

const SYSTEM_WEBHOOK_USER_ID = "system:webhook";

function parseSubjectSearch(search: string) {
  const terms: { exact: boolean; value: string }[] = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = regex.exec(search)) !== null) {
    if (match[1]) {
      terms.push({ exact: true, value: match[1] });
    } else if (match[2]) {
      terms.push({ exact: false, value: match[2] });
    }
  }
  return terms;
}

function buildSubjectConditions(search: string) {
  const terms = parseSubjectSearch(search);
  return terms.map((term) =>
    term.exact
      ? eq(conversation.subject, term.value)
      : ilike(conversation.subject, `%${term.value}%`),
  );
}

const conversationSortFields = {
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
  lastMessageAt: conversation.lastMessageAt,
  subject: conversation.subject,
  status: conversation.status,
  messagesCount: conversation.messagesCount,
  commentsCount: conversation.commentsCount,
  attachmentsCount: conversation.attachmentsCount,
} as const;

const messageSortFields = {
  sentAt: message.sentAt,
  createdAt: message.createdAt,
  subject: message.subject,
  isInbound: message.isInbound,
  attachmentsCount: message.attachmentsCount,
} as const;

const commentSortFields = {
  createdAt: comment.createdAt,
  body: comment.body,
} as const;

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
      .output(z.object({ id: z.string() }))
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

        const mailboxRows = await db
          .select({ jellyMailboxId: jellyMailbox.jellyMailboxId })
          .from(jellyMailbox)
          .where(eq(jellyMailbox.id, input.inboxId))
          .limit(1);

        const mailboxId = mailboxRows[0]?.jellyMailboxId ?? null;

        if (mailboxId) {
          await db
            .insert(conversationMailbox)
            .values({
              conversationId,
              jellyMailboxId: mailboxId,
              jellyTeamId: env.JELLY_TEAM_ID,
            })
            .onConflictDoNothing();
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
      .output(z.object({ success: z.literal(true) }))
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
      assign: jellyWebhookProcedure
      .input(
        z.object({
          jellyConversationId: z.string().min(1),
          assignedToId: z.string().min(1),
        }),
      )
      .output(z.object({ success: z.literal(true) }))
      .handler(async ({ input }) => {
        await db
          .insert(conversationAssignment)
          .values({
            conversationId: input.jellyConversationId,
            jellyContactId: input.assignedToId,
          })
          .onConflictDoNothing();

        return { success: true };
      }),
    },
  list: mailboxScopedProcedure
    .route({
      method: "GET",
      path: "/mailboxes/{mailboxId}/conversations",
    })
    .input(
      z.object({
        mailboxId: z.string().min(1),
        status: z.string().optional(),
        search: z.string().optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
        sortBy: z
          .enum([
            "createdAt",
            "updatedAt",
            "lastMessageAt",
            "subject",
            "status",
            "messagesCount",
            "commentsCount",
            "attachmentsCount",
          ])
          .optional()
          .default("lastMessageAt"),
        sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
      }),
    )
    .output(
      z.array(
        z.object({
          conversation: conversationSchema,
          mailboxId: z.string(),
        }),
      ),
    )
    .handler(async ({ input, context }) => {
      checkRouterScope(context, "convo");

      const conditions = [
        eq(conversationMailbox.jellyMailboxId, input.mailboxId),
      ];

      if (input.status) {
        conditions.push(eq(conversation.status, input.status));
      }

      if (input.search) {
        const searchConditions = buildSubjectConditions(input.search);
        if (searchConditions.length === 1) {
          conditions.push(searchConditions[0]!);
        } else if (searchConditions.length > 1) {
          conditions.push(and(...searchConditions)!);
        }
      }

      if (input.startDate) {
        conditions.push(gte(conversation.createdAt, new Date(input.startDate)));
      }
      if (input.endDate) {
        conditions.push(lte(conversation.createdAt, new Date(input.endDate)));
      }

      const sortCol = conversationSortFields[input.sortBy]!;
      const orderFn =
        input.sortOrder === "asc"
          ? sql`${sortCol} asc nulls last`
          : sql`${sortCol} desc nulls last`;

      const rows = await db
        .select({
          conversation,
          mailboxId: conversationMailbox.jellyMailboxId,
        })
        .from(conversation)
        .innerJoin(
          conversationMailbox,
          eq(conversation.id, conversationMailbox.conversationId),
        )
        .where(and(...conditions))
        .orderBy(orderFn);

      return rows.map((row) => ({
        ...row,
        conversation: filterFieldsByScope(
          context,
          "conversation",
          row.conversation,
        ),
      }));
    }),
  get: apiKeyOrSessionOrWebhookProcedure
    .route({
      method: "GET",
      path: "/mailboxes/{mailboxId}/conversations/{conversationId}",
    })
    .input(
      z.object({
        mailboxId: z.string().min(1),
        conversationId: z.string().min(1),
      }),
    )
    .output(
      conversationSchema.extend({
        messages: z.array(messageSchema),
        comments: z.array(commentSchema),
      }),
    )
      .handler(async ({ input, context }) => {
        checkRouterScope(context, "message");

        const rows = await db
        .select()
        .from(conversation)
        .innerJoin(
          conversationMailbox,
          eq(conversation.id, conversationMailbox.conversationId),
        )
        .where(
          and(
            eq(conversation.id, input.conversationId),
            eq(conversationMailbox.jellyMailboxId, input.mailboxId),
          ),
        )
        .limit(1);

      if (rows.length === 0) {
        throw new ORPCError("NOT_FOUND", {
          message: "Conversation not found",
        });
      }

      const convo = rows[0]!.jelly_conversation;

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

      return {
        ...filterFieldsByScope(context, "conversation", convo),
        messages: messages.map((m) =>
          filterFieldsByScope(context, "message", m),
        ),
        comments: comments.map((c) =>
          filterFieldsByScope(context, "comment", c),
        ),
      };
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
          attachments: z
            .array(
              z.object({
                id: z.string().min(1),
                filename: z.string().min(1),
                content_type: z.string().min(1),
                byte_size: z.number().int().min(0),
                inline: z.boolean().optional(),
                url: z.url().optional(),
              }),
            )
            .optional(),
        }),
      )
      .output(z.object({ success: z.literal(true) }))
      .handler(async ({ input }) => {
        if (!input.senderEmail) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Message sender email is required",
          });
        }
        let senderId: string | null = null;
        const existingContactRows = await db
          .select({ id: jellyTeamContact.id })
          .from(jellyTeamContact)
          .where(eq(jellyTeamContact.email, input.senderEmail))
          .limit(1);

        if (existingContactRows.length > 0) {
          senderId = existingContactRows[0]!.id;
        } else {
          const newContactId = randomUUID();
          const name = input.senderEmail.split("@")[0]!;
          await db.insert(jellyTeamContact).values({
            id: newContactId,
            name,
            email: input.senderEmail,
            role: "contact",
            jellyTeamId: env.JELLY_TEAM_ID,
            existsInJelly: false,
          });
          senderId = newContactId;
        }
        await db
          .insert(message)
          .values({
            id: input.jellyMessageId,
            conversationId: input.conversationId,
            content: input.content ?? null,
            contentHtml: input.contentHtml ?? null,
            senderId,
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

        for (const attachment of input.attachments ?? []) {
          await db.insert(messageAttachment).values({
            id: attachment.id,
            messageId: input.jellyMessageId,
            filename: attachment.filename,
            contentType: attachment.content_type,
            byteSize: attachment.byte_size,
            inline: attachment.inline,
            url: attachment.url,
          });
        }

        return { success: true };
      }),
    list: apiKeyOrSessionOrWebhookProcedure
      .route({
        method: "GET",
        path: "/mailboxes/{mailboxId}/conversations/{conversationId}/messages",
      })
      .input(
        z.object({
          mailboxId: z.string().min(1),
          conversationId: z.string().min(1),
          startDate: z.string().datetime().optional(),
          endDate: z.string().datetime().optional(),
          sortBy: z
            .enum([
              "sentAt",
              "createdAt",
              "subject",
              "isInbound",
              "attachmentsCount",
            ])
            .optional()
            .default("sentAt"),
          sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
        }),
      )
      .output(z.array(messageSchema))
      .handler(async ({ input, context }) => {
        checkRouterScope(context, "message");

        const conditions = [eq(message.conversationId, input.conversationId)];

        if (input.startDate) {
          conditions.push(gte(message.sentAt, new Date(input.startDate)));
        }
        if (input.endDate) {
          conditions.push(lte(message.sentAt, new Date(input.endDate)));
        }

        const sortCol = messageSortFields[input.sortBy]!;
        const orderFn =
          input.sortOrder === "asc"
            ? sql`${sortCol} asc nulls last`
            : sql`${sortCol} desc nulls last`;

        const rows = await db
          .select()
          .from(message)
          .where(and(...conditions))
          .orderBy(orderFn);

        return rows.map((r) => filterFieldsByScope(context, "message", r));
      }),
    get: apiKeyOrSessionOrWebhookProcedure
      .route({
        method: "GET",
        path: "/mailboxes/{mailboxId}/messages/{messageId}",
      })
      .input(
        z.object({
          mailboxId: z.string().min(1),
          messageId: z.string().min(1),
        }),
      )
      .output(messageSchema)
      .handler(async ({ input, context }) => {
        checkRouterScope(context, "convo");

        const rows = await db
          .select({
            message,
            conversationMailbox,
          })
          .from(message)
          .innerJoin(conversation, eq(message.conversationId, conversation.id))
          .innerJoin(
            conversationMailbox,
            eq(conversation.id, conversationMailbox.conversationId),
          )
          .where(
            and(
              eq(message.id, input.messageId),
              eq(conversationMailbox.jellyMailboxId, input.mailboxId),
            ),
          )
          .limit(1);

        if (rows.length === 0) {
          throw new ORPCError("NOT_FOUND", {
            message: "Message not found",
          });
        }

        return filterFieldsByScope(context, "message", rows[0]!.message);
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
      .output(z.object({ success: z.literal(true) }))
      .handler(async ({ input }) => {
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
    list: apiKeyOrSessionOrWebhookProcedure
      .route({
        method: "GET",
        path: "/mailboxes/{mailboxId}/conversations/{conversationId}/comments",
      })
      .input(
        z.object({
          mailboxId: z.string().min(1),
          conversationId: z.string().min(1),
          startDate: z.string().datetime().optional(),
          endDate: z.string().datetime().optional(),
          sortBy: z.enum(["createdAt", "body"]).optional().default("createdAt"),
          sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
        }),
      )
      .output(z.array(commentSchema))
      .handler(async ({ input, context }) => {
        checkRouterScope(context, "comment");

        const conditions = [eq(comment.conversationId, input.conversationId)];

        if (input.startDate) {
          conditions.push(gte(comment.createdAt, new Date(input.startDate)));
        }
        if (input.endDate) {
          conditions.push(lte(comment.createdAt, new Date(input.endDate)));
        }

        const sortCol = commentSortFields[input.sortBy]!;
        const orderFn =
          input.sortOrder === "asc"
            ? sql`${sortCol} asc nulls last`
            : sql`${sortCol} desc nulls last`;

        const rows = await db
          .select()
          .from(comment)
          .where(and(...conditions))
          .orderBy(orderFn);

        return rows.map((r) => filterFieldsByScope(context, "comment", r));
      }),
    get: apiKeyOrSessionOrWebhookProcedure
      .route({
        method: "GET",
        path: "/mailboxes/{mailboxId}/comments/{commentId}",
      })
      .input(
        z.object({
          mailboxId: z.string().min(1),
          commentId: z.string().min(1),
        }),
      )
      .output(commentSchema)
      .handler(async ({ input, context }) => {
        checkRouterScope(context, "comment");

        const rows = await db
          .select({
            comment,
            conversationMailbox,
          })
          .from(comment)
          .innerJoin(conversation, eq(comment.conversationId, conversation.id))
          .innerJoin(
            conversationMailbox,
            eq(conversation.id, conversationMailbox.conversationId),
          )
          .where(
            and(
              eq(comment.id, input.commentId),
              eq(conversationMailbox.jellyMailboxId, input.mailboxId),
            ),
          )
          .limit(1);

        if (rows.length === 0) {
          throw new ORPCError("NOT_FOUND", {
            message: "Comment not found",
          });
        }

        return filterFieldsByScope(context, "comment", rows[0]!.comment);
      }),
  },
  attachment: {},
};
