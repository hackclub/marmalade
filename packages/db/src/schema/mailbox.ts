import { boolean, integer, pgTable, serial, text } from "drizzle-orm/pg-core";

export const jellyMailbox = pgTable("jelly_mailbox", {
  id: serial("id").primaryKey(),
  jellyMailboxId: text("jelly_mailbox_id").notNull().unique(),
  name: text("name").notNull(),
  approvedBy: text("approved_by"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  isDefault: boolean("is_default").notNull(),
  existsInJelly: boolean("exists_in_jelly")
    .notNull()
    .$default(() => true),
});

export const jellyMailboxMember = pgTable("jelly_mailbox_member", {
  id: serial("id").primaryKey(),
  jellyMemberId: text("jelly_member_id").notNull(),
  jellyMailboxId: text("jelly_mailbox_id").notNull(),
  jellyTeamId: text("jelly_team_id").notNull(),
});

export const marmaladeMailbox = pgTable("mailbox", {
  id: serial("id").primaryKey(),
  jellyMailboxId: text("jelly_mailbox_id").notNull().unique(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  active: boolean("active").notNull().default(true),
});

export const marmaladeMailboxMember = pgTable("mailbox_member", {
  id: serial("id").primaryKey(),
  marmaladeUserId: text("marmalade_user_id").notNull(),
  marmaladeMailboxId: integer("marmalade_mailbox_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  jellyTeamId: text("jelly_team_id").notNull(),
});
