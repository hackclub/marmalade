import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  jellyConversationId: text("jelly_conversation_id").notNull().unique(),
  inboxId: integer("inbox_id").notNull(),
  subject: text("subject"),
  status: text("status").notNull().default("open"),
  lastMessageAt: timestamp("last_message_at", { mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  jellyMessageId: text("jelly_message_id").notNull().unique(),
  conversationId: integer("conversation_id").notNull(),
  inboxId: integer("inbox_id").notNull(),
  content: text("content"),
  contentHtml: text("content_html"),
  senderName: text("sender_name"),
  senderEmail: text("sender_email"),
  isInbound: boolean("is_inbound").notNull().default(true),
  status: text("status").notNull(),
  metadata: jsonb("metadata").notNull(),
  receivedAt: timestamp("received_at", { mode: "date" }).notNull(),
});
