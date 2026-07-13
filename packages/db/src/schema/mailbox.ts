import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { jellyTeam, jellyTeamContact } from "./team";

export const jellyMailbox = pgTable(
  "jelly_mailbox",
  {
    id: serial("id").primaryKey(),
    jellyMailboxId: text("jelly_mailbox_id").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    isDefault: boolean("is_default").notNull(),
    isArchived: boolean("is_archived").notNull().default(false),
    jellyTeamId: text("jelly_team_id")
      .notNull()
      .references(() => jellyTeam.id, { onDelete: "cascade" }),
    existsInJelly: boolean("exists_in_jelly")
      .notNull()
      .$default(() => true),
  },
  (t) => [unique().on(t.jellyMailboxId, t.jellyTeamId)],
);

export const jellyMailboxMember = pgTable("jelly_mailbox_member", {
  id: serial("id").primaryKey(),
  jellyContactId: text("jelly_contact_id")
    .notNull()
    .references(() => jellyTeamContact.id, { onDelete: "cascade" }),
  jellyMailboxId: text("jelly_mailbox_id").notNull(),
  jellyTeamId: text("jelly_team_id")
    .notNull()
    .references(() => jellyTeam.id, { onDelete: "cascade" }),
});

export const marmaladeMailbox = pgTable("mailbox", {
  id: serial("id").primaryKey(),
  jellyMailboxId: text("jelly_mailbox_id").notNull(),
  jellyTeamId: text("jelly_team_id")
    .notNull()
    .references(() => jellyTeam.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  active: boolean("active").notNull().default(true),
});

export const marmaladeMailboxMember = pgTable("mailbox_member", {
  id: serial("id").primaryKey(),
  marmaladeUserId: text("marmalade_user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  marmaladeMailboxId: integer("marmalade_mailbox_id")
    .notNull()
    .references(() => marmaladeMailbox.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
