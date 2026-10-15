import { db } from "@marmalade-v2/db";
import {
  jellyCircuitState,
  jellyQuotaBucket,
  quotaPolicy,
} from "@marmalade-v2/db/schema/observability";
import { jellyTeam } from "@marmalade-v2/db/schema/team";
import { and, eq, or, sql } from "drizzle-orm";

export type QuotaWindow = "five_minute" | "day";
/**
 * `instance` is the whole deployment, not a tenant.
 *
 * Jelly's 5,000-per-5-minutes limit is per source IP, so every team on one
 * deployment shares it. Ten teams each sitting comfortably under their own
 * ceiling can still trip it together, and the 429 arrives with no per-team
 * gauge having predicted it.
 */
export type QuotaScope = "instance" | "team" | "mailbox" | "api_key" | "user";

/** The one scope id the instance scope ever uses. */
export const INSTANCE_SCOPE_ID = "marmalade";

/**
 * Jelly publishes 100,000 requests per day per team (midnight UTC reset) and
 * 5,000 per 5 minutes. Marmalade stops short of both so that manual use, the
 * Jelly web UI, and any other integration on the same team still have room.
 */
export const JELLY_DAILY_LIMIT = 100_000;
export const JELLY_FIVE_MINUTE_LIMIT = 5_000;

/**
 * Fallback only. The real ceiling lives on `jelly_team.daily_ceiling`, so a
 * team can be given more or less than the default without a deploy, and so
 * that connecting a second team brings its own budget rather than sharing
 * this one.
 */
/**
 * Instance-wide short-window ceiling, below Jelly's per-IP 5,000 so there is
 * room for the Jelly web UI and anything else egressing from the same
 * address.
 */
export const INSTANCE_FIVE_MINUTE_CEILING = 4_500;

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
  const [team] = await db
    .select({ dailyCeiling: jellyTeam.dailyCeiling })
    .from(jellyTeam)
    .where(eq(jellyTeam.id, teamId))
    .limit(1);

  // Checked first: it is the limit a team cannot see coming, because the
  // traffic that exhausts it may belong to someone else entirely.
  const shared = await readQuota(
    "instance",
    INSTANCE_SCOPE_ID,
    "five_minute",
    now,
  );
  if (shared >= INSTANCE_FIVE_MINUTE_CEILING) {
    return {
      allowed: false,
      reason:
        "This deployment reached its shared short-term Jelly ceiling " +
        `(${shared}/${INSTANCE_FIVE_MINUTE_CEILING}). Jelly rate-limits per ` +
        "source IP, so every connected team shares it.",
      retryAt: windowEndFor("five_minute", now),
    };
  }

  const teamCeiling = team?.dailyCeiling ?? TEAM_DAILY_CEILING;
  const dailyCeiling = options.worker
    ? Math.floor(teamCeiling * WORKER_DAILY_SHARE)
    : teamCeiling;

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

/**
 * Per-scope ceilings, read from `quota_policy`.
 *
 * A scope with no policy row is unlimited beyond the team ceiling: the team
 * limit is the one that protects Jelly, and these exist to stop one consumer
 * inside Marmalade from spending everyone else's share of it.
 */
export async function loadPolicies(
  targets: QuotaTarget[],
): Promise<Map<string, number>> {
  if (targets.length === 0) return new Map();

  const rows = await db
    .select()
    .from(quotaPolicy)
    .where(
      or(
        ...targets.map((t) =>
          and(
            eq(quotaPolicy.scope, t.scope),
            eq(quotaPolicy.scopeId, t.scopeId),
          ),
        ),
      ),
    );

  return new Map(
    rows.map((row) => [
      `${row.scope}:${row.scopeId}:${row.window}`,
      row.ceiling,
    ]),
  );
}

/**
 * Full precheck for one outbound call: the team ceilings first, then any
 * per-key or per-mailbox ceiling that applies.
 */
