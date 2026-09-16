import { db } from "@marmalade-v2/db";
import { jellyAction } from "@marmalade-v2/db/schema/action";
import { apiKey } from "@marmalade-v2/db/schema/api";
import { auditLog } from "@marmalade-v2/db/schema/audit";
import { user as authUser } from "@marmalade-v2/db/schema/auth";
import {
  jellyRequestLog,
  usageRollup,
} from "@marmalade-v2/db/schema/observability";
import { env } from "@marmalade-v2/env/server";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import z from "zod";
import { teamAdminProtectedProcedure } from "../index";
import {
  approveAction,
  cancelAction,
  dispatchInline,
  drainActions,
  retryAction,
} from "../lib/actions/outbox";
import { queueHealth, webhookHealth, workerHealth } from "../lib/observability";
import {
  clearQuotaPolicy,
  listQuotaPolicies,
  quotaSnapshot,
  setQuotaPolicy,
} from "../lib/quota";
import { actionSchema } from "../schemas/output";

const WINDOWS = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
} as const;

type WindowKey = keyof typeof WINDOWS;

export const adminRouter = {
  /**
   * Is the service working right now?
   *
   * Everything here answers a question an operator actually asks during an
   * incident, and nothing on it scans a raw log table.
   */
  health: teamAdminProtectedProcedure
    .route({ method: "GET", path: "/admin/health" })
    .output(
      z.object({
        worker: z.object({
          lastRunAt: z.date().nullable(),
          lastClaimedCount: z.number(),
          lastDurationMs: z.number(),
          lastError: z.string().nullable(),
          stalled: z.boolean(),
        }),
        queue: z.object({
          counts: z.record(z.string(), z.number()),
          oldestPendingAt: z.date().nullable(),
          oldestPendingAgeMs: z.number().nullable(),
          deadLetters: z.number(),
          inFlight: z.number(),
          awaitingApproval: z.number(),
        }),
        quota: z.object({
          day: z.object({
            used: z.number(),
            ceiling: z.number(),
            workerCeiling: z.number(),
            jellyLimit: z.number(),
            resetsAt: z.date(),
          }),
          fiveMinute: z.object({
            used: z.number(),
            ceiling: z.number(),
            jellyLimit: z.number(),
            resetsAt: z.date(),
          }),
          circuit: z.object({
            consecutiveFailures: z.number(),
            pausedUntil: z.date().nullable(),
            pausedReason: z.string().nullable(),
            lastSuccessAt: z.date().nullable(),
            lastFailureAt: z.date().nullable(),
          }),
        }),
        webhooks: z.object({
          consecutiveFailures: z.number(),
          atRisk: z.boolean(),
          limit: z.number(),
          events: z.array(
            z.object({
              event: z.string(),
              lastReceivedAt: z.date().nullable(),
              received24h: z.number(),
              failures24h: z.number(),
            }),
          ),
        }),
        alerts: z.array(
          z.object({
            severity: z.enum(["warning", "critical"]),
            message: z.string(),
          }),
        ),
      }),
    )
    .handler(async () => {
      const [worker, queue, quota, webhooks] = await Promise.all([
        workerHealth(),
        queueHealth(env.JELLY_TEAM_ID),
        quotaSnapshot(env.JELLY_TEAM_ID),
        webhookHealth(),
      ]);

      const alerts: Array<{
        severity: "warning" | "critical";
        message: string;
      }> = [];

      if (worker.stalled) {
        alerts.push({
          severity: "critical",
          message: worker.lastRunAt
            ? `Action worker has not run since ${worker.lastRunAt.toISOString()}`
            : "Action worker has never run — check the drain cron and CRON_SECRET",
        });
      }
      if (
        queue.oldestPendingAgeMs &&
        queue.oldestPendingAgeMs > 15 * 60 * 1000
      ) {
        alerts.push({
          severity: "warning",
          message: `Oldest queued action is ${Math.round(queue.oldestPendingAgeMs / 60000)} minutes old`,
        });
      }
      if (queue.deadLetters > 0) {
        alerts.push({
          severity: "warning",
          message: `${queue.deadLetters} action(s) in the dead-letter state`,
        });
      }
      if (quota.day.used >= quota.day.ceiling * 0.8) {
        alerts.push({
          severity: "warning",
          message: `Daily Jelly quota ${quota.day.used}/${quota.day.ceiling} used`,
        });
      }
      if (quota.circuit.pausedUntil && quota.circuit.pausedUntil > new Date()) {
        alerts.push({
          severity: "warning",
          message: `Jelly requests paused until ${quota.circuit.pausedUntil.toISOString()}: ${quota.circuit.pausedReason ?? "unknown"}`,
        });
      }
      if (webhooks.atRisk) {
        alerts.push({
          severity: "critical",
          message: `${webhooks.consecutiveFailures} consecutive webhook failures — Jelly deactivates the webhook at ${webhooks.limit}`,
        });
      }

      return { worker, queue, quota, webhooks, alerts };
    }),

  /**
   * Who is spending what. Served from `usage_rollup`, which is why the 30-day
   * window costs about as much as the 1-hour one.
   */
  usage: teamAdminProtectedProcedure
    .route({ method: "GET", path: "/admin/usage" })
    .input(
      z.object({
        window: z.enum(["1h", "24h", "7d", "30d"]).default("24h"),
        scope: z.enum(["team", "api_key", "user"]).default("api_key"),
      }),
    )
    .output(
      z.object({
        window: z.string(),
        scope: z.string(),
        consumers: z.array(
          z.object({
            scopeId: z.string(),
            label: z.string(),
            requests: z.number(),
            errors: z.number(),
            throttled: z.number(),
            p50Ms: z.number().nullable(),
            p95Ms: z.number().nullable(),
          }),
        ),
        endpoints: z.array(
          z.object({
            dimension: z.string(),
            requests: z.number(),
            errors: z.number(),
            p95Ms: z.number().nullable(),
          }),
        ),
        actions: z.array(
          z.object({
            actionType: z.string(),
            status: z.string(),
            count: z.number(),
          }),
        ),
      }),
    )
    .handler(async ({ input }) => {
      const since = new Date(Date.now() - WINDOWS[input.window as WindowKey]);

      const rows = await db
        .select({
          scopeId: usageRollup.scopeId,
          dimension: usageRollup.dimension,
          status: usageRollup.status,
          count: sql<number>`sum(${usageRollup.count})::int`,
          errors: sql<number>`sum(${usageRollup.errorCount})::int`,
          p50: sql<number>`max(${usageRollup.p50Ms})::int`,
          p95: sql<number>`max(${usageRollup.p95Ms})::int`,
        })
        .from(usageRollup)
        .where(
          and(
            eq(usageRollup.scope, input.scope),
            gte(usageRollup.bucketHour, since),
          ),
        )
        .groupBy(
          usageRollup.scopeId,
          usageRollup.dimension,
          usageRollup.status,
        );

      const consumers = new Map<
        string,
        {
          scopeId: string;
          requests: number;
          errors: number;
          throttled: number;
          p50Ms: number | null;
          p95Ms: number | null;
        }
      >();
      const endpoints = new Map<
        string,
        {
          dimension: string;
          requests: number;
          errors: number;
          p95Ms: number | null;
        }
      >();

      for (const row of rows) {
        const consumer = consumers.get(row.scopeId) ?? {
          scopeId: row.scopeId,
          requests: 0,
          errors: 0,
          throttled: 0,
          p50Ms: null,
          p95Ms: null,
        };
        consumer.requests += row.count;
        consumer.errors += row.errors;
        if (row.status === "throttled") consumer.throttled += row.count;
        consumer.p50Ms = Math.max(consumer.p50Ms ?? 0, row.p50 ?? 0);
        consumer.p95Ms = Math.max(consumer.p95Ms ?? 0, row.p95 ?? 0);
        consumers.set(row.scopeId, consumer);

        const endpoint = endpoints.get(row.dimension) ?? {
          dimension: row.dimension,
          requests: 0,
          errors: 0,
          p95Ms: null,
        };
        endpoint.requests += row.count;
        endpoint.errors += row.errors;
        endpoint.p95Ms = Math.max(endpoint.p95Ms ?? 0, row.p95 ?? 0);
        endpoints.set(row.dimension, endpoint);
      }

      // Resolve api key ids and user ids to names so the table is readable.
      const labels = new Map<string, string>();
      const scopeIds = Array.from(consumers.keys());
      if (input.scope === "api_key" && scopeIds.length > 0) {
        const numeric = scopeIds
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id));
        if (numeric.length > 0) {
          const keys = await db
            .select({ id: apiKey.id, name: apiKey.name })
            .from(apiKey)
            .where(inArray(apiKey.id, numeric));
          for (const key of keys) labels.set(String(key.id), key.name);
        }
      } else if (input.scope === "user" && scopeIds.length > 0) {
        const users = await db
          .select({ id: authUser.id, name: authUser.name })
          .from(authUser)
          .where(inArray(authUser.id, scopeIds));
        for (const row of users) labels.set(row.id, row.name);
      }

      const actions = await db
        .select({
          actionType: jellyAction.actionType,
          status: jellyAction.status,
          count: sql<number>`count(*)::int`,
        })
        .from(jellyAction)
        .where(
          and(
            eq(jellyAction.jellyTeamId, env.JELLY_TEAM_ID),
            gte(jellyAction.createdAt, since),
          ),
        )
        .groupBy(jellyAction.actionType, jellyAction.status);

      return {
        window: input.window,
        scope: input.scope,
        consumers: Array.from(consumers.values())
          .map((consumer) => ({
            ...consumer,
            label: labels.get(consumer.scopeId) ?? consumer.scopeId,
          }))
          .sort((a, b) => b.requests - a.requests),
        endpoints: Array.from(endpoints.values()).sort(
          (a, b) => b.requests - a.requests,
        ),
        actions: actions.sort((a, b) => b.count - a.count),
      };
    }),

  /** Queue browser. Filter, inspect a payload, see every attempt. */
  actions: teamAdminProtectedProcedure
    .route({ method: "GET", path: "/admin/actions" })
    .input(
      z.object({
        status: z.string().optional(),
        actionType: z.string().optional(),
        mailboxId: z.string().optional(),
        apiKeyId: z.coerce.number().optional(),
        before: z.string().datetime().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
    )
    .output(
      z.array(
        actionSchema.extend({
          payload: z.unknown(),
          jellyResponse: z.unknown().nullable(),
          actorType: z.string(),
          actorKey: z.string(),
          apiKeyName: z.string().nullable(),
          userName: z.string().nullable(),
          updatedAt: z.date(),
        }),
      ),
    )
    .handler(async ({ input }) => {
      const conditions = [eq(jellyAction.jellyTeamId, env.JELLY_TEAM_ID)];
      if (input.status) conditions.push(eq(jellyAction.status, input.status));
      if (input.actionType) {
        conditions.push(eq(jellyAction.actionType, input.actionType));
      }
      if (input.mailboxId) {
        conditions.push(eq(jellyAction.jellyMailboxId, input.mailboxId));
      }
      if (input.apiKeyId != null) {
        conditions.push(eq(jellyAction.apiKeyId, input.apiKeyId));
      }
      if (input.before) {
        conditions.push(lt(jellyAction.createdAt, new Date(input.before)));
      }

      const rows = await db
        .select({
          action: jellyAction,
          apiKeyName: apiKey.name,
          userName: authUser.name,
        })
        .from(jellyAction)
        .leftJoin(apiKey, eq(jellyAction.apiKeyId, apiKey.id))
        .leftJoin(authUser, eq(jellyAction.userId, authUser.id))
        .where(and(...conditions))
        .orderBy(desc(jellyAction.createdAt))
        .limit(input.limit);

      return rows.map(({ action, apiKeyName, userName }) => ({
        id: action.id,
        status: action.status,
        actionType: action.actionType,
        targetResourceType: action.targetResourceType,
        targetResourceId: action.targetResourceId,
        jellyMailboxId: action.jellyMailboxId,
        jellyResourceId: action.jellyResourceId,
        attempts: action.attempts,
        maxAttempts: action.maxAttempts,
        scheduledFor: action.scheduledFor,
        nextAttemptAt: action.nextAttemptAt,
        lastError: action.lastError ?? null,
        createdAt: action.createdAt,
        completedAt: action.completedAt,
        payload: action.payload,
        jellyResponse: action.jellyResponse ?? null,
        actorType: action.actorType,
        actorKey: action.actorKey,
        apiKeyName: apiKeyName ?? null,
        userName: userName ?? null,
        updatedAt: action.updatedAt,
      }));
    }),

  /**
   * Operator controls on the queue. Each one is audit-logged against the
   * admin who performed it: an admin retrying a stranger's action is exactly
   * the event an audit trail exists for.
   */
  actionControl: teamAdminProtectedProcedure
    .route({ method: "POST", path: "/admin/actions/{actionId}/{operation}" })
    .input(
      z.object({
        actionId: z.string().min(1),
        operation: z.enum(["retry", "cancel", "approve", "force_fail"]),
        reason: z.string().max(500).optional(),
      }),
    )
    .output(z.object({ message: z.string(), status: z.string() }))
    .handler(async ({ input, context }) => {
      const [existing] = await db
        .select()
        .from(jellyAction)
        .where(eq(jellyAction.id, input.actionId))
        .limit(1);

      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Action not found" });
      }

      let status = existing.status;
      let message: string;

      switch (input.operation) {
        case "retry": {
          const requeued = await retryAction(input.actionId);
          if (!requeued) {
            throw new ORPCError("CONFLICT", {
              message: `Action is ${existing.status} and cannot be retried`,
            });
          }
          status = (await dispatchInline(requeued)).status;
          message = "Action requeued";
          break;
        }
        case "cancel": {
          const cancelled = await cancelAction(
            input.actionId,
            input.reason ?? "Cancelled by admin",
          );
          if (!cancelled) {
            throw new ORPCError("CONFLICT", {
              message: `Action is ${existing.status} and can no longer be cancelled`,
            });
          }
          status = cancelled.status;
          message = "Action cancelled";
          break;
        }
        case "approve": {
          const approved = await approveAction(input.actionId);
          if (!approved) {
            throw new ORPCError("CONFLICT", {
              message: `Action is ${existing.status}, not awaiting approval`,
            });
          }
          status = (await dispatchInline(approved)).status;
          message = "Action approved";
          break;
        }
        case "force_fail": {
          const [failed] = await db
            .update(jellyAction)
            .set({
              status: "failed",
              completedAt: new Date(),
              lockedAt: null,
              lockedBy: null,
              lastError: {
                kind: "force_failed",
                message: input.reason ?? "Force-failed by admin",
              } as never,
            })
            .where(eq(jellyAction.id, input.actionId))
            .returning();
          status = failed?.status ?? "failed";
          message = "Action force-failed";
          break;
        }
      }

      await db.insert(auditLog).values({
        userId: context.session.user.id,
        jellyTeamId: env.JELLY_TEAM_ID,
        action: `admin_${input.operation}`,
        resource: "jelly_action",
        resourceId: input.actionId,
        status: "success",
        ipAddress: context.session.session.ipAddress ?? null,
        userAgent: context.session.session.userAgent ?? null,
        metadata: {
          previousStatus: existing.status,
          reason: input.reason ?? null,
          actionType: existing.actionType,
        },
      });

      return { message, status };
    }),

  /** Requeue every dead letter at once, after a cause has been fixed. */
  requeueDeadLetters: teamAdminProtectedProcedure
    .route({ method: "POST", path: "/admin/actions/requeue-dead" })
    .input(z.object({ actionType: z.string().optional() }))
    .output(z.object({ requeued: z.number() }))
    .handler(async ({ input, context }) => {
      const conditions = [
        eq(jellyAction.jellyTeamId, env.JELLY_TEAM_ID),
        eq(jellyAction.status, "dead"),
      ];
      if (input.actionType) {
        conditions.push(eq(jellyAction.actionType, input.actionType));
      }

      const requeued = await db
        .update(jellyAction)
        .set({
          status: "pending",
          attempts: 0,
          nextAttemptAt: new Date(),
          completedAt: null,
          lockedAt: null,
          lockedBy: null,
        })
        .where(and(...conditions))
        .returning({ id: jellyAction.id });

      await db.insert(auditLog).values({
        userId: context.session.user.id,
        jellyTeamId: env.JELLY_TEAM_ID,
        action: "admin_requeue_dead",
        resource: "jelly_action",
        resourceId: "-1",
        status: "success",
        metadata: {
          count: requeued.length,
          actionType: input.actionType ?? null,
        },
      });

      return { requeued: requeued.length };
    }),

  /**
   * Paginated audit log. The README asks for attempts to be logged
   * "regardless of status", so rejected rows are first-class here.
   */
  auditLog: teamAdminProtectedProcedure
    .route({ method: "GET", path: "/admin/audit" })
    .input(
      z.object({
        resource: z.string().optional(),
        action: z.string().optional(),
        status: z.string().optional(),
        userId: z.string().optional(),
        apiKeyId: z.coerce.number().optional(),
        before: z.string().datetime().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
    )
    .output(
      z.array(
        z.object({
          id: z.number(),
          timestamp: z.date(),
          action: z.string(),
          resource: z.string(),
          resourceId: z.string(),
          status: z.string(),
          userId: z.string().nullable(),
          userName: z.string().nullable(),
          apiKeyId: z.number().nullable(),
          apiKeyName: z.string().nullable(),
          ipAddress: z.string().nullable(),
          userAgent: z.string().nullable(),
          changes: z.unknown().nullable(),
          metadata: z.unknown().nullable(),
        }),
      ),
    )
    .handler(async ({ input }) => {
      const conditions = [eq(auditLog.jellyTeamId, env.JELLY_TEAM_ID)];
      if (input.resource)
        conditions.push(eq(auditLog.resource, input.resource));
      if (input.action) conditions.push(eq(auditLog.action, input.action));
      if (input.status) conditions.push(eq(auditLog.status, input.status));
      if (input.userId) conditions.push(eq(auditLog.userId, input.userId));
      if (input.apiKeyId != null) {
        conditions.push(eq(auditLog.apiKeyId, input.apiKeyId));
      }
      if (input.before) {
        conditions.push(lt(auditLog.timestamp, new Date(input.before)));
      }

      const rows = await db
        .select({
          log: auditLog,
          userName: authUser.name,
          apiKeyName: apiKey.name,
        })
        .from(auditLog)
        .leftJoin(authUser, eq(auditLog.userId, authUser.id))
        .leftJoin(apiKey, eq(auditLog.apiKeyId, apiKey.id))
        .where(and(...conditions))
        .orderBy(desc(auditLog.timestamp))
        .limit(input.limit);

      return rows.map(({ log, userName, apiKeyName }) => ({
        id: log.id,
        timestamp: log.timestamp,
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId,
        status: log.status,
        userId: log.userId,
        userName: userName ?? null,
        apiKeyId: log.apiKeyId,
        apiKeyName: apiKeyName ?? null,
        ipAddress: log.ipAddress ?? null,
        userAgent: log.userAgent ?? null,
        changes: log.changes ?? null,
        metadata: log.metadata ?? null,
      }));
    }),

  /** Recent raw Jelly calls, for debugging a specific failure. */
  requestLog: teamAdminProtectedProcedure
    .route({ method: "GET", path: "/admin/requests" })
    .input(
      z.object({
        statusCode: z.coerce.number().optional(),
        path: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
    )
    .output(
      z.array(
        z.object({
          id: z.number(),
          actionId: z.string().nullable(),
          method: z.string(),
          path: z.string(),
          statusCode: z.number().nullable(),
          durationMs: z.number(),
          retryAfterSeconds: z.number().nullable(),
          error: z.string().nullable(),
          actorType: z.string(),
          apiKeyId: z.number().nullable(),
          createdAt: z.date(),
        }),
      ),
    )
    .handler(async ({ input }) => {
      const conditions = [];
      if (input.statusCode != null) {
        conditions.push(eq(jellyRequestLog.statusCode, input.statusCode));
      }
      if (input.path) conditions.push(eq(jellyRequestLog.path, input.path));

      return db
        .select()
        .from(jellyRequestLog)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(jellyRequestLog.createdAt))
        .limit(input.limit);
    }),

  listQuotaPolicies: teamAdminProtectedProcedure
    .route({ method: "GET", path: "/admin/quotas" })
    .output(
      z.array(
        z.object({
          id: z.number(),
          scope: z.string(),
          scopeId: z.string(),
          window: z.string(),
          ceiling: z.number(),
          note: z.string().nullable(),
          updatedAt: z.date(),
        }),
      ),
    )
    .handler(() => listQuotaPolicies()),

  setQuotaPolicy: teamAdminProtectedProcedure
    .route({ method: "POST", path: "/admin/quotas" })
    .input(
      z.object({
        scope: z.enum(["team", "mailbox", "api_key", "user"]),
        scopeId: z.string().min(1),
        window: z.enum(["five_minute", "day"]),
        ceiling: z.coerce.number().int().min(0),
        note: z.string().max(500).optional(),
      }),
    )
    .output(z.object({ message: z.string() }))
    .handler(async ({ input, context }) => {
      await setQuotaPolicy(input);
      await db.insert(auditLog).values({
        userId: context.session.user.id,
        jellyTeamId: env.JELLY_TEAM_ID,
        action: "set_quota_policy",
        resource: "quota_policy",
        resourceId: `${input.scope}:${input.scopeId}:${input.window}`,
        status: "success",
        changes: { ceiling: input.ceiling },
      });
      return { message: "Quota policy saved" };
    }),

  clearQuotaPolicy: teamAdminProtectedProcedure
    .route({ method: "DELETE", path: "/admin/quotas" })
    .input(
      z.object({
        scope: z.enum(["team", "mailbox", "api_key", "user"]),
        scopeId: z.string().min(1),
        window: z.enum(["five_minute", "day"]),
      }),
    )
    .output(z.object({ message: z.string() }))
    .handler(async ({ input, context }) => {
      await clearQuotaPolicy(input);
      await db.insert(auditLog).values({
        userId: context.session.user.id,
        jellyTeamId: env.JELLY_TEAM_ID,
        action: "clear_quota_policy",
        resource: "quota_policy",
        resourceId: `${input.scope}:${input.scopeId}:${input.window}`,
        status: "success",
      });
      return { message: "Quota policy cleared" };
    }),

  /** Put a key's writes behind admin approval, or take it out of that mode. */
  setKeyApproval: teamAdminProtectedProcedure
    .route({ method: "POST", path: "/admin/keys/{keyId}/approval" })
    .input(
      z.object({
        keyId: z.coerce.number().int().min(1),
        requireApproval: z.boolean(),
      }),
    )
    .output(z.object({ message: z.string() }))
    .handler(async ({ input, context }) => {
      const result = await db
        .update(apiKey)
        .set({ requireApproval: input.requireApproval })
        .where(
          and(
            eq(apiKey.id, input.keyId),
            eq(apiKey.jellyTeamId, env.JELLY_TEAM_ID),
          ),
        );

      if (result.rowCount === 0) {
        throw new ORPCError("NOT_FOUND", { message: "API key not found" });
      }

      await db.insert(auditLog).values({
        userId: context.session.user.id,
        apiKeyId: input.keyId,
        jellyTeamId: env.JELLY_TEAM_ID,
        action: input.requireApproval
          ? "require_key_approval"
          : "clear_key_approval",
        resource: "api_key",
        resourceId: String(input.keyId),
        status: "success",
      });

      return {
        message: input.requireApproval
          ? "Key writes now require admin approval"
          : "Key writes dispatch without approval",
      };
    }),

  /** Manual drain, for when the cron is down or an operator is impatient. */
  drainNow: teamAdminProtectedProcedure
    .route({ method: "POST", path: "/admin/actions/drain" })
    .input(
      z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }),
    )
    .output(
      z.object({
        claimed: z.number(),
        succeeded: z.number(),
        retried: z.number(),
        failed: z.number(),
      }),
    )
    .handler(({ input }) => drainActions({ limit: input.limit })),
};
