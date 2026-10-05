import { db } from "@marmalade-v2/db";
import {
  jellyCircuitState,
  jellyQuotaBucket,
} from "@marmalade-v2/db/schema/observability";
import { and, eq, sql } from "drizzle-orm";

export type QuotaWindow = "five_minute" | "day";
export type QuotaScope = "team" | "mailbox" | "api_key" | "user";

/**
 * Jelly publishes 100,000 requests per day per team (midnight UTC reset) and
 * 5,000 per 5 minutes. Marmalade stops short of both so that manual use, the
 * Jelly web UI, and any other integration on the same team still have room.
 */
export const JELLY_DAILY_LIMIT = 100_000;
export const JELLY_FIVE_MINUTE_LIMIT = 5_000;

export const TEAM_DAILY_CEILING = 80_000;
export const TEAM_FIVE_MINUTE_CEILING = 4_000;

/**
 * Share of the daily ceiling the background worker may spend. The remainder is
 * held for interactive traffic, so draining a large backlog cannot starve a
 * user waiting on a read.
 */
export const WORKER_DAILY_SHARE = 0.6;

export const WINDOW_MS: Record<QuotaWindow, number> = {
  five_minute: 5 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

export function windowStartFor(window: QuotaWindow, now = new Date()): Date {
  if (window === "day") {
    // Jelly's daily counter resets at midnight UTC, so ours must too.
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }
  const ms = WINDOW_MS.five_minute;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

export function windowEndFor(window: QuotaWindow, now = new Date()): Date {
  return new Date(windowStartFor(window, now).getTime() + WINDOW_MS[window]);
}

export type QuotaTarget = { scope: QuotaScope; scopeId: string };

/**
 * Increment happens before the HTTP call, in its own statement. If the process
 * dies between the increment and the request we over-count by one, which is
 * the safe direction: an over-count throttles us early, an under-count walks
 * us into a 429.
 */
export async function consumeQuota(
  targets: QuotaTarget[],
  now = new Date(),
): Promise<void> {
  if (targets.length === 0) return;

  const rows = targets.flatMap(({ scope, scopeId }) =>
    (["five_minute", "day"] as QuotaWindow[]).map((window) => ({
      scope,
      scopeId,
      window,
      windowStart: windowStartFor(window, now),
      count: 1,
    })),
  );

  await db
    .insert(jellyQuotaBucket)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        jellyQuotaBucket.scope,
        jellyQuotaBucket.scopeId,
        jellyQuotaBucket.window,
        jellyQuotaBucket.windowStart,
      ],
      set: { count: sql`${jellyQuotaBucket.count} + 1`, updatedAt: now },
    });
}

export async function readQuota(
  scope: QuotaScope,
  scopeId: string,
  window: QuotaWindow,
  now = new Date(),
): Promise<number> {
  const [row] = await db
    .select({ count: jellyQuotaBucket.count })
    .from(jellyQuotaBucket)
    .where(
      and(
        eq(jellyQuotaBucket.scope, scope),
        eq(jellyQuotaBucket.scopeId, scopeId),
        eq(jellyQuotaBucket.window, window),
        eq(jellyQuotaBucket.windowStart, windowStartFor(window, now)),
      ),
    )
    .limit(1);
  return row?.count ?? 0;
}

export type QuotaVerdict =
  { allowed: true } | { allowed: false; reason: string; retryAt: Date };

export type QuotaCheckOptions = {
  /** Apply the worker's reduced share of the daily ceiling. */
  worker?: boolean;
};

/**
 * Team-level ceilings only. Per-key and per-mailbox allocation is layered on
 * top of this in the rate-limit management work.
 */
export async function checkTeamQuota(
  teamId: string,
  options: QuotaCheckOptions = {},
  now = new Date(),
): Promise<QuotaVerdict> {
  const dailyCeiling = options.worker
    ? Math.floor(TEAM_DAILY_CEILING * WORKER_DAILY_SHARE)
    : TEAM_DAILY_CEILING;

  const [daily, burst] = await Promise.all([
    readQuota("team", teamId, "day", now),
    readQuota("team", teamId, "five_minute", now),
  ]);

  if (daily >= dailyCeiling) {
    return {
      allowed: false,
      reason: `Daily Jelly request ceiling reached (${daily}/${dailyCeiling})`,
      retryAt: windowEndFor("day", now),
    };
  }

  if (burst >= TEAM_FIVE_MINUTE_CEILING) {
    return {
      allowed: false,
      reason: `Short-term Jelly request ceiling reached (${burst}/${TEAM_FIVE_MINUTE_CEILING})`,
      retryAt: windowEndFor("five_minute", now),
    };
  }

  return { allowed: true };
}

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_PAUSE_SECONDS = 60;

