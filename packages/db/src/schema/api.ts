import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { jellyTeam } from "./team";
import { user } from "./auth";

export const apiKey = pgTable("api_key", {
  id: serial("id").primaryKey(),
  keyPrefix: text("key_prefix").notNull().unique(),
  secretHash: text("secret_hash").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  jellyTeamId: text("jelly_team_id").notNull().references(() => jellyTeam.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at", { mode: "date" }),
  active: boolean("active").notNull().default(true),
  expiresAt: timestamp("expires_at", { mode: "date" }),
  revokedAt: timestamp("revoked_at", { mode: "date" }),
});

export const apiKeyScope = pgTable("api_key_scope", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("api_key_id")
    .notNull()
    .references(() => apiKey.id, { onDelete: "cascade" }),
  scopeMailbox: text("scope_mailbox").notNull(),
});
