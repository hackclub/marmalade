import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const conversations = pgTable("conversation", {
  id: serial("id").primaryKey(),
  jellyConversationId: text("jelly_conversation_id").notNull().unique(),
  inboxId: integer("inbox_id").notNull(),
  subject: text("subject"),
  status: text("status").notNull().default("open"),
  messagesCount: integer("messages_count").notNull().default(0),
  commentsCount: integer("comments_count").notNull().default(0),
  attachmentsCount: integer("attachments_count").notNull().default(0),
  snoozedUntil: timestamp("snoozed_until", { mode: "date" }),
  mailboxes: jsonb("mailboxes"),
  labels: jsonb("labels"),
  assignees: jsonb("assignees"),
  url: text("url"),
  markdownUrl: text("markdown_url"),
  messagesUrl: text("messages_url"),
  commentsUrl: text("comments_url"),
  draftReplyUrl: text("draft_reply_url"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  lastMessageAt: timestamp("last_message_at", { mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const messages = pgTable("message", {
  id: serial("id").primaryKey(),
  jellyMessageId: text("jelly_message_id").notNull().unique(),
  conversationId: integer("conversation_id").notNull(),
  jellyConversationId: text("jelly_conversation_id"),
  inboxId: integer("inbox_id").notNull(),
  subject: text("subject"),
  content: text("content"),
  contentHtml: text("content_html"),
  from: jsonb("from"),
  to: jsonb("to"),
  cc: jsonb("cc"),
  bcc: jsonb("bcc"),
  senderName: text("sender_name"),
  senderEmail: text("sender_email"),
  sender: jsonb("sender"),
  isInbound: boolean("is_inbound").notNull().default(true),
  attachmentsCount: integer("attachments_count").notNull().default(0),
  attachments: jsonb("attachments"),
  url: text("url"),
  status: text("status").notNull(),
  metadata: jsonb("metadata").notNull(),
  sentAt: timestamp("sent_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  receivedAt: timestamp("received_at", { mode: "date" }).notNull(),
});

export const comments = pgTable("comment", {
  id: serial("id").primaryKey(),
  jellyCommentId: text("jelly_comment_id").notNull().unique(),
  conversationId: integer("conversation_id").notNull(),
  jellyConversationId: text("jelly_conversation_id").notNull(),
  inboxId: integer("inbox_id").notNull(),
  body: text("body").notNull(),
  deleted: boolean("deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at", { mode: "date" }),
  author: jsonb("author"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
