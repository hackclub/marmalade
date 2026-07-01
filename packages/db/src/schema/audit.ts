import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp")
    .notNull()
    .$default(() => new Date()),
  userId: text("user_id").notNull(),
  teamId: text("team_id").notNull(),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  resourceId: integer("resource_id").notNull(),
  status: text("status").notNull(),
  ipAddress: varchar("ip_address"),
  userAgent: text("user_agent"),
  changes: jsonb("changes"),
  metadata: jsonb("metadata"),
});
