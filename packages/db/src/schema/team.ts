import { boolean, pgTable, text } from "drizzle-orm/pg-core";

export const jellyTeamMember = pgTable("jelly_team_member", {
  id: text("id").notNull().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull(),
  active: boolean("active").default(true).notNull(),
  jellyTeamId: text("jelly_team_id").notNull(),
  existsInJelly: boolean("exists_in_jelly")
    .notNull()
    .$default(() => true),
});
