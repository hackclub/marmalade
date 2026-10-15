import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { jellyTeam, jellyTeamContact } from "./team";

export const conversation = pgTable(
  "jelly_conversation",
  {
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
    /**
     * Denormalised from the conversation this row hangs off.
     *
     * It could be reached through a join, but the point of the column is to
     * make tenant isolation a single equality test that a policy or a `where`
     * cannot get subtly wrong. Nullable because `db:push` is the deploy path
     * and existing rows have no value yet; `backfillTeamIds()` fills them and
     * every write path sets it.
     */
    jellyTeamId: text("jelly_team_id").references(() => jellyTeam.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("idx_conversation_jelly_team_id").on(table.jellyTeamId),
    index("idx_conversation_status").on(table.status),
    index("idx_conversation_created_at").on(table.createdAt),
    index("idx_conversation_last_message_at").on(table.lastMessageAt),
    index("idx_conversation_updated_at").on(table.updatedAt),
  ],
);

export const conversationAssignment = pgTable(
  "jelly_conversation_assignment",
  {
    id: serial("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    jellyContactId: text("jelly_contact_id")
      .notNull()
      .references(() => jellyTeamContact.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    /**
     * Denormalised from the conversation this row hangs off.
     *
     * It could be reached through a join, but the point of the column is to
     * make tenant isolation a single equality test that a policy or a `where`
     * cannot get subtly wrong. Nullable because `db:push` is the deploy path
     * and existing rows have no value yet; `backfillTeamIds()` fills them and
     * every write path sets it.
     */
    jellyTeamId: text("jelly_team_id").references(() => jellyTeam.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("idx_conversation_assignment_jelly_team_id").on(table.jellyTeamId),
  ],
);

export const conversationLabel = pgTable(
  "jelly_conversation_label",
  {
    id: serial("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    labelId: integer("label_id")
      .notNull()
      .references(() => label.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    /**
     * Denormalised from the conversation this row hangs off.
     *
     * It could be reached through a join, but the point of the column is to
     * make tenant isolation a single equality test that a policy or a `where`
     * cannot get subtly wrong. Nullable because `db:push` is the deploy path
     * and existing rows have no value yet; `backfillTeamIds()` fills them and
     * every write path sets it.
     */
    jellyTeamId: text("jelly_team_id").references(() => jellyTeam.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("idx_conversation_label_jelly_team_id").on(table.jellyTeamId),
  ],
);

export const label = pgTable(
  "jelly_label",
  {
    id: serial("id").primaryKey(),
    labelId: text("label_id").notNull(),
    name: text("name").notNull(),
    color: text("color"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    /**
     * Denormalised from the conversation this row hangs off.
     *
     * It could be reached through a join, but the point of the column is to
     * make tenant isolation a single equality test that a policy or a `where`
     * cannot get subtly wrong. Nullable because `db:push` is the deploy path
     * and existing rows have no value yet; `backfillTeamIds()` fills them and
     * every write path sets it.
     */
    jellyTeamId: text("jelly_team_id").references(() => jellyTeam.id, {
      onDelete: "cascade",
    }),
  },
  // Jelly label ids are unique within a team, not across teams, and the sync
  // upserts by label id. Without the team in the key, a second team's label
  // would overwrite the first's.
  (table) => [
    unique().on(table.labelId, table.jellyTeamId),
    index("idx_label_jelly_team_id").on(table.jellyTeamId),
  ],
);

export const conversationMailbox = pgTable(
  "jelly_conversation_mailbox",
  {
    id: serial("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    jellyMailboxId: text("jelly_mailbox_id").notNull(),
    jellyTeamId: text("jelly_team_id")
      .notNull()
      .references(() => jellyTeam.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_conversation_mailbox_jelly_mailbox_id").on(table.jellyMailboxId),
    index("idx_conversation_mailbox_conversation_id").on(table.conversationId),
  ],
);

export const message = pgTable(
  "jelly_message",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    subject: text("subject"),
    content: text("content"),
    contentHtml: text("content_html"),
    senderId: text("sender_id").references(() => jellyTeamContact.id, {
      onDelete: "set null",
    }),
    isInbound: boolean("is_inbound").notNull().default(true),
    attachmentsCount: integer("attachments_count").notNull().default(0),
    metadata: jsonb("metadata"),
    sentAt: timestamp("sent_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    /**
     * Denormalised from the conversation this row hangs off.
     *
     * It could be reached through a join, but the point of the column is to
     * make tenant isolation a single equality test that a policy or a `where`
     * cannot get subtly wrong. Nullable because `db:push` is the deploy path
     * and existing rows have no value yet; `backfillTeamIds()` fills them and
     * every write path sets it.
     */
    jellyTeamId: text("jelly_team_id").references(() => jellyTeam.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("idx_message_jelly_team_id").on(table.jellyTeamId),
    index("idx_message_conversation_id").on(table.conversationId),
    index("idx_message_sent_at").on(table.sentAt),
    index("idx_message_created_at").on(table.createdAt),
  ],
);

export const messageContact = pgTable(
  "jelly_message_contact",
  {
    type: text("type").notNull(), // cc, from
    id: serial("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => jellyTeamContact.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    /**
     * Denormalised from the conversation this row hangs off.
     *
     * It could be reached through a join, but the point of the column is to
     * make tenant isolation a single equality test that a policy or a `where`
     * cannot get subtly wrong. Nullable because `db:push` is the deploy path
     * and existing rows have no value yet; `backfillTeamIds()` fills them and
     * every write path sets it.
     */
    jellyTeamId: text("jelly_team_id").references(() => jellyTeam.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [index("idx_message_contact_jelly_team_id").on(table.jellyTeamId)],
);

export const messageAttachment = pgTable(
  "jelly_message_attachment",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type"),
    byteSize: integer("byte_size"),
    url: text("url"),
    inline: boolean("inline").notNull().default(false),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    /**
     * Denormalised from the conversation this row hangs off.
     *
     * It could be reached through a join, but the point of the column is to
     * make tenant isolation a single equality test that a policy or a `where`
     * cannot get subtly wrong. Nullable because `db:push` is the deploy path
     * and existing rows have no value yet; `backfillTeamIds()` fills them and
     * every write path sets it.
     */
    jellyTeamId: text("jelly_team_id").references(() => jellyTeam.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("idx_message_attachment_jelly_team_id").on(table.jellyTeamId),
  ],
);

export const comment = pgTable(
  "comment",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    body: text("body"),
    authorId: text("author_id").references(() => jellyTeamContact.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    /**
     * Denormalised from the conversation this row hangs off.
     *
     * It could be reached through a join, but the point of the column is to
     * make tenant isolation a single equality test that a policy or a `where`
     * cannot get subtly wrong. Nullable because `db:push` is the deploy path
     * and existing rows have no value yet; `backfillTeamIds()` fills them and
     * every write path sets it.
     */
    jellyTeamId: text("jelly_team_id").references(() => jellyTeam.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("idx_comment_jelly_team_id").on(table.jellyTeamId),
    index("idx_comment_conversation_id").on(table.conversationId),
    index("idx_comment_created_at").on(table.createdAt),
  ],
);
