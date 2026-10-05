import { db } from "@marmalade-v2/db";
import { jellyAction } from "@marmalade-v2/db/schema/action";
import { auditLog } from "@marmalade-v2/db/schema/audit";
import { workerHeartbeat } from "@marmalade-v2/db/schema/observability";
import { env } from "@marmalade-v2/env/server";
import { and, eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { getJellyClient, type JellyRequestMeta } from "../jelly";
import { JellyApiError } from "../jelly-errors";
import { getActionDefinition } from "./catalogue";

export type ActionRow = typeof jellyAction.$inferSelect;

export type ActionStatus =
  | "pending"
  | "scheduled"
  | "in_flight"
  | "succeeded"
  | "failed"
  | "dead"
  | "cancelled";

export const TERMINAL_STATUSES: ActionStatus[] = [
  "succeeded",
  "failed",
  "dead",
  "cancelled",
];

/**
 * Lexicographically sortable id: a zero-padded base36 timestamp followed by
 * randomness. Ordering by id is ordering by creation time, without pulling in
 * a ULID dependency.
 */
export function generateActionId(): string {
  const time = Date.now().toString(36).padStart(9, "0");
  return `act_${time}${randomBytes(8).toString("hex")}`;
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalise(v)]),
    );
  }
  return value;
}

/**
 * When a client supplies no Idempotency-Key, derive one from the request
 * itself bucketed into 60-second windows. That absorbs double-taps and
 * over-eager client retries without rejecting a genuinely repeated action such
 * as two different comments, or the same comment sent an hour apart.
 *
 * The digest is a content fingerprint, not a credential hash: it exists to
 * make "the same request twice" recognisable, and it is only ever compared
 * against other derived keys. SHA-256 is the right tool and a deliberately
 * slow KDF would be the wrong one, since this runs on every write.
 *
 * The actor is deliberately *not* part of the digest. Uniqueness is enforced
 * by `unique(actor_key, idempotency_key)` and every lookup filters on the
 * actor too, so mixing it into the hash would be redundant — and hashing
 * anything derived from an API key here invites the reasonable question of
 * whether a secret is being hashed with insufficient effort. Nothing secret
 * belongs in this function.
 */
export function deriveIdempotencyKey(input: {
  actionType: string;
  targetResourceId: string | null;
  payload: unknown;
  now?: Date;
}): string {
  const bucket = Math.floor((input.now ?? new Date()).getTime() / 60_000);
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        input.actionType,
        input.targetResourceId ?? "",
        canonicalise(input.payload),
        bucket,
      ]),
    )
    .digest("hex");
  return `auto_${digest.slice(0, 40)}`;
}

/** Transient failures: 1s, 4s, 15s, 1m, 5m, 30m, 2h, then dead. */
const TRANSIENT_BACKOFF_SECONDS = [1, 4, 15, 60, 300, 1800, 7200];
/** A contended draft lock is worth waiting out, but not forever. */
const CONTENDED_BACKOFF_SECONDS = [60, 300, 900];
const CONTENDED_MAX_ATTEMPTS = 4;
const MAX_THROTTLED_AGE_MS = 24 * 60 * 60 * 1000;

function jitter(seconds: number): number {
  return Math.max(1, Math.round(seconds * (0.5 + Math.random() * 0.5)));
}

