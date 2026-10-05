import { db } from "@marmalade-v2/db";
import { jellyAction } from "@marmalade-v2/db/schema/action";
import { auditLog } from "@marmalade-v2/db/schema/audit";
import { env } from "@marmalade-v2/env/server";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import z from "zod";
import {
  checkActionScope,
  mailboxScopedProcedure,
  requireMailboxAccess,
  requireMailboxWritesEnabled,
  resolveActor,
  teamMemberProtectedProcedure,
} from "../index";
import { ACTION_TYPES, getActionDefinition } from "../lib/actions/catalogue";
import {
  cancelAction,
  dispatchInline,
  enqueueAction,
  retryAction,
  type ActionRow,
} from "../lib/actions/outbox";
import { actionSchema } from "../schemas/output";

function serialiseAction(action: ActionRow, deduplicated = false) {
  return {
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
    deduplicated,
  };
}

/**
 * Record a refused write. The README asks for request attempts to be audited
 * "regardless of status", and a write denied for a missing scope is more
 * interesting than one that succeeded.
 */
async function auditRejection(input: {
  actor: ReturnType<typeof resolveActor>;
  actionType: string;
  targetResourceId: string | null;
  reason: string;
}) {
  await db.insert(auditLog).values({
    userId: input.actor.userId,
    apiKeyId: input.actor.apiKeyId,
    jellyTeamId: env.JELLY_TEAM_ID,
    action: input.actionType,
    resource: "jelly_action",
    resourceId: input.targetResourceId ?? "-1",
    status: "rejected",
    ipAddress: input.actor.ipAddress,
    userAgent: input.actor.userAgent,
    metadata: { reason: input.reason },
  });
}

type SubmitOptions = {
  context: unknown;
  actionType: string;
  targetResourceId: string | null;
  jellyMailboxId: string | null;
  rawPayload: unknown;
  idempotencyKey?: string | null;
  scheduledFor?: string | null;
  async?: boolean;
  dryRun?: boolean;
};

/**
 * The single path every write takes: authorise, validate, persist, then try to
 * dispatch. Nothing reaches Jelly except through here.
 */
