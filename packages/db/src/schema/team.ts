import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const jellyTeam = pgTable("jelly_team", {
  id: text("id").notNull().primaryKey(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// export const jellyTeamContact = pgTable(
//   "jelly_team_member",
//   {
//     id: text("id").notNull().primaryKey(),
//     name: text("name").notNull(),
//     email: text("email").notNull().unique(),
//     role: text("role").notNull(),
//     active: boolean("active").default(true).notNull(),
//     jellyTeamId: text("jelly_team_id").notNull(),
//     existsInJelly: boolean("exists_in_jelly")
//       .notNull()
//       .$default(() => true),
//   },
//   (t) => [unique().on(t.email, t.jellyTeamId)],
// );

export const jellyTeamContact = pgTable("jelly_contact", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("contact"), // e.g. admin, member, owner, contact
  active: boolean("active").default(true).notNull(),
  jellyTeamId: text("jelly_team_id")
    .notNull()
    .references(() => jellyTeam.id, { onDelete: "cascade" }),
  existsInJelly: boolean("exists_in_jelly")
    .notNull()
    .$default(() => true),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