export type CircuitVerdict =
  { open: false } | { open: true; reason: string; retryAt: Date };

export async function checkCircuit(
  scope: QuotaScope,
  scopeId: string,
  now = new Date(),
): Promise<CircuitVerdict> {
  const [row] = await db
    .select()
    .from(jellyCircuitState)
    .where(
      and(
        eq(jellyCircuitState.scope, scope),
        eq(jellyCircuitState.scopeId, scopeId),
      ),
    )
    .limit(1);

  if (row?.pausedUntil && row.pausedUntil > now) {
    return {
      open: true,
      reason: row.pausedReason ?? "Jelly requests are paused",
      retryAt: row.pausedUntil,
    };
  }
  return { open: false };
}

export async function recordCircuitSuccess(
  scope: QuotaScope,
  scopeId: string,
  now = new Date(),
): Promise<void> {
  await db
    .insert(jellyCircuitState)
    .values({
      scope,
      scopeId,
      consecutiveFailures: 0,
      pausedUntil: null,
      pausedReason: null,
      lastSuccessAt: now,
    })
    .onConflictDoUpdate({
      target: [jellyCircuitState.scope, jellyCircuitState.scopeId],
      set: {
        consecutiveFailures: 0,
        pausedUntil: null,
        pausedReason: null,
        lastSuccessAt: now,
        updatedAt: now,
      },
    });
}

/**
 * A 429 pauses the bucket for exactly as long as Jelly asked. Repeated 5xx
 * pauses it too, so a fleet of workers cannot convert one upstream wobble into
 * a thousand simultaneous retries.
 */
export async function recordCircuitFailure(
  scope: QuotaScope,
  scopeId: string,
  options: { throttled: boolean; retryAfterSeconds: number | null },
  now = new Date(),
): Promise<void> {
  const [existing] = await db
    .select({ consecutiveFailures: jellyCircuitState.consecutiveFailures })
    .from(jellyCircuitState)
    .where(
      and(
        eq(jellyCircuitState.scope, scope),
        eq(jellyCircuitState.scopeId, scopeId),
      ),
    )
    .limit(1);

  const failures = (existing?.consecutiveFailures ?? 0) + 1;

  let pausedUntil: Date | null = null;
  let pausedReason: string | null = null;

  if (options.throttled) {
    const seconds = options.retryAfterSeconds ?? CIRCUIT_PAUSE_SECONDS;
    pausedUntil = new Date(now.getTime() + seconds * 1000);
    pausedReason = `Jelly returned 429; honouring Retry-After of ${seconds}s`;
  } else if (failures >= CIRCUIT_FAILURE_THRESHOLD) {
    pausedUntil = new Date(now.getTime() + CIRCUIT_PAUSE_SECONDS * 1000);
    pausedReason = `${failures} consecutive Jelly failures`;
  }

  await db
    .insert(jellyCircuitState)
    .values({
      scope,
      scopeId,
      consecutiveFailures: failures,
      pausedUntil,
      pausedReason,
      lastFailureAt: now,
    })
    .onConflictDoUpdate({
      target: [jellyCircuitState.scope, jellyCircuitState.scopeId],
      set: {
        consecutiveFailures: failures,
        // Never shorten an existing pause by overwriting it with a smaller one.
        pausedUntil: pausedUntil
          ? sql`greatest(coalesce(${jellyCircuitState.pausedUntil}, to_timestamp(0)), ${pausedUntil.toISOString()}::timestamp)`
          : jellyCircuitState.pausedUntil,
        pausedReason: pausedReason ?? jellyCircuitState.pausedReason,
        lastFailureAt: now,
        updatedAt: now,
      },
    });
}
