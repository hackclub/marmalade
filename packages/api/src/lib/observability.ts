import { db } from "@marmalade-v2/db";
import { jellyAction } from "@marmalade-v2/db/schema/action";
import {
  jellyRequestLog,
  jellyWebhookDelivery,
  usageRollup,
  workerHeartbeat,
} from "@marmalade-v2/db/schema/observability";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";

/** Webhook event types Jelly can send, so a missing one is visible as absent. */
export const JELLY_WEBHOOK_EVENTS = [
  "new_message",
  "assigned",
  "comment_added",
  "conversation_archived",
  "conversation_unarchived",
] as const;

/**
 * Jelly deactivates a webhook after 10 consecutive failures in 24 hours and
 * never retries, so warn well before that.
 */
export const WEBHOOK_FAILURE_WARN_THRESHOLD = 3;
export const WEBHOOK_FAILURE_LIMIT = 10;

export async function recordWebhookDelivery(input: {
  event: string;
  status: "accepted" | "skipped" | "rejected" | "failed";
  error?: string | null;
  durationMs?: number | null;
}): Promise<void> {
  try {
    await db.insert(jellyWebhookDelivery).values({
      event: input.event,
      status: input.status,
      error: input.error ?? null,
      durationMs: input.durationMs ?? null,
    });
  } catch (error) {
    console.warn("Failed to record webhook delivery", error);
  }
}

export async function webhookHealth(now = new Date()) {
  const perEvent = await db
    .select({
      event: jellyWebhookDelivery.event,
      lastReceivedAt: sql<Date>`max(${jellyWebhookDelivery.receivedAt})`,
      total: sql<number>`count(*)::int`,
      failures: sql<number>`count(*) filter (where ${jellyWebhookDelivery.status} in ('rejected','failed'))::int`,
    })
    .from(jellyWebhookDelivery)
    .where(
      gte(
        jellyWebhookDelivery.receivedAt,
        new Date(now.getTime() - 24 * 60 * 60 * 1000),
      ),
    )
    .groupBy(jellyWebhookDelivery.event);

  // Consecutive failures matter more than the total: that is the counter
  // Jelly itself uses to decide whether to switch the webhook off.
  const recent = await db
    .select({ status: jellyWebhookDelivery.status })
    .from(jellyWebhookDelivery)
    .orderBy(desc(jellyWebhookDelivery.receivedAt))
    .limit(WEBHOOK_FAILURE_LIMIT);

  let consecutiveFailures = 0;
  for (const row of recent) {
    if (row.status === "rejected" || row.status === "failed") {
      consecutiveFailures++;
    } else break;
  }

  const byEvent = new Map(perEvent.map((row) => [row.event, row]));

  return {
    consecutiveFailures,
    atRisk: consecutiveFailures >= WEBHOOK_FAILURE_WARN_THRESHOLD,
    limit: WEBHOOK_FAILURE_LIMIT,
    events: JELLY_WEBHOOK_EVENTS.map((event) => {
      const row = byEvent.get(event);
      return {
        event,
        lastReceivedAt: row?.lastReceivedAt ?? null,
        received24h: row?.total ?? 0,
        failures24h: row?.failures ?? 0,
      };
    }),
  };
}

export async function workerHealth(now = new Date()) {
  const [heartbeat] = await db
    .select()
    .from(workerHeartbeat)
    .where(eq(workerHeartbeat.id, "action-drain"))
    .limit(1);

  const staleAfterMs = 5 * 60 * 1000;
  const lastRunAt = heartbeat?.lastRunAt ?? null;

  return {
    lastRunAt,
    lastClaimedCount: heartbeat?.lastClaimedCount ?? 0,
    lastDurationMs: heartbeat?.lastDurationMs ?? 0,
    lastError: heartbeat?.lastError ?? null,
    // No heartbeat at all is as bad as a stale one: nothing is draining.
    stalled: !lastRunAt || now.getTime() - lastRunAt.getTime() > staleAfterMs,
  };
}

/**
 * Queue shape. `oldestPendingAt` is the single most useful number on the
 * health page: if it climbs, something is wrong regardless of what else looks
 * fine.
 */
export async function queueHealth(teamId: string) {
  const rows = await db
    .select({
      status: jellyAction.status,
      count: sql<number>`count(*)::int`,
      oldest: sql<Date | null>`min(${jellyAction.createdAt})`,
    })
    .from(jellyAction)
    .where(eq(jellyAction.jellyTeamId, teamId))
    .groupBy(jellyAction.status);

  const counts: Record<string, number> = {};
  let oldestPendingAt: Date | null = null;

  for (const row of rows) {
    counts[row.status] = row.count;
    if (
      (row.status === "pending" ||
        row.status === "scheduled" ||
        row.status === "awaiting_approval") &&
      row.oldest &&
      (!oldestPendingAt || row.oldest < oldestPendingAt)
    ) {
      oldestPendingAt = row.oldest;
    }
  }

  return {
    counts,
    oldestPendingAt,
    oldestPendingAgeMs: oldestPendingAt
      ? Date.now() - oldestPendingAt.getTime()
      : null,
    deadLetters: counts.dead ?? 0,
    inFlight: counts.in_flight ?? 0,
    awaitingApproval: counts.awaiting_approval ?? 0,
  };
}

