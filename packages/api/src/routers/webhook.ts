import { db } from "@marm/db";
import { jellyTeamContact } from "@marm/db/schema/team";
import { env } from "@marm/env/server";
import { ORPCError, call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import {
  jellyEventWebhookOutputSchema,
  jellyWebhookSchema,
} from "@marm/contract/schemas/webhook";
import { jellyWebhookProcedure } from "../index";
import { conversationRouter } from "./convo";
import { mailboxRouter } from "./mailbox";
import { teamRouter } from "./team";

export type { JellyWebhookInput } from "@marm/contract/schemas/webhook";

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

export const webhookRouter = {
  jellyEventWebhook: jellyWebhookProcedure
    .input(jellyWebhookSchema)
    .output(jellyEventWebhookOutputSchema)
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

      if (input.event === "assigned") {
        const conversation = input.data.conversation;
        const assignee = input.data.assignee as {
          id: string;
          name: string;
          email: string;
        };

        if (!assignee) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Webhook assignee payload is required",
          });
        }

        let assigneeContact;
        try {
          assigneeContact = await call(
            teamRouter.get,
            {
              id: assignee.id,
            },
            { context },
          );
        } catch {
          assigneeContact = null;
        }

        if (!assigneeContact?.jelly) {
          const existingByEmail = await db
            .select({ id: jellyTeamContact.id })
            .from(jellyTeamContact)
            .where(
              and(
                eq(jellyTeamContact.email, assignee.email),
                eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID),
              ),
            )
            .limit(1);

          if (existingByEmail.length === 0) {
            await db
              .insert(jellyTeamContact)
              .values({
                id: assignee.id,
                name: assignee.name,
                email: assignee.email,
                role: "contact",
                active: true,
                jellyTeamId: env.JELLY_TEAM_ID,
                existsInJelly: true,
              })
              .onConflictDoNothing();
          }
        }

        await call(
          conversationRouter.convo.create,
          {
            inboxId: mailboxDetails.inboxId,
            jellyConversationId: conversation.id,
            subject: conversation.subject ?? null,
            status: conversation.status ?? "open",
            url: conversation.url ?? undefined,
            markdownUrl: conversation.markdown_url ?? undefined,
            draftReplyUrl: conversation.draft_reply_url ?? undefined,
          },
          { context },
        );

        await call(
          conversationRouter.convo.assign,
          {
            jellyConversationId: conversation.id,
            assignedToId: assignee.id,
          },
          { context },
        );
      }

      return { success: true };
    }),
};
