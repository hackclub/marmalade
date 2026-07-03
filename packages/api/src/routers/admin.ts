import { db } from "@marmalade-v2/db";
import { conversations, messages } from "@marmalade-v2/db/schema/convo";
import {
  jellyMailbox,
  marmaladeMailbox,
} from "@marmalade-v2/db/schema/mailbox";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import z from "zod";
import { jellyWebhookProcedure } from "../index";

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
});

const jellyWebhookSchema = z.object({
  event: z.enum([
    "new_message",
    "conversation_archived",
    "conversation_unarchived",
  ]),
  data: z
    .object({
      conversation: jellyConversationSchema,
      message: jellyMessageSchema.optional(),
    })
    .passthrough(),
});

export type JellyWebhookInput = z.infer<typeof jellyWebhookSchema>;

export const adminRouter = {
  jellyEventWebhook: jellyWebhookProcedure
    .input(jellyWebhookSchema)
    .handler(async ({ input }) => {
      const conversation = input.data.conversation;
      const mailboxId = conversation.mailboxes?.[0]?.id;

      if (!mailboxId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "No mailbox found in conversation",
        });
      }

      const jellyMailboxRows = await db
        .select({
          id: jellyMailbox.id,
          isArchived: jellyMailbox.isArchived,
        })
        .from(jellyMailbox)
        .where(eq(jellyMailbox.jellyMailboxId, mailboxId))
        .limit(1);

      if (jellyMailboxRows.length === 0) {
        return { success: true, reason: "mailbox not found" };
      }

      const jellyMailboxRow = jellyMailboxRows[0];

      if (!jellyMailboxRow) {
        return { success: true, reason: "mailbox not found" };
      }

      if (jellyMailboxRow.isArchived) {
        return { success: true, reason: "mailbox archived" };
      }

      const marmaladeMailboxRows = await db
        .select({
          id: marmaladeMailbox.id,
          active: marmaladeMailbox.active,
        })
        .from(marmaladeMailbox)
        .where(eq(marmaladeMailbox.jellyMailboxId, mailboxId))
        .limit(1);

      if (marmaladeMailboxRows.length === 0) {
        return { success: true, reason: "mailbox not setup" };
      }

      const marmaladeMailboxRow = marmaladeMailboxRows[0];

      if (!marmaladeMailboxRow || !marmaladeMailboxRow.active) {
        return { success: true, reason: "mailbox not active" };
      }

      if (input.event === "new_message") {
        const message = input.data.message;

        if (!message) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Webhook message payload is required",
          });
        }

        const existingConversationRows = await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.jellyConversationId, conversation.id))
          .limit(1);

        let conversationId = existingConversationRows[0]?.id ?? null;

        if (conversationId === null) {
          const createdConversationRows = await db
            .insert(conversations)
            .values({
              jellyConversationId: conversation.id,
              inboxId: marmaladeMailboxRow.id,
              subject: conversation.subject ?? null,
              status: conversation.status ?? "open",
              lastMessageAt: message.sent_at
                ? new Date(message.sent_at)
                : new Date(),
            })
            .onConflictDoNothing()
            .returning({ id: conversations.id });

          conversationId = createdConversationRows[0]?.id ?? null;

          if (conversationId === null) {
            const refreshedConversationRows = await db
              .select({ id: conversations.id })
              .from(conversations)
              .where(eq(conversations.jellyConversationId, conversation.id))
              .limit(1);

            conversationId = refreshedConversationRows[0]?.id ?? null;
          }
        }

        if (conversationId === null) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Conversation could not be created",
          });
        }

        const { name: senderName, email: senderEmail } = parseFrom(
          message.from,
        );
        const attachmentsCount = message.attachments_count ?? 0;

        await db
          .insert(messages)
          .values({
            jellyMessageId: message.id,
            conversationId,
            inboxId: marmaladeMailboxRow.id,
            content: message.text_body ?? null,
            contentHtml: message.html_body ?? null,
            senderName,
            senderEmail,
            isInbound: message.inbound ?? true,
            status: "received",
            metadata: {
              attachments_count: attachmentsCount,
            },
            receivedAt: message.sent_at
              ? new Date(message.sent_at)
              : new Date(),
          })
          .onConflictDoNothing();
      }

      if (
        input.event === "conversation_archived" ||
        input.event === "conversation_unarchived"
      ) {
        const status =
          input.event === "conversation_archived" ? "archived" : "open";

        await db
          .update(conversations)
          .set({
            status,
            updatedAt: new Date(),
          })
          .where(eq(conversations.jellyConversationId, conversation.id));
      }

      return { success: true };
    }),
};
