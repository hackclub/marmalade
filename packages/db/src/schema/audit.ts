import {
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { jellyTeam } from "./team";

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp")
    .notNull()
    .$default(() => new Date()),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  jellyTeamId: text("jelly_team_id")
    .notNull()
    .references(() => jellyTeam.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  resourceId: text("resource_id").notNull(),
  status: text("status").notNull(),
  ipAddress: varchar("ip_address"),
  userAgent: text("user_agent"),
  changes: jsonb("changes"),
  metadata: jsonb("metadata"),
});