export type EnqueueInput = {
  actionType: string;
  targetResourceId: string | null;
  jellyMailboxId: string | null;
  payload: Record<string, unknown>;
  actorType: "api_key" | "user" | "system";
  apiKeyId?: number | null;
  userId?: string | null;
  idempotencyKey?: string | null;
  scheduledFor?: Date | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export function actorKeyFor(input: {
  actorType: string;
  apiKeyId?: number | null;
  userId?: string | null;
}): string {
  if (input.actorType === "api_key" && input.apiKeyId != null) {
    return `api_key:${input.apiKeyId}`;
  }
  if (input.actorType === "user" && input.userId) return `user:${input.userId}`;
  return "system:marmalade";
}

export type EnqueueResult = {
  action: ActionRow;
  /** True when an identical action was already accepted and this is a replay. */
  deduplicated: boolean;
};

export async function enqueueAction(
  input: EnqueueInput,
): Promise<EnqueueResult> {
  const definition = getActionDefinition(input.actionType);
  if (!definition) {
    throw new Error(`Unknown action type: ${input.actionType}`);
  }

  const actorKey = actorKeyFor(input);
  const idempotencyKey =
    input.idempotencyKey ??
    deriveIdempotencyKey({
      actionType: input.actionType,
      targetResourceId: input.targetResourceId,
      payload: input.payload,
    });

  const scheduledFor = input.scheduledFor ?? new Date();

  const [inserted] = await db
    .insert(jellyAction)
    .values({
      id: generateActionId(),
      idempotencyKey,
      jellyTeamId: env.JELLY_TEAM_ID,
      jellyMailboxId: input.jellyMailboxId,
      actionType: input.actionType,
      targetResourceType: definition.resourceType,
      targetResourceId: input.targetResourceId,
      payload: input.payload,
      status: scheduledFor > new Date() ? "scheduled" : "pending",
      actorType: input.actorType,
      actorKey,
      apiKeyId: input.apiKeyId ?? null,
      userId: input.userId ?? null,
      maxAttempts: definition.idempotent || definition.reconcile ? 8 : 3,
      scheduledFor,
      nextAttemptAt: scheduledFor,
    })
    .onConflictDoNothing({
      target: [jellyAction.actorKey, jellyAction.idempotencyKey],
    })
    .returning();

  if (!inserted) {
    const [existing] = await db
      .select()
      .from(jellyAction)
      .where(
        and(
          eq(jellyAction.actorKey, actorKey),
          eq(jellyAction.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error("Failed to enqueue action and no existing action found");
    }
    return { action: existing, deduplicated: true };
  }

  await db.insert(auditLog).values({
    userId: input.userId ?? null,
    apiKeyId: input.apiKeyId ?? null,
    jellyTeamId: env.JELLY_TEAM_ID,
    action: "enqueue",
    resource: "jelly_action",
    resourceId: inserted.id,
    status: "accepted",
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    changes: input.payload,
    metadata: {
      actionType: input.actionType,
      targetResourceId: input.targetResourceId,
      jellyMailboxId: input.jellyMailboxId,
      scheduledFor: scheduledFor.toISOString(),
    },
  });

  return { action: inserted, deduplicated: false };
}

function metaFor(action: ActionRow, worker: boolean): JellyRequestMeta {
  return {
    actionId: action.id,
    actorType: action.actorType,
    apiKeyId: action.apiKeyId,
    userId: action.userId,
    worker,
    quotaTargets: [
      ...(action.jellyMailboxId
        ? ([{ scope: "mailbox", scopeId: action.jellyMailboxId }] as const)
        : []),
      ...(action.apiKeyId
        ? ([{ scope: "api_key", scopeId: String(action.apiKeyId) }] as const)
        : []),
    ],
  };
}

async function markSucceeded(
  action: ActionRow,
  result: { response: unknown; resourceId?: string | null },
): Promise<ActionRow> {
  const definition = getActionDefinition(action.actionType);

  if (definition?.applyToMirror) {
    try {
      await definition.applyToMirror({
        targetResourceId: action.targetResourceId,
        payload: action.payload as Record<string, unknown>,
        response: result.response,
        resourceId: result.resourceId ?? null,
      });
    } catch (error) {
      // The write succeeded upstream; a stale mirror is recoverable, undoing
      // the Jelly change is not. Log loudly and move on.
      console.error(
        `Action ${action.id} succeeded but mirror write-back failed`,
        error,
      );
    }
  }

  const [updated] = await db
    .update(jellyAction)
    .set({
      status: "succeeded",
      jellyResponse: (result.response ?? null) as never,
      jellyResourceId: result.resourceId ?? null,
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      needsReconcile: null,
      lastError: null,
    })
    .where(eq(jellyAction.id, action.id))
    .returning();

  await db.insert(auditLog).values({
    userId: action.userId,
    apiKeyId: action.apiKeyId,
    jellyTeamId: action.jellyTeamId,
    action: action.actionType,
    resource: action.targetResourceType,
    resourceId: action.targetResourceId ?? result.resourceId ?? action.id,
    status: "success",
    metadata: { actionId: action.id, attempts: action.attempts + 1 },
  });

  return updated ?? action;
}

async function markTerminalFailure(
  action: ActionRow,
  error: JellyApiError | Error,
  status: "failed" | "dead",
): Promise<ActionRow> {
  const serialised =
    error instanceof JellyApiError
      ? error.toJSON()
      : { kind: "unknown", status: null, message: error.message };

  const [updated] = await db
    .update(jellyAction)
    .set({
      status,
      lastError: serialised as never,
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
    })
    .where(eq(jellyAction.id, action.id))
    .returning();

  await db.insert(auditLog).values({
    userId: action.userId,
    apiKeyId: action.apiKeyId,
    jellyTeamId: action.jellyTeamId,
    action: action.actionType,
    resource: action.targetResourceType,
    resourceId: action.targetResourceId ?? action.id,
    status,
    metadata: { actionId: action.id, error: serialised },
  });

  return updated ?? action;
}

async function scheduleRetry(
  action: ActionRow,
  error: JellyApiError,
): Promise<ActionRow> {
  const throttled = error.kind === "throttled";

  // Throttling means "not yet", not "this is going wrong". Counting a 429
  // against the retry budget turns a busy hour into a pile of dead letters.
  const attempts = throttled ? action.attempts : action.attempts + 1;

  let delaySeconds: number;
  if (throttled) {
    delaySeconds = error.retryAfterSeconds ?? 60;
  } else if (error.kind === "contended") {
    delaySeconds =
      CONTENDED_BACKOFF_SECONDS[
        Math.min(attempts - 1, CONTENDED_BACKOFF_SECONDS.length - 1)
      ]!;
  } else {
    delaySeconds = jitter(
      TRANSIENT_BACKOFF_SECONDS[
        Math.min(attempts - 1, TRANSIENT_BACKOFF_SECONDS.length - 1)
      ]!,
    );
  }

  const [updated] = await db
    .update(jellyAction)
    .set({
      status: "pending",
      attempts,
      nextAttemptAt: new Date(Date.now() + delaySeconds * 1000),
      lastError: error.toJSON() as never,
      lockedAt: null,
      lockedBy: null,
      // A request that may or may not have landed must be checked, not
      // repeated, before the next attempt.
      needsReconcile: error.outcomeUnknown ? new Date() : action.needsReconcile,
    })
    .where(eq(jellyAction.id, action.id))
    .returning();

  return updated ?? action;
}

/**
 * Run one action against Jelly and record the outcome.
 *
 * Never throws for an expected upstream failure: the returned row carries the
 * new status. Callers decide how to present `pending` versus `failed`.
 */
export async function executeAction(
  action: ActionRow,
  options: { worker?: boolean } = {},
): Promise<ActionRow> {
  const definition = getActionDefinition(action.actionType);
  if (!definition) {
    return markTerminalFailure(
      action,
      new Error(`Unknown action type: ${action.actionType}`),
      "dead",
    );
  }

  const client = getJellyClient();
  const meta = metaFor(action, options.worker ?? false);
  const ctx = {
    client,
    meta,
    targetResourceId: action.targetResourceId,
    payload: (action.payload ?? {}) as Record<string, unknown>,
  };

  // A previous attempt ended without a known outcome. For a non-idempotent
  // action, check whether it already applied before trying again.
  if (action.needsReconcile && definition.reconcile) {
    try {
      const reconciled = await definition.reconcile(ctx);
      if (reconciled) return markSucceeded(action, reconciled);
      await db
        .update(jellyAction)
        .set({ needsReconcile: null })
        .where(eq(jellyAction.id, action.id));
    } catch (error) {
      if (error instanceof JellyApiError && error.retryable) {
        return scheduleRetry(action, error);
      }
      // Reconciliation is best-effort; fall through and let the normal
      // classification decide.
    }
  }

  if (
    action.needsReconcile &&
    !definition.reconcile &&
    !definition.idempotent
  ) {
    // No safe way to tell whether this applied, and repeating it could
    // duplicate a side effect. Surface it for a human instead of guessing.
    return markTerminalFailure(
      action,
      new Error(
        "Attempt ended with an unknown outcome and this action type cannot be " +
          "safely retried. Verify in Jelly, then retry or cancel from the admin queue.",
      ),
      "failed",
    );
  }

  try {
    const result = await definition.execute(ctx);
    return await markSucceeded(action, result);
  } catch (error) {
    if (!(error instanceof JellyApiError)) {
      return markTerminalFailure(
        action,
        error instanceof Error ? error : new Error(String(error)),
        "failed",
      );
    }

    // Jelly documents that draft_reply returns the *existing* draft with 409
    // when one is already present. That is the outcome we wanted.
    if (
      error.kind === "conflict" &&
      action.actionType === "draft_reply.create"
    ) {
      const body = error.body as { id?: string } | null;
      return markSucceeded(action, {
        response: body,
        resourceId: body?.id ?? null,
      });
    }

    if (error.kind === "credential") {
      // The team token is broken; every queued action will fail identically.
      return markTerminalFailure(action, error, "dead");
    }

    if (!error.retryable) {
      return markTerminalFailure(action, error, "failed");
    }

    // A throttled action does not spend retry budget, so bound it by age
    // instead: something stuck behind a quota wall for a day is not coming
    // back on its own and should be visible to a human.
    if (
      error.kind === "throttled" &&
      Date.now() - action.createdAt.getTime() > MAX_THROTTLED_AGE_MS
    ) {
      return markTerminalFailure(action, error, "dead");
    }

    const attemptsAfter =
      error.kind === "throttled" ? action.attempts : action.attempts + 1;
    const ceiling =
      error.kind === "contended" ? CONTENDED_MAX_ATTEMPTS : action.maxAttempts;

    if (attemptsAfter >= ceiling) {
      return markTerminalFailure(action, error, "dead");
    }

    return scheduleRetry(action, error);
  }
}

/** Reclaim actions whose worker died mid-flight. */
export async function reapStaleLeases(leaseMs = 120_000): Promise<number> {
  const result = await db
    .update(jellyAction)
    .set({ status: "pending", lockedAt: null, lockedBy: null })
    .where(
      and(
        eq(jellyAction.status, "in_flight"),
        sql`${jellyAction.lockedAt} < now() - ${sql.raw(`interval '${Math.floor(leaseMs / 1000)} seconds'`)}`,
      ),
    )
    .returning({ id: jellyAction.id });
  return result.length;
}

/**
 * Claim and run the next batch of due actions.
 *
 * `FOR UPDATE SKIP LOCKED` is what lets several workers drain the same queue
 * without a separate lock service: each claims a disjoint set or gets nothing.
 */
export async function drainActions(
  options: { limit?: number; workerId?: string } = {},
): Promise<{
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
}> {
  const limit = options.limit ?? 25;
  const workerId =
    options.workerId ?? `worker_${randomBytes(4).toString("hex")}`;
  const started = Date.now();

  await reapStaleLeases();

  const claimed = await db.execute<ActionRow>(sql`
    UPDATE jelly_action
    SET status = 'in_flight', locked_at = now(), locked_by = ${workerId}
    WHERE id IN (
      SELECT id FROM jelly_action
      WHERE status IN ('pending', 'scheduled')
        AND next_attempt_at <= now()
        AND scheduled_for <= now()
      ORDER BY next_attempt_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING *
  `);

  const rows = (claimed.rows ?? []) as unknown as ActionRow[];
  let succeeded = 0;
  let retried = 0;
  let failed = 0;
  let lastError: string | null = null;

  for (const row of rows) {
    try {
      // Drizzle returns snake_case keys from a raw query; re-read through the
      // typed select so downstream code sees the camelCase shape it expects.
      const [typed] = await db
        .select()
        .from(jellyAction)
        .where(eq(jellyAction.id, row.id))
        .limit(1);
      if (!typed) continue;

      const result = await executeAction(typed, { worker: true });
      if (result.status === "succeeded") succeeded++;
      else if (result.status === "pending" || result.status === "scheduled")
        retried++;
      else failed++;
    } catch (error) {
      failed++;
      lastError = error instanceof Error ? error.message : String(error);
      console.error("Action drain failed for", row.id, error);
    }
  }

  await db
    .insert(workerHeartbeat)
    .values({
      id: "action-drain",
      lastRunAt: new Date(),
      lastClaimedCount: rows.length,
      lastDurationMs: Date.now() - started,
      lastError,
    })
    .onConflictDoUpdate({
      target: workerHeartbeat.id,
      set: {
        lastRunAt: new Date(),
        lastClaimedCount: rows.length,
        lastDurationMs: Date.now() - started,
        lastError,
      },
    });

  return { claimed: rows.length, succeeded, retried, failed };
}

/**
 * Best-effort synchronous dispatch, so the common case behaves like a plain
 * API call. If it does not settle inside the budget the action stays queued
 * and the worker picks it up; the caller gets 202 rather than a lie.
 */
export async function dispatchInline(
  action: ActionRow,
  budgetMs = 4000,
): Promise<ActionRow> {
  const [claimed] = await db
    .update(jellyAction)
    .set({ status: "in_flight", lockedAt: new Date(), lockedBy: "inline" })
    .where(
      and(eq(jellyAction.id, action.id), eq(jellyAction.status, "pending")),
    )
    .returning();

  if (!claimed) return action;

  let settled = false;
  const run = executeAction(claimed).then((result) => {
    settled = true;
    return result;
  });

  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), budgetMs),
  );

  const winner = await Promise.race([run, timeout]);
  if (winner) return winner;

  // Let the in-flight attempt finish and record itself; the lease reaper
  // covers the case where this process dies first.
  void run.catch((error) => {
    if (!settled) console.error("Inline dispatch failed after budget", error);
  });

  const [current] = await db
    .select()
    .from(jellyAction)
    .where(eq(jellyAction.id, action.id))
    .limit(1);
  return current ?? claimed;
}

export async function cancelAction(
  actionId: string,
  reason: string,
): Promise<ActionRow | null> {
  const [updated] = await db
    .update(jellyAction)
    .set({
      status: "cancelled",
      completedAt: new Date(),
      lastError: { kind: "cancelled", message: reason } as never,
    })
    .where(
      and(
        eq(jellyAction.id, actionId),
        sql`${jellyAction.status} in ('pending', 'scheduled')`,
      ),
    )
    .returning();
  return updated ?? null;
}

export async function retryAction(actionId: string): Promise<ActionRow | null> {
  const [updated] = await db
    .update(jellyAction)
    .set({
      status: "pending",
      nextAttemptAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      completedAt: null,
    })
    .where(
      and(
        eq(jellyAction.id, actionId),
        sql`${jellyAction.status} in ('failed', 'dead', 'cancelled')`,
      ),
    )
    .returning();
  return updated ?? null;
}
