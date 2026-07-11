import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { jellyMailbox } from "./mailbox";
import { jellyTeam, jellyTeamContact } from "./team";

export const conversation = pgTable("jelly_conversation", {
  id: text("id").primaryKey(),
  subject: text("subject"),
  status: text("status").notNull().default("open"),
  messagesCount: integer("messages_count").notNull().default(0),
  commentsCount: integer("comments_count").notNull().default(0),
  attachmentsCount: integer("attachments_count").notNull().default(0),
  snoozedUntil: timestamp("snoozed_until", { mode: "date" }),
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

export const conversationAssignment = pgTable("jelly_conversation_assignment", {
  id: serial("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversation.id, { onDelete: "cascade" }),
  jellyContactId: text("jelly_contact_id")
    .notNull()
    .references(() => jellyTeamContact.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const conversationLabel = pgTable("jelly_conversation_label", {
  id: serial("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversation.id, { onDelete: "cascade" }),
  labelId: integer("label_id")
    .notNull()
    .references(() => label.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const label = pgTable("jelly_label", {
  id: serial("id").primaryKey(),
  labelId: text("label_id").notNull(),
  name: text("name").notNull(),
  color: text("color"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
})

export const conversationMailbox = pgTable("jelly_conversation_mailbox", {
  id: serial("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversation.id, { onDelete: "cascade" }),
  jellyMailboxId: text("jelly_mailbox_id").notNull(),
  jellyTeamId: text("jelly_team_id")
    .notNull()
    .references(() => jellyTeam.id, { onDelete: "cascade" }),
});

export const message = pgTable("jelly_message", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversation.id, { onDelete: "cascade" }),
  subject: text("subject"),
  content: text("content"),
  contentHtml: text("content_html"),
  senderId: text("sender_id").references(() => jellyTeamContact.id, { onDelete: "set null" }),
  isInbound: boolean("is_inbound").notNull().default(true),
  attachmentsCount: integer("attachments_count").notNull().default(0),
  metadata: jsonb("metadata"),
  sentAt: timestamp("sent_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const messageContact = pgTable("jelly_message_contact", {
  type: text("type").notNull(), // cc, from
  id: serial("id").primaryKey(),
  messageId: text("message_id")
    .notNull()
    .references(() => message.id, { onDelete: "cascade" }),
  contactId: text("contact_id")
    .notNull()
    .references(() => jellyTeamContact.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const messageAttachment = pgTable("jelly_message_attachment", {
  id: text("id").primaryKey(),
  messageId: text("message_id")
    .notNull()
    .references(() => message.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  contentType: text("content_type"),
  byte_size: integer("byte_size"),
  url: text("url"),
  inline: boolean("inline").notNull().default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const comment = pgTable("comment", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversation.id, { onDelete: "cascade" }),
  body: text("body"),
  authorId: text("author_id").references(() => jellyTeamContact.id, { onDelete: "set null" }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
