import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { apiKey } from "./api";
import { user } from "./auth";
import { jellyTeam } from "./team";

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp")
    .notNull()
    .$default(() => new Date()),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  apiKeyId: integer("api_key_id").references(() => apiKey.id, {
    onDelete: "set null",
  }),
  jellyTeamId: text("jelly_team_id")
    .notNull()
    .references(() => jellyTeam.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  resourceId: text("resource_id").notNull(),
  status: text("status").notNull(),
  ipAddress: varchar("ip_address"),
  userAgent: text("user_agent"),
  changes: jsonb("changes"),
  metadata: jsonb("metadata"),
});
