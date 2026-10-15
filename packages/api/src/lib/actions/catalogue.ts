import { db } from "@marmalade-v2/db";
import {
  comment,
  conversation,
  conversationAssignment,
} from "@marmalade-v2/db/schema/convo";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { JellyApiClient, JellyRequestMeta } from "../jelly";

export type ActionExecuteResult = {
  response: unknown;
  /** Id Jelly assigned to a resource this action created. */
  resourceId?: string | null;
};

export type ActionExecuteContext = {
  client: JellyApiClient;
  meta: JellyRequestMeta;
  targetResourceId: string | null;
  payload: Record<string, unknown>;
};

export type ActionDefinition = {
  type: string;
  /** Resource the action targets, used for scope checks and audit rows. */
  resourceType: "conversation" | "message" | "label" | "contact" | "team";
  /** Mailbox-scoped actions require a mailbox the caller may write to. */
  scope: "mailbox" | "team";
  /** True when Jelly documents the call as safe to repeat. */
  idempotent: boolean;
  /** True when the action creates a resource and has no target id up front. */
  createsResource?: boolean;
  payloadSchema: z.ZodType;
  execute(ctx: ActionExecuteContext): Promise<ActionExecuteResult>;
  /**
   * Update the local mirror from Jelly's response. Reads are served from
   * Postgres, so without this a client sees stale data immediately after its
   * own successful write.
   */
  applyToMirror?(ctx: {
    targetResourceId: string | null;
    payload: Record<string, unknown>;
    response: unknown;
    resourceId: string | null;
  }): Promise<void>;
  /**
   * Only for non-idempotent actions. Called when an attempt ended with an
   * unknown outcome, to decide between "already applied" and "safe to retry"
   * without risking a duplicate.
   */
  reconcile?(ctx: ActionExecuteContext): Promise<ActionExecuteResult | null>;
};

const empty = z.object({}).strict();

function conversationStatusMirror(status: string) {
  return async ({ targetResourceId }: { targetResourceId: string | null }) => {
    if (!targetResourceId) return;
    await db
      .update(conversation)
      .set({ status, updatedAt: new Date() })
      .where(eq(conversation.id, targetResourceId));
  };
}

/**
 * Every mutating Jelly operation Marmalade exposes.
 *
 * Note what is absent: there is no send action. Jelly's API cannot send
 * customer-facing email — "API tokens can add internal comments, but they
 * cannot send a message to the customer". The draft actions below create a
 * draft that a human finishes in the Jelly UI.
 */
