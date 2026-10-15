import {
  boolean,
  index,
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

export const marmaladeMailbox = pgTable(
  "mailbox",
  {
    id: serial("id").primaryKey(),
    jellyMailboxId: text("jelly_mailbox_id").notNull(),
    jellyTeamId: text("jelly_team_id")
      .notNull()
      .references(() => jellyTeam.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    active: boolean("active").notNull().default(true),
    // Second, independent switch for writes. A key holding a write scope
    // still cannot mutate a mailbox until an admin opts that mailbox in.
    writesEnabled: boolean("writes_enabled").notNull().default(false),
  },
  // Without this, two rows could describe the same Jelly mailbox and every
  // lookup that does `.limit(1)` would pick one arbitrarily — including the
  // one that decides whether the mailbox is active.
  (t) => [unique().on(t.jellyMailboxId, t.jellyTeamId)],
);

export const marmaladeMailboxMember = pgTable(
  "mailbox_member",
  {
    id: serial("id").primaryKey(),
    marmaladeUserId: text("marmalade_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    marmaladeMailboxId: integer("marmalade_mailbox_id")
      .notNull()
      .references(() => marmaladeMailbox.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    /**
     * Denormalised from the mailbox. This table is the sole authorization gate
     * for a non-admin, so being able to filter it by team without a join is
     * worth the column. Nullable for `db:push`; `backfillTeamIds()` fills it.
     */
    jellyTeamId: text("jelly_team_id").references(() => jellyTeam.id, {
      onDelete: "cascade",
    }),
  },
  // One grant per person per mailbox. Without this the rescind path has to
  // delete an unknown number of rows and the badge counts duplicates.
  (t) => [
    unique().on(t.marmaladeUserId, t.marmaladeMailboxId),
    index("idx_mailbox_member_jelly_team_id").on(t.jellyTeamId),
  ],
);
