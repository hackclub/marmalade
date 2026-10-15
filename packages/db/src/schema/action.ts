import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { apiKey } from "./api";
import { user } from "./auth";
import { jellyTeam } from "./team";

/**
 * Durable outbox for every mutating call Marmalade makes against Jelly.
 *
 * Writes are accepted, persisted, and only then dispatched, so a transient
 * Jelly failure or a rate-limit window defers the action instead of losing it.
 * The row doubles as the audit changelog: it holds the exact payload sent, the
 * actor that authorised it, every attempt, and the response Jelly returned.
 */
export const jellyAction = pgTable(
  "jelly_action",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    jellyTeamId: text("jelly_team_id")
      .notNull()
      .references(() => jellyTeam.id, { onDelete: "cascade" }),
    // Null for team-level actions (labels, contacts, autoresponder) that are
    // not scoped to a single mailbox.
    jellyMailboxId: text("jelly_mailbox_id"),
    actionType: text("action_type").notNull(),
    targetResourceType: text("target_resource_type").notNull(),
    // Null for create actions, which have no target until Jelly assigns one.
    targetResourceId: text("target_resource_id"),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    actorType: text("actor_type").notNull(),
    // Denormalised "api_key:12" / "user:abc" / "system:sync". Postgres treats
    // NULLs as distinct in a unique index, so a nullable apiKeyId/userId pair
    // could never dedupe; a single non-null actor key can.
    actorKey: text("actor_key").notNull(),
    apiKeyId: integer("api_key_id").references(() => apiKey.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    // Set when an attempt ends without a known outcome (timeout). The worker
    // re-reads the target before retrying, so non-idempotent actions such as
    // comment.create cannot be applied twice.
    needsReconcile: timestamp("needs_reconcile", { mode: "date" }),
    scheduledFor: timestamp("scheduled_for", { mode: "date" })
      .defaultNow()
      .notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { mode: "date" })
      .defaultNow()
      .notNull(),
    lockedAt: timestamp("locked_at", { mode: "date" }),
    lockedBy: text("locked_by"),
    lastError: jsonb("last_error"),
    jellyResponse: jsonb("jelly_response"),
    jellyResourceId: text("jelly_resource_id"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    completedAt: timestamp("completed_at", { mode: "date" }),
  },
  (t) => [
    // Drain query: claim the next runnable actions in due order.
    index("idx_jelly_action_drain").on(t.status, t.nextAttemptAt),
    index("idx_jelly_action_mailbox").on(t.jellyMailboxId, t.createdAt),
    index("idx_jelly_action_api_key").on(t.apiKeyId, t.createdAt),
    index("idx_jelly_action_type_status").on(t.actionType, t.status),
    index("idx_jelly_action_target").on(
      t.targetResourceType,
      t.targetResourceId,
    ),
    unique("jelly_action_actor_idempotency_key").on(
      t.actorKey,
      t.idempotencyKey,
    ),
  ],
);