export const ACTION_DEFINITIONS: ActionDefinition[] = [
  {
    type: "conversation.archive",
    resourceType: "conversation",
    scope: "mailbox",
    idempotent: true,
    payloadSchema: empty,
    execute: ({ client, meta, targetResourceId }) =>
      client
        .archiveConversation(targetResourceId!, meta)
        .then((response) => ({ response })),
    applyToMirror: conversationStatusMirror("archived"),
  },
  {
    type: "conversation.unarchive",
    resourceType: "conversation",
    scope: "mailbox",
    idempotent: true,
    payloadSchema: empty,
    execute: ({ client, meta, targetResourceId }) =>
      client
        .unarchiveConversation(targetResourceId!, meta)
        .then((response) => ({ response })),
    applyToMirror: conversationStatusMirror("open"),
  },
  {
    type: "conversation.trash",
    resourceType: "conversation",
    scope: "mailbox",
    idempotent: true,
    payloadSchema: empty,
    execute: ({ client, meta, targetResourceId }) =>
      client
        .trashConversation(targetResourceId!, meta)
        .then((response) => ({ response })),
    applyToMirror: conversationStatusMirror("trashed"),
  },
  {
    type: "conversation.restore",
    resourceType: "conversation",
    scope: "mailbox",
    idempotent: true,
    payloadSchema: empty,
    execute: ({ client, meta, targetResourceId }) =>
      client
        .restoreConversation(targetResourceId!, meta)
        .then((response) => ({ response })),
    applyToMirror: conversationStatusMirror("open"),
  },
  {
    type: "conversation.spam",
    resourceType: "conversation",
    scope: "mailbox",
    idempotent: true,
    payloadSchema: empty,
    execute: ({ client, meta, targetResourceId }) =>
      client
        .spamConversation(targetResourceId!, meta)
        .then((response) => ({ response })),
    applyToMirror: conversationStatusMirror("spam"),
  },
  {
    type: "conversation.unspam",
    resourceType: "conversation",
    scope: "mailbox",
    idempotent: true,
    payloadSchema: empty,
    execute: ({ client, meta, targetResourceId }) =>
      client
        .unspamConversation(targetResourceId!, meta)
        .then((response) => ({ response })),
    applyToMirror: conversationStatusMirror("open"),
  },
  {
    type: "conversation.snooze",
    resourceType: "conversation",
    scope: "mailbox",
    idempotent: true,
    payloadSchema: z
      .object({
        snoozeUntil: z.string().datetime(),
        memberId: z.string().min(1).optional(),
        email: z.email().optional(),
      })
      .refine((v) => v.memberId || v.email, {
        message: "Either memberId or email is required",
      }),
    execute: ({ client, meta, targetResourceId, payload }) =>
      client
        .snoozeConversation(
          targetResourceId!,
          {
            snooze_until: payload.snoozeUntil as string,
            member_id: payload.memberId as string | undefined,
            email: payload.email as string | undefined,
          },
          meta,
        )
        .then((response) => ({ response })),
    applyToMirror: async ({ targetResourceId, payload }) => {
      if (!targetResourceId) return;
      await db
        .update(conversation)
        .set({
          snoozedUntil: new Date(payload.snoozeUntil as string),
          updatedAt: new Date(),
        })
        .where(eq(conversation.id, targetResourceId));
    },
  },
  {
    type: "conversation.unsnooze",
    resourceType: "conversation",
    scope: "mailbox",
    idempotent: true,
    payloadSchema: empty,
    execute: ({ client, meta, targetResourceId }) =>
      client
        .unsnoozeConversation(targetResourceId!, meta)
        .then((response) => ({ response })),
    applyToMirror: async ({ targetResourceId }) => {
      if (!targetResourceId) return;
      await db
        .update(conversation)
        .set({ snoozedUntil: null, updatedAt: new Date() })
        .where(eq(conversation.id, targetResourceId));
    },
  },
  {
    type: "conversation.ignore",
    resourceType: "conversation",
    scope: "mailbox",
    idempotent: true,
    payloadSchema: z
      .object({
        memberId: z.string().min(1).optional(),
        email: z.email().optional(),
      })
      .refine((v) => v.memberId || v.email, {
        message: "Either memberId or email is required",
      }),
    execute: ({ client, meta, targetResourceId, payload }) =>
      client
        .ignoreConversation(
          targetResourceId!,
          {
            member_id: payload.memberId as string | undefined,
            email: payload.email as string | undefined,
          },
          meta,
        )
        .then((response) => ({ response })),
  },
  {
    type: "conversation.set_mailboxes",
    resourceType: "conversation",
    scope: "mailbox",
    idempotent: true,
    payloadSchema: z.object({ mailboxIds: z.array(z.string().min(1)).min(1) }),
    execute: ({ client, meta, targetResourceId, payload }) =>
      client
        .setConversationMailboxes(
          targetResourceId!,
          { mailbox_ids: payload.mailboxIds as string[] },
          meta,
        )
        .then((response) => ({ response })),
  },
  {
    type: "conversation.assign",
    resourceType: "conversation",
    scope: "mailbox",
    idempotent: true,
    payloadSchema: z
      .object({
        memberId: z.string().min(1).optional(),
        email: z.email().optional(),
      })
      .refine((v) => v.memberId || v.email, {
        message: "Either memberId or email is required",
      }),
    execute: ({ client, meta, targetResourceId, payload }) =>
      client
        .assignConversation(
          targetResourceId!,
          {
            member_id: payload.memberId as string | undefined,
            email: payload.email as string | undefined,
          },
          meta,
        )
        .then((response) => ({ response })),
    applyToMirror: async ({ targetResourceId, payload }) => {
      const memberId = payload.memberId as string | undefined;
      if (!targetResourceId || !memberId) return;
      await db
        .insert(conversationAssignment)
        .values({ conversationId: targetResourceId, jellyContactId: memberId })
        .onConflictDoNothing();
    },
  },
  {
    type: "conversation.unassign",
    resourceType: "conversation",
    scope: "mailbox",
    idempotent: true,
    payloadSchema: z.object({ memberId: z.string().min(1) }),
    execute: ({ client, meta, targetResourceId, payload }) =>
      client
        .unassignConversation(
          targetResourceId!,
          payload.memberId as string,
          meta,
        )
        .then((response) => ({ response })),
  },
  {
    type: "conversation.label_apply",
    resourceType: "conversation",
    scope: "mailbox",
    idempotent: true,
    payloadSchema: z.object({ labelId: z.string().min(1) }),
    execute: ({ client, meta, targetResourceId, payload }) =>
      client
        .applyLabel(
          targetResourceId!,
          { label_id: payload.labelId as string },
          meta,
        )
        .then((response) => ({ response })),
    // Label mirroring lands with the label sync work; until the `jelly_label`
    // table is populated there is no row to attach a conversation to.
  },
  {
    type: "conversation.label_remove",
    resourceType: "conversation",
    scope: "mailbox",
    idempotent: true,
    payloadSchema: z.object({ labelId: z.string().min(1) }),
    execute: ({ client, meta, targetResourceId, payload }) =>
      client
        .removeLabel(targetResourceId!, payload.labelId as string, meta)
        .then((response) => ({ response })),
  },
  {
    type: "comment.create",
    resourceType: "conversation",
    scope: "mailbox",
    idempotent: false,
    createsResource: true,
    payloadSchema: z.object({ body: z.string().min(1) }),
    execute: ({ client, meta, targetResourceId, payload }) =>
      client
        .createComment(
          targetResourceId!,
          { body: payload.body as string },
          meta,
        )
        .then((response) => ({
          response,
          resourceId: (response as { id?: string })?.id ?? null,
        })),
    applyToMirror: async ({ targetResourceId, response }) => {
      const created = response as { id?: string; body?: string } | null;
      if (!targetResourceId || !created?.id) return;
      await db
        .insert(comment)
        .values({
          id: created.id,
          conversationId: targetResourceId,
          body: created.body ?? null,
          metadata: { source: "marmalade_action" },
        })
        .onConflictDoNothing();
    },
    /**
     * Comments are not idempotent and Jelly offers no idempotency key, so a
     * timed-out attempt must be checked rather than repeated. One extra read
     * is much cheaper than a duplicate internal note.
     */
    reconcile: async ({ client, meta, targetResourceId, payload }) => {
      if (!targetResourceId) return null;
      const { comments } = await client.listComments(
        targetResourceId,
        { limit: 20 },
        meta,
      );
      const body = payload.body as string;
      const cutoff = Date.now() - 15 * 60 * 1000;
      const match = comments.find(
        (c) =>
          c.body?.trim() === body.trim() && Date.parse(c.created_at) >= cutoff,
      );
      return match ? { response: match, resourceId: match.id } : null;
    },
  },
  {
    type: "label.create",
    resourceType: "label",
    scope: "team",
    idempotent: false,
    createsResource: true,
    payloadSchema: z.object({
      name: z.string().min(1),
      color: z.string().optional(),
    }),
    execute: ({ client, meta, payload }) =>
      client
        .createLabel(
          {
            name: payload.name as string,
            color: payload.color as string | undefined,
          },
          meta,
        )
        .then((response) => ({
          response,
          resourceId: (response as { id?: string })?.id ?? null,
        })),
    reconcile: async ({ client, meta, payload }) => {
      const labels = await client.listLabels(meta);
      const match = labels.find((l) => l.name === payload.name);
      return match ? { response: match, resourceId: match.id } : null;
    },
  },
  {
    type: "label.update",
    resourceType: "label",
    scope: "team",
    idempotent: true,
    payloadSchema: z.object({
      name: z.string().min(1).optional(),
      color: z.string().optional(),
    }),
    execute: ({ client, meta, targetResourceId, payload }) =>
      client
        .updateLabel(
          targetResourceId!,
          {
            name: payload.name as string | undefined,
            color: payload.color as string | undefined,
          },
          meta,
        )
        .then((response) => ({ response })),
  },
  {
    type: "label.delete",
    resourceType: "label",
    scope: "team",
    idempotent: true,
    payloadSchema: empty,
    execute: ({ client, meta, targetResourceId }) =>
      client
        .deleteLabel(targetResourceId!, meta)
        .then((response) => ({ response })),
  },
  {
    type: "contact.upsert",
    resourceType: "contact",
    scope: "team",
    idempotent: true,
    payloadSchema: z.object({
      email: z.email(),
      name: z.string().optional(),
      note: z.string().optional(),
      links: z.record(z.string(), z.string()).optional(),
      labels: z.array(z.string()).optional(),
    }),
    execute: ({ client, meta, payload }) =>
      client
        .upsertContact(
          {
            email: payload.email as string,
            name: payload.name as string | undefined,
            note: payload.note as string | undefined,
            links: payload.links as Record<string, string> | undefined,
            labels: payload.labels as string[] | undefined,
          },
          meta,
        )
        .then((response) => ({ response })),
  },
  {
    type: "autoresponder.update",
    resourceType: "team",
    scope: "team",
    idempotent: true,
    payloadSchema: z.object({
      enabled: z.boolean().optional(),
      message: z.string().optional(),
    }),
    execute: ({ client, meta, payload }) =>
      client
        .updateAutoresponder(
          {
            enabled: payload.enabled as boolean | undefined,
            message: payload.message as string | undefined,
          },
          meta,
        )
        .then((response) => ({ response })),
  },
  {
    type: "draft_conversation.create",
    resourceType: "message",
    scope: "mailbox",
    idempotent: false,
    createsResource: true,
    payloadSchema: z.object({
      subject: z.string().optional(),
      to: z.array(z.email()).optional(),
      cc: z.array(z.email()).optional(),
      bcc: z.array(z.email()).optional(),
      from: z.email().optional(),
      body: z.string().optional(),
      memberId: z.string().optional(),
      mailboxId: z.string().optional(),
    }),
    execute: ({ client, meta, payload }) =>
      client
        .createDraftConversation(
          {
            subject: payload.subject as string | undefined,
            to: payload.to as string[] | undefined,
            cc: payload.cc as string[] | undefined,
            bcc: payload.bcc as string[] | undefined,
            from: payload.from as string | undefined,
            body: payload.body as string | undefined,
            member_id: payload.memberId as string | undefined,
            mailbox_id: payload.mailboxId as string | undefined,
          },
          meta,
        )
        .then((response) => ({
          response,
          resourceId: (response as { id?: string })?.id ?? null,
        })),
  },
  {
    type: "draft_reply.create",
    resourceType: "message",
    scope: "mailbox",
    idempotent: false,
    createsResource: true,
    payloadSchema: z.object({
      body: z.string().min(1),
      memberId: z.string().optional(),
      messageId: z.string().optional(),
      to: z.array(z.email()).optional(),
      cc: z.array(z.email()).optional(),
      bcc: z.array(z.email()).optional(),
    }),
    execute: ({ client, meta, targetResourceId, payload }) =>
      client
        .createDraftReply(
          targetResourceId!,
          {
            body: payload.body as string,
            member_id: payload.memberId as string | undefined,
            message_id: payload.messageId as string | undefined,
            to: payload.to as string[] | undefined,
            cc: payload.cc as string[] | undefined,
            bcc: payload.bcc as string[] | undefined,
          },
          meta,
        )
        .then((response) => ({
          response,
          resourceId: (response as { id?: string })?.id ?? null,
        })),
  },
  {
    type: "draft.update",
    resourceType: "message",
    scope: "mailbox",
    idempotent: true,
    payloadSchema: z.object({
      body: z.string().optional(),
      subject: z.string().optional(),
      to: z.array(z.email()).optional(),
      cc: z.array(z.email()).optional(),
      bcc: z.array(z.email()).optional(),
    }),
    execute: ({ client, meta, targetResourceId, payload }) =>
      client
        .updateDraft(
          targetResourceId!,
          {
            body: payload.body as string | undefined,
            subject: payload.subject as string | undefined,
            to: payload.to as string[] | undefined,
            cc: payload.cc as string[] | undefined,
            bcc: payload.bcc as string[] | undefined,
          },
          meta,
        )
        .then((response) => ({ response })),
  },
];

export const ACTION_BY_TYPE = new Map(
  ACTION_DEFINITIONS.map((definition) => [definition.type, definition]),
);

export const ACTION_TYPES = ACTION_DEFINITIONS.map((d) => d.type);

export function getActionDefinition(type: string): ActionDefinition | null {
  return ACTION_BY_TYPE.get(type) ?? null;
}
