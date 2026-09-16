import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { apiKey } from "./api";
import { user } from "./auth";

/**
 * One row per outbound HTTP call to Jelly, reads included.
 *
 * Sync jobs and proxied reads spend the same team-wide quota as writes, so
 * anything that does not pass through here is invisible budget.
 */
export const jellyRequestLog = pgTable(
  "jelly_request_log",
  {
    id: serial("id").primaryKey(),
    actionId: text("action_id"),
    method: text("method").notNull(),
    // Templated, e.g. "/conversations/:id/archive", so rows group by endpoint
    // rather than fragmenting across every resource id.
    path: text("path").notNull(),
    statusCode: integer("status_code"),
    durationMs: integer("duration_ms").notNull(),
    retryAfterSeconds: integer("retry_after_seconds"),
    error: text("error"),
    actorType: text("actor_type").notNull().default("system"),
    apiKeyId: integer("api_key_id").references(() => apiKey.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_jelly_request_log_created_at").on(t.createdAt),
    index("idx_jelly_request_log_status").on(t.statusCode, t.createdAt),
    index("idx_jelly_request_log_path").on(t.path, t.createdAt),
    index("idx_jelly_request_log_action").on(t.actionId),
  ],
);

/**
 * Rolling request counters.
 *
 * Jelly allows 100,000 requests per day per team (midnight UTC reset) and
 * 5,000 per 5 minutes. Marmalade counts against ceilings set below those so
 * one consumer cannot exhaust the budget the whole team shares.
 */
export const jellyQuotaBucket = pgTable(
  "jelly_quota_bucket",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(), // team | mailbox | api_key | user
    scopeId: text("scope_id").notNull(),
    window: text("window").notNull(), // five_minute | day
    windowStart: timestamp("window_start", { mode: "date" }).notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    unique("jelly_quota_bucket_key").on(
      t.scope,
      t.scopeId,
      t.window,
      t.windowStart,
    ),
    index("idx_jelly_quota_bucket_window").on(t.window, t.windowStart),
  ],
);

/**
 * Circuit breaker state, persisted because serverless instances share no
 * memory: a 429 seen by one instance must pause every other instance too.
 */
export const jellyCircuitState = pgTable(
  "jelly_circuit_state",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    scopeId: text("scope_id").notNull(),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    pausedUntil: timestamp("paused_until", { mode: "date" }),
    pausedReason: text("paused_reason"),
    lastFailureAt: timestamp("last_failure_at", { mode: "date" }),
    lastSuccessAt: timestamp("last_success_at", { mode: "date" }),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [unique("jelly_circuit_state_key").on(t.scope, t.scopeId)],
);

/**
 * Heartbeat for the action worker, so /admin/health can tell "no work to do"
 * apart from "nothing is draining the queue".
 */
export const workerHeartbeat = pgTable("worker_heartbeat", {
  id: text("id").primaryKey(),
  lastRunAt: timestamp("last_run_at", { mode: "date" }).defaultNow().notNull(),
  lastClaimedCount: integer("last_claimed_count").notNull().default(0),
  lastDurationMs: integer("last_duration_ms").notNull().default(0),
  lastError: text("last_error"),
});