export async function checkQuotas(
  teamId: string,
  targets: QuotaTarget[],
  options: QuotaCheckOptions = {},
  now = new Date(),
): Promise<QuotaVerdict> {
  const team = await checkTeamQuota(teamId, options, now);
  if (!team.allowed) return team;

  if (targets.length === 0) return { allowed: true };

  const policies = await loadPolicies(targets);
  if (policies.size === 0) return { allowed: true };

  for (const target of targets) {
    for (const window of ["five_minute", "day"] as QuotaWindow[]) {
      const ceiling = policies.get(
        `${target.scope}:${target.scopeId}:${window}`,
      );
      if (ceiling === undefined) continue;

      const used = await readQuota(target.scope, target.scopeId, window, now);
      if (used >= ceiling) {
        return {
          allowed: false,
          reason: `${target.scope} ${target.scopeId} reached its ${window.replace("_", "-")} ceiling (${used}/${ceiling})`,
          retryAt: windowEndFor(window, now),
        };
      }
    }
  }

  return { allowed: true };
}

export async function setQuotaPolicy(input: {
  scope: QuotaScope;
  scopeId: string;
  window: QuotaWindow;
  ceiling: number;
  note?: string | null;
}): Promise<void> {
  await db
    .insert(quotaPolicy)
    .values({
      scope: input.scope,
      scopeId: input.scopeId,
      window: input.window,
      ceiling: input.ceiling,
      note: input.note ?? null,
    })
    .onConflictDoUpdate({
      target: [quotaPolicy.scope, quotaPolicy.scopeId, quotaPolicy.window],
      set: { ceiling: input.ceiling, note: input.note ?? null },
    });
}

export async function clearQuotaPolicy(input: {
  scope: QuotaScope;
  scopeId: string;
  window: QuotaWindow;
}): Promise<void> {
  await db
    .delete(quotaPolicy)
    .where(
      and(
        eq(quotaPolicy.scope, input.scope),
        eq(quotaPolicy.scopeId, input.scopeId),
        eq(quotaPolicy.window, input.window),
      ),
    );
}

export async function listQuotaPolicies() {
  return db
    .select()
    .from(quotaPolicy)
    .orderBy(quotaPolicy.scope, quotaPolicy.scopeId);
}

/** Current usage against every ceiling that applies, for the admin gauges. */
export async function quotaSnapshot(teamId: string, now = new Date()) {
  const [dayUsed, burstUsed, sharedUsed, team] = await Promise.all([
    readQuota("team", teamId, "day", now),
    readQuota("team", teamId, "five_minute", now),
    readQuota("instance", INSTANCE_SCOPE_ID, "five_minute", now),
    db
      .select({ dailyCeiling: jellyTeam.dailyCeiling })
      .from(jellyTeam)
      .where(eq(jellyTeam.id, teamId))
      .limit(1),
  ]);

  const dailyCeiling = team[0]?.dailyCeiling ?? TEAM_DAILY_CEILING;

  const [circuit] = await db
    .select()
    .from(jellyCircuitState)
    .where(
      and(
        eq(jellyCircuitState.scope, "team"),
        eq(jellyCircuitState.scopeId, teamId),
      ),
    )
    .limit(1);

  return {
    day: {
      used: dayUsed,
      ceiling: dailyCeiling,
      workerCeiling: Math.floor(dailyCeiling * WORKER_DAILY_SHARE),
      jellyLimit: JELLY_DAILY_LIMIT,
      resetsAt: windowEndFor("day", now),
    },
    fiveMinute: {
      used: burstUsed,
      ceiling: TEAM_FIVE_MINUTE_CEILING,
      jellyLimit: JELLY_FIVE_MINUTE_LIMIT,
      resetsAt: windowEndFor("five_minute", now),
    },
    // Reported alongside the team's own numbers because it is the ceiling a
    // team cannot explain from its own traffic: another team may be
    // spending it.
    sharedFiveMinute: {
      used: sharedUsed,
      ceiling: INSTANCE_FIVE_MINUTE_CEILING,
      jellyLimit: JELLY_FIVE_MINUTE_LIMIT,
      resetsAt: windowEndFor("five_minute", now),
    },
    circuit: {
      consecutiveFailures: circuit?.consecutiveFailures ?? 0,
      pausedUntil: circuit?.pausedUntil ?? null,
      pausedReason: circuit?.pausedReason ?? null,
      lastSuccessAt: circuit?.lastSuccessAt ?? null,
      lastFailureAt: circuit?.lastFailureAt ?? null,
    },
  };
}
