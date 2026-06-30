import { exists } from "drizzle-orm";
import { pgTable, text, boolean, serial } from "drizzle-orm/pg-core";
import { email } from "zod";

export const jellyTeamMember = pgTable("jelly_team_member", {
  id: text("id").notNull().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull(),
  active: boolean("active").default(true).notNull(),
  jellyTeamId: text("jelly_team_id").notNull(),
  existsInJelly: boolean("exists_in_jelly").notNull().$default(() => true),
});