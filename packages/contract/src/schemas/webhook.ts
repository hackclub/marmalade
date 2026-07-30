import { z } from "zod";

export const jellyConversationSchema = z.object({
  id: z.string(),
  subject: z.string().nullable().optional(),
  status: z.string().optional(),
  url: z.string().optional(),
  markdown_url: z.string().optional(),
  draft_reply_url: z.string().optional(),
  mailboxes: z
    .array(
      z.object({
        id: z.string(),
      }),
    )
    .optional(),
  last_message_at: z.string().optional(),
});

export const jellyMessageSchema = z.object({
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

export const jellyCommentSchema = z.object({
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

export const jellyWebhookSchema = z.object({
  event: z.enum([
    "new_message",
    "assigned",
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

export const jellyEventWebhookOutputSchema = z.object({
  success: z.boolean(),
  reason: z.string().optional(),
});