async function submitAction(options: SubmitOptions) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const context = options.context as any;
  const actor = resolveActor(context);

  const definition = getActionDefinition(options.actionType);
  if (!definition) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Unknown action type: ${options.actionType}`,
    });
  }

  try {
    checkActionScope(context, options.actionType);
  } catch (error) {
    await auditRejection({
      actor,
      actionType: options.actionType,
      targetResourceId: options.targetResourceId,
      reason: error instanceof ORPCError ? error.message : "scope denied",
    });
    throw error;
  }

  if (definition.scope === "mailbox") {
    if (!options.jellyMailboxId) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Action ${options.actionType} requires a mailbox`,
      });
    }
    try {
      requireMailboxAccess(context, options.jellyMailboxId);
      await requireMailboxWritesEnabled(options.jellyMailboxId);
    } catch (error) {
      await auditRejection({
        actor,
        actionType: options.actionType,
        targetResourceId: options.targetResourceId,
        reason: error instanceof ORPCError ? error.message : "mailbox denied",
      });
      throw error;
    }
  }

  if (!definition.createsResource && !options.targetResourceId) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Action ${options.actionType} requires a target resource id`,
    });
  }

  const parsed = definition.payloadSchema.safeParse(options.rawPayload ?? {});
  if (!parsed.success) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Invalid payload for ${options.actionType}`,
      data: z.treeifyError(parsed.error),
    });
  }
  const payload = parsed.data as Record<string, unknown>;

  // Validate and authorise, then show the caller exactly what would be sent.
  // Makes the permission model testable by the people it constrains.
  if (options.dryRun) {
    return {
      dryRun: true as const,
      actionType: options.actionType,
      targetResourceId: options.targetResourceId,
      jellyMailboxId: options.jellyMailboxId,
      payload,
      idempotent: definition.idempotent,
    };
  }

  const headerKey =
    (context.idempotencyKey as string | null | undefined) ?? null;

  const scheduledFor = options.scheduledFor
    ? new Date(options.scheduledFor)
    : null;

  const { action, deduplicated } = await enqueueAction({
    actionType: options.actionType,
    targetResourceId: options.targetResourceId,
    jellyMailboxId: options.jellyMailboxId,
    payload,
    actorType: actor.actorType,
    apiKeyId: actor.apiKeyId,
    userId: actor.userId,
    idempotencyKey: options.idempotencyKey ?? headerKey,
    scheduledFor,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  // A replay of an already-accepted action returns the original outcome
  // rather than performing it a second time.
  if (deduplicated) return serialiseAction(action, true);

  // Future-dated work is the worker's job by definition.
  if (scheduledFor && scheduledFor > new Date()) {
    return serialiseAction(action);
  }

  if (options.async) return serialiseAction(action);

  const dispatched = await dispatchInline(action);
  return serialiseAction(dispatched);
}

const submitInputBase = {
  idempotencyKey: z.string().min(1).max(255).optional(),
  scheduledFor: z.string().datetime().optional(),
  async: z.boolean().optional(),
  dryRun: z.boolean().optional(),
};

const submitOutput = z.union([
  actionSchema,
  z.object({
    dryRun: z.literal(true),
    actionType: z.string(),
    targetResourceId: z.string().nullable(),
    jellyMailboxId: z.string().nullable(),
    payload: z.record(z.string(), z.unknown()),
    idempotent: z.boolean(),
  }),
]);

/** Convenience wrapper for the common conversation-scoped actions. */
function conversationAction(config: {
  actionType: string;
  method: "POST" | "DELETE" | "PATCH";
  path: `/${string}`;
  payloadShape?: z.ZodRawShape;
}) {
  return mailboxScopedProcedure
    .route({ method: config.method, path: config.path })
    .input(
      z.object({
        mailboxId: z.string().min(1),
        conversationId: z.string().min(1),
        ...(config.payloadShape ?? {}),
        ...submitInputBase,
      }),
    )
    .output(submitOutput)
    .handler(async ({ input, context }) => {
      const {
        mailboxId,
        conversationId,
        idempotencyKey,
        scheduledFor,
        async: isAsync,
        dryRun,
        ...payload
      } = input as Record<string, unknown> & {
        mailboxId: string;
        conversationId: string;
      };

      return submitAction({
        context,
        actionType: config.actionType,
        targetResourceId: conversationId,
        jellyMailboxId: mailboxId,
        rawPayload: payload,
        idempotencyKey: idempotencyKey as string | undefined,
        scheduledFor: scheduledFor as string | undefined,
        async: isAsync as boolean | undefined,
        dryRun: dryRun as boolean | undefined,
      });
    });
}

export const actionRouter = {
  /**
   * Generic escape hatch. Every action type is reachable here, including the
   * ones without a named route below.
   */
  submit: mailboxScopedProcedure
    .route({ method: "POST", path: "/actions" })
    .input(
      z.object({
        actionType: z.enum(ACTION_TYPES as [string, ...string[]]),
        targetResourceId: z.string().min(1).nullable().optional(),
        mailboxId: z.string().min(1).nullable().optional(),
        payload: z.record(z.string(), z.unknown()).optional(),
        ...submitInputBase,
      }),
    )
    .output(submitOutput)
    .handler(async ({ input, context }) =>
      submitAction({
        context,
        actionType: input.actionType,
        targetResourceId: input.targetResourceId ?? null,
        jellyMailboxId: input.mailboxId ?? null,
        rawPayload: input.payload ?? {},
        idempotencyKey: input.idempotencyKey,
        scheduledFor: input.scheduledFor,
        async: input.async,
        dryRun: input.dryRun,
      }),
    ),

  archive: conversationAction({
    actionType: "conversation.archive",
    method: "POST",
    path: "/mailboxes/{mailboxId}/conversations/{conversationId}/archive",
  }),
  unarchive: conversationAction({
    actionType: "conversation.unarchive",
    method: "DELETE",
    path: "/mailboxes/{mailboxId}/conversations/{conversationId}/archive",
  }),
  trash: conversationAction({
    actionType: "conversation.trash",
    method: "POST",
    path: "/mailboxes/{mailboxId}/conversations/{conversationId}/trash",
  }),
  restore: conversationAction({
    actionType: "conversation.restore",
    method: "DELETE",
    path: "/mailboxes/{mailboxId}/conversations/{conversationId}/trash",
  }),
  spam: conversationAction({
    actionType: "conversation.spam",
    method: "POST",
    path: "/mailboxes/{mailboxId}/conversations/{conversationId}/spam",
  }),
  unspam: conversationAction({
    actionType: "conversation.unspam",
    method: "DELETE",
    path: "/mailboxes/{mailboxId}/conversations/{conversationId}/spam",
  }),
  snooze: conversationAction({
    actionType: "conversation.snooze",
    method: "POST",
    path: "/mailboxes/{mailboxId}/conversations/{conversationId}/snooze",
    payloadShape: {
      snoozeUntil: z.string().datetime(),
      memberId: z.string().min(1).optional(),
      email: z.email().optional(),
    },
  }),
  unsnooze: conversationAction({
    actionType: "conversation.unsnooze",
    method: "DELETE",
    path: "/mailboxes/{mailboxId}/conversations/{conversationId}/snooze",
  }),
  assign: conversationAction({
    actionType: "conversation.assign",
    method: "POST",
    path: "/mailboxes/{mailboxId}/conversations/{conversationId}/assignments",
    payloadShape: {
      memberId: z.string().min(1).optional(),
      email: z.email().optional(),
    },
  }),
  unassign: conversationAction({
    actionType: "conversation.unassign",
    method: "DELETE",
    path: "/mailboxes/{mailboxId}/conversations/{conversationId}/assignments",
    payloadShape: { memberId: z.string().min(1) },
  }),
  applyLabel: conversationAction({
    actionType: "conversation.label_apply",
    method: "POST",
    path: "/mailboxes/{mailboxId}/conversations/{conversationId}/labels",
    payloadShape: { labelId: z.string().min(1) },
  }),
  removeLabel: conversationAction({
    actionType: "conversation.label_remove",
    method: "DELETE",
    path: "/mailboxes/{mailboxId}/conversations/{conversationId}/labels",
    payloadShape: { labelId: z.string().min(1) },
  }),
  setMailboxes: conversationAction({
    actionType: "conversation.set_mailboxes",
    method: "PATCH",
    path: "/mailboxes/{mailboxId}/conversations/{conversationId}/mailboxes",
    payloadShape: { mailboxIds: z.array(z.string().min(1)).min(1) },
  }),
  createComment: conversationAction({
    actionType: "comment.create",
    method: "POST",
    path: "/mailboxes/{mailboxId}/conversations/{conversationId}/comments",
    payloadShape: { body: z.string().min(1) },
  }),
  /**
   * Creates a draft reply. Jelly does not send it — a team member has to open
   * the conversation in Jelly and send it themselves.
   */
  createDraftReply: conversationAction({
    actionType: "draft_reply.create",
    method: "POST",
    path: "/mailboxes/{mailboxId}/conversations/{conversationId}/draft_reply",
    payloadShape: {
      body: z.string().min(1),
      memberId: z.string().optional(),
      messageId: z.string().optional(),
      to: z.array(z.email()).optional(),
      cc: z.array(z.email()).optional(),
      bcc: z.array(z.email()).optional(),
    },
  }),

  get: mailboxScopedProcedure
    .route({ method: "GET", path: "/actions/{actionId}" })
    .input(z.object({ actionId: z.string().min(1) }))
    .output(actionSchema)
    .handler(async ({ input, context }) => {
      const actor = resolveActor(context);
      const [action] = await db
        .select()
        .from(jellyAction)
        .where(eq(jellyAction.id, input.actionId))
        .limit(1);

      if (!action) {
        throw new ORPCError("NOT_FOUND", { message: "Action not found" });
      }

      // A key may only see actions it submitted; a session user may see any
      // action in a mailbox they can reach.
      if (actor.actorType === "api_key") {
        if (action.apiKeyId !== actor.apiKeyId) {
          throw new ORPCError("NOT_FOUND", { message: "Action not found" });
        }
      } else if (action.jellyMailboxId) {
        requireMailboxAccess(context as never, action.jellyMailboxId);
      }

      return serialiseAction(action);
    }),

  list: mailboxScopedProcedure
    .route({ method: "GET", path: "/actions" })
    .input(
      z.object({
        status: z
          .enum([
            "pending",
            "scheduled",
            "in_flight",
            "succeeded",
            "failed",
            "dead",
            "cancelled",
          ])
          .optional(),
        mailboxId: z.string().min(1).optional(),
        actionType: z.string().min(1).optional(),
        before: z.string().datetime().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
    )
    .output(z.array(actionSchema))
    .handler(async ({ input, context }) => {
      const actor = resolveActor(context);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allowed = (context as any).allowedMailboxIds as string[];

      const conditions = [eq(jellyAction.jellyTeamId, env.JELLY_TEAM_ID)];

      if (actor.actorType === "api_key" && actor.apiKeyId != null) {
        conditions.push(eq(jellyAction.apiKeyId, actor.apiKeyId));
      } else if (!allowed?.includes("*")) {
        if (!allowed || allowed.length === 0) return [];
        conditions.push(inArray(jellyAction.jellyMailboxId, allowed));
      }

      if (input.status) conditions.push(eq(jellyAction.status, input.status));
      if (input.mailboxId) {
        requireMailboxAccess(context as never, input.mailboxId);
        conditions.push(eq(jellyAction.jellyMailboxId, input.mailboxId));
      }
      if (input.actionType) {
        conditions.push(eq(jellyAction.actionType, input.actionType));
      }
      if (input.before) {
        conditions.push(lt(jellyAction.createdAt, new Date(input.before)));
      }

      const rows = await db
        .select()
        .from(jellyAction)
        .where(and(...conditions))
        .orderBy(desc(jellyAction.createdAt))
        .limit(input.limit);

      return rows.map((row) => serialiseAction(row));
    }),

  cancel: mailboxScopedProcedure
    .route({ method: "POST", path: "/actions/{actionId}/cancel" })
    .input(
      z.object({
        actionId: z.string().min(1),
        reason: z.string().max(500).optional(),
      }),
    )
    .output(actionSchema)
    .handler(async ({ input, context }) => {
      const actor = resolveActor(context);
      const [existing] = await db
        .select()
        .from(jellyAction)
        .where(eq(jellyAction.id, input.actionId))
        .limit(1);

      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Action not found" });
      }
      if (
        actor.actorType === "api_key" &&
        existing.apiKeyId !== actor.apiKeyId
      ) {
        throw new ORPCError("NOT_FOUND", { message: "Action not found" });
      }
      if (existing.jellyMailboxId && actor.actorType !== "api_key") {
        requireMailboxAccess(context as never, existing.jellyMailboxId);
      }

      const cancelled = await cancelAction(
        input.actionId,
        input.reason ?? "Cancelled by requester",
      );
      if (!cancelled) {
        throw new ORPCError("CONFLICT", {
          message: `Action is ${existing.status} and can no longer be cancelled`,
        });
      }

      await db.insert(auditLog).values({
        userId: actor.userId,
        apiKeyId: actor.apiKeyId,
        jellyTeamId: env.JELLY_TEAM_ID,
        action: "cancel",
        resource: "jelly_action",
        resourceId: input.actionId,
        status: "success",
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        metadata: { reason: input.reason ?? null },
      });

      return serialiseAction(cancelled);
    }),

  retry: mailboxScopedProcedure
    .route({ method: "POST", path: "/actions/{actionId}/retry" })
    .input(z.object({ actionId: z.string().min(1) }))
    .output(actionSchema)
    .handler(async ({ input, context }) => {
      const actor = resolveActor(context);
      const [existing] = await db
        .select()
        .from(jellyAction)
        .where(eq(jellyAction.id, input.actionId))
        .limit(1);

      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Action not found" });
      }
      if (
        actor.actorType === "api_key" &&
        existing.apiKeyId !== actor.apiKeyId
      ) {
        throw new ORPCError("NOT_FOUND", { message: "Action not found" });
      }
      if (existing.jellyMailboxId && actor.actorType !== "api_key") {
        requireMailboxAccess(context as never, existing.jellyMailboxId);
      }

      checkActionScope(context, existing.actionType);

      const requeued = await retryAction(input.actionId);
      if (!requeued) {
        throw new ORPCError("CONFLICT", {
          message: `Action is ${existing.status} and cannot be retried`,
        });
      }

      await db.insert(auditLog).values({
        userId: actor.userId,
        apiKeyId: actor.apiKeyId,
        jellyTeamId: env.JELLY_TEAM_ID,
        action: "retry",
        resource: "jelly_action",
        resourceId: input.actionId,
        status: "success",
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        metadata: { previousStatus: existing.status },
      });

      return serialiseAction(await dispatchInline(requeued));
    }),

  /**
   * The action types this caller may actually use. A client can render a
   * read-only UI for a read-only key instead of discovering its limits
   * through errors.
   */
  capabilities: mailboxScopedProcedure
    .route({ method: "GET", path: "/actions/capabilities" })
    .output(
      z.object({
        actionTypes: z.array(
          z.object({
            type: z.string(),
            resourceType: z.string(),
            scope: z.string(),
            idempotent: z.boolean(),
            allowed: z.boolean(),
          }),
        ),
        mailboxIds: z.array(z.string()),
      }),
    )
    .handler(async ({ context }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = context as any;
      const actionTypes = ACTION_TYPES.map((type) => {
        const definition = getActionDefinition(type)!;
        let allowed = true;
        try {
          checkActionScope(context, type);
        } catch {
          allowed = false;
        }
        return {
          type,
          resourceType: definition.resourceType,
          scope: definition.scope,
          idempotent: definition.idempotent,
          allowed,
        };
      });

      return {
        actionTypes,
        mailboxIds: (ctx.allowedMailboxIds as string[]) ?? [],
      };
    }),

  /** Queue counts by status, for a client's outbox badge. */
  summary: teamMemberProtectedProcedure
    .route({ method: "GET", path: "/actions/summary" })
    .output(
      z.object({
        counts: z.record(z.string(), z.number()),
        oldestPendingAt: z.date().nullable(),
      }),
    )
    .handler(async () => {
      const rows = await db
        .select({
          status: jellyAction.status,
          count: sql<number>`count(*)::int`,
          oldest: sql<Date | null>`min(${jellyAction.createdAt})`,
        })
        .from(jellyAction)
        .where(eq(jellyAction.jellyTeamId, env.JELLY_TEAM_ID))
        .groupBy(jellyAction.status);

      const counts: Record<string, number> = {};
      let oldestPendingAt: Date | null = null;
      for (const row of rows) {
        counts[row.status] = row.count;
        if (
          (row.status === "pending" || row.status === "scheduled") &&
          row.oldest &&
          (!oldestPendingAt || row.oldest < oldestPendingAt)
        ) {
          oldestPendingAt = row.oldest;
        }
      }
      return { counts, oldestPendingAt };
    }),
};
