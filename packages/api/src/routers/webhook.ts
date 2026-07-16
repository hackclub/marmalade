import { ORPCError, call } from "@orpc/server";
import z from "zod";
import { jellyWebhookProcedure } from "../index";
import { conversationRouter } from "./convo";
import { mailboxRouter } from "./mailbox";

function parseFrom(fromArray: string[] | undefined): {
  name: string | null;
  email: string | null;
} {
  if (!fromArray || fromArray.length === 0) {
    return { name: null, email: null };
  }

  const first = fromArray[0];
  if (!first) {
    return { name: null, email: null };
  }

  const match = first.match(/^(.+?)\s*<(.+)>$/);
  if (match) {
    return { name: match[1] || null, email: match[2] || null };
  }

  return { name: null, email: first };
}

const jellyConversationSchema = z.object({
  id: z.string(),
  subject: z.string().nullable().optional(),
  status: z.string().optional(),
  mailboxes: z
    .array(
      z.object({
        id: z.string(),
      }),
    )
    .optional(),
  last_message_at: z.string().optional(),
});

const jellyMessageSchema = z.object({
  id: z.string(),
  text_body: z.string().nullable().optional(),
  html_body: z.string().nullable().optional(),
  attachments_count: z.number().optional(),
  inbound: z.boolean().optional(),
  sent_at: z.string().optional(),
  from: z.array(z.string()).optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        filename: z.string(),
        content_type: z.string(),
        byte_size: z.number(),
        inline: z.boolean(),
        url: z.url().optional(),
      }),
    )
    .optional(),
});

const jellyCommentSchema = z.object({
  id: z.string(),
  body: z.string().optional(),
  created_at: z.string().optional(),
  author: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
});

const jellyWebhookSchema = z.object({
  event: z.enum([
    "new_message",
    "conversation_archived",
    "conversation_unarchived",
    "comment_added",
  ]),
  data: z
    .object({
      conversation: jellyConversationSchema,
      message: jellyMessageSchema.optional(),
      comment: jellyCommentSchema.optional(),
    })
    .passthrough(),
});

export type JellyWebhookInput = z.infer<typeof jellyWebhookSchema>;

export const adminRouter = {
  jellyEventWebhook: jellyWebhookProcedure
    .input(jellyWebhookSchema)
    .output(
      z.discriminatedUnion("success", [
        z.object({ success: z.literal(true) }),
        z.object({ success: z.literal(true), reason: z.string() }),
      ]),
    )
    .handler(async ({ input, context }) => {
      const conversation = input.data.conversation;
      const mailboxId = conversation.mailboxes?.[0]?.id;

      if (!mailboxId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "No mailbox found in conversation",
        });
      }

      const mailboxDetails = await call(
        mailboxRouter.getMailboxDetails,
        {
          jellyMailboxId: mailboxId,
        },
        // @ts-expect-error: WebhookContext satisfies the runtime middleware but oRPC's call() doesn't infer through middleware
        { context },
      );

      if (!mailboxDetails.allowed) {
        return { success: true, reason: mailboxDetails.reason };
      }

      if (input.event === "new_message") {
        const message = input.data.message;

        if (!message) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Webhook message payload is required",
          });
        }

        const convoResult = await call(
          conversationRouter.convo.create,
          {
            inboxId: mailboxDetails.inboxId,
            jellyConversationId: conversation.id,
            subject: conversation.subject ?? null,
            status: conversation.status ?? "open",
            sentAt: message.sent_at,
          },
          { context },
        );

        const { name: senderName, email: senderEmail } = parseFrom(
          message.from,
        );

        await call(
          conversationRouter.message.create,
          {
            jellyMessageId: message.id,
            conversationId: convoResult.id,
            inboxId: mailboxDetails.inboxId,
            content: message.text_body ?? null,
            contentHtml: message.html_body ?? null,
            senderName,
            senderEmail,
            isInbound: message.inbound ?? true,
            attachmentsCount: message.attachments_count ?? 0,
            sentAt: message.sent_at,
            attachments: message.attachments,
          },
          { context },
        );
      }

      if (
        input.event === "conversation_archived" ||
        input.event === "conversation_unarchived"
      ) {
        const status =
          input.event === "conversation_archived" ? "archived" : "open";

        await call(
          conversationRouter.convo.setStatus,
          {
            jellyConversationId: conversation.id,
            status,
          },
          { context },
        );
      }

      if (input.event === "comment_added") {
        const comment = input.data.comment;

        if (!comment) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Webhook comment payload is required",
          });
        }

        await call(
          conversationRouter.comment.create,
          {
            jellyCommentId: comment.id,
            conversationId: conversation.id,
            inboxId: mailboxDetails.inboxId,
            body: comment.body ?? null,
            authorName: comment.author?.name ?? null,
            authorEmail: comment.author?.email ?? null,
            authorId: comment.author?.id ?? null,
            createdAt: comment.created_at ?? "",
          },
          { context },
        );
      }

      return { success: true };
    }),
};