function statusClass(statusCode: number | null): string {
  if (statusCode === null) return "server_error";
  if (statusCode === 429) return "throttled";
  if (statusCode >= 500) return "server_error";
  if (statusCode >= 400) return "client_error";
  return "success";
}

function groupKey(parts: string[]): string {
  return JSON.stringify(parts);
}

/**
 * Fold whole hours of `jelly_request_log` into `usage_rollup`, per actor
 * scope.
 *
 * Only hours that have already elapsed are rolled up, so a bucket is never
 * written while it can still receive new rows.
 */
export async function rollUpUsage(
  options: { hours?: number } = {},
): Promise<{ buckets: number; rows: number }> {
  const hours = options.hours ?? 3;
  const now = new Date();
  const currentHour = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
    ),
  );

  let bucketsProcessed = 0;
  let rowsWritten = 0;

  for (let offset = 1; offset <= hours; offset++) {
    const bucketStart = new Date(
      currentHour.getTime() - offset * 60 * 60 * 1000,
    );
    const bucketEnd = new Date(bucketStart.getTime() + 60 * 60 * 1000);

    const logs = await db
      .select({
        path: jellyRequestLog.path,
        statusCode: jellyRequestLog.statusCode,
        durationMs: jellyRequestLog.durationMs,
        apiKeyId: jellyRequestLog.apiKeyId,
        userId: jellyRequestLog.userId,
      })
      .from(jellyRequestLog)
      .where(
        and(
          gte(jellyRequestLog.createdAt, bucketStart),
          lt(jellyRequestLog.createdAt, bucketEnd),
        ),
      );

    if (logs.length === 0) continue;
    bucketsProcessed++;

    const groups = new Map<
      string,
      {
        scope: string;
        scopeId: string;
        dimension: string;
        status: string;
        durations: number[];
      }
    >();

    const add = (
      scope: string,
      scopeId: string,
      dimension: string,
      status: string,
      duration: number,
    ) => {
      const key = groupKey([scope, scopeId, dimension, status]);
      let group = groups.get(key);
      if (!group) {
        group = { scope, scopeId, dimension, status, durations: [] };
        groups.set(key, group);
      }
      group.durations.push(duration);
    };

    for (const log of logs) {
      const status = statusClass(log.statusCode);
      add("team", "all", log.path, status, log.durationMs);
      if (log.apiKeyId != null) {
        add("api_key", String(log.apiKeyId), log.path, status, log.durationMs);
      }
      if (log.userId) {
        add("user", log.userId, log.path, status, log.durationMs);
      }
    }

    const values = Array.from(groups.values()).map((group) => {
      const sorted = group.durations.sort((a, b) => a - b);
      const at = (q: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
      return {
        bucketHour: bucketStart,
        scope: group.scope,
        scopeId: group.scopeId,
        dimension: group.dimension,
        status: group.status,
        count: sorted.length,
        errorCount: group.status === "success" ? 0 : sorted.length,
        p50Ms: at(0.5),
        p95Ms: at(0.95),
      };
    });

    for (let i = 0; i < values.length; i += 500) {
      const chunk = values.slice(i, i + 500);
      await db
        .insert(usageRollup)
        .values(chunk)
        .onConflictDoUpdate({
          target: [
            usageRollup.bucketHour,
            usageRollup.scope,
            usageRollup.scopeId,
            usageRollup.dimension,
            usageRollup.status,
          ],
          set: {
            count: sql`excluded.count`,
            errorCount: sql`excluded.error_count`,
            p50Ms: sql`excluded.p50_ms`,
            p95Ms: sql`excluded.p95_ms`,
          },
        });
      rowsWritten += chunk.length;
    }
  }

  return { buckets: bucketsProcessed, rows: rowsWritten };
}

/**
 * Raw request logs are only needed until they have been rolled up. Keeping
 * them forever turns the most-written table in the schema into the largest.
 */
export async function pruneRequestLogs(retentionDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(jellyRequestLog)
    .where(lt(jellyRequestLog.createdAt, cutoff))
    .returning({ id: jellyRequestLog.id });
  return deleted.length;
}

export async function pruneWebhookDeliveries(
  retentionDays = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(jellyWebhookDelivery)
    .where(lt(jellyWebhookDelivery.receivedAt, cutoff))
    .returning({ id: jellyWebhookDelivery.id });
  return deleted.length;
}
