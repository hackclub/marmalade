import { db } from "@marmalade-v2/db";
import { jellyRequestLog } from "@marmalade-v2/db/schema/observability";
import { env } from "@marmalade-v2/env/server";
import {
  classifyStatus,
  JellyApiError,
  parseRetryAfter,
  templatePath,
} from "./jelly-errors";
import {
  checkCircuit,
  checkTeamQuota,
  consumeQuota,
  recordCircuitFailure,
  recordCircuitSuccess,
  type QuotaTarget,
} from "./quota";

export interface JellyMember {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
}

export interface JellyMailbox {
  id: string;
  name: string;
  default: boolean;
  members_count: number;
  created_at: string;
  updated_at: string;
}

export interface JellyConversation {
  id: string;
  subject: string | null;
  status: string;
  messages_count: number;
  comments_count: number;
  attachments_count: number;
  mailboxes: {
    id: string;
    name: string;
    default: boolean;
    members_count: number;
  }[];
  labels: { id: string; name: string; color: string }[];
  assignees: JellyMember[];
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

export interface JellyMessage {
  id: string;
  conversation_id: string;
  subject: string;
  inbound: boolean;
  from: string[];
  to: string[];
  cc: string[];
  html_body: string;
  text_body: string;
  attachments_count: number;
  sender: {
    type: string;
    id: string;
    name: string;
    email: string;
  };
  sent_at: string;
  created_at: string;
}

export interface JellyLabel {
  id: string;
  name: string;
  color: string | null;
}

export interface JellyComment {
  id: string;
  conversation_id?: string;
  body: string;
  created_at: string;
  author?: { id?: string; name?: string; email?: string };
}

export interface JellyContact {
  id?: string;
  email: string;
  name?: string | null;
  note?: string | null;
  links?: Record<string, string>;
  labels?: string[];
}

/** Who a request is being made on behalf of, for the request log. */
export type JellyRequestMeta = {
  actionId?: string | null;
  actorType?: string;
  apiKeyId?: number | null;
  userId?: string | null;
  /** Extra quota buckets to charge beyond the team bucket. */
  quotaTargets?: QuotaTarget[];
  /** Worker traffic is held to a reduced share of the daily ceiling. */
  worker?: boolean;
};

type RequestOptions = RequestInit & {
  meta?: JellyRequestMeta;
  /**
   * Bounded in-client retries for transient failures. Reads default to 2.
   * Writes must pass 0: deciding whether to retry a mutation belongs to the
   * action outbox, which knows whether the action is idempotent.
   */
  maxRetries?: number;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_READ_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with full jitter, so concurrent retries desynchronise. */
function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 8000);
  return Math.floor(Math.random() * base);
}

class JellyApiClient {
  private baseUrl: string;
  private apiKey: string;
  private teamId: string;

  constructor(baseUrl: string, apiKey: string, teamId: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.teamId = teamId;
  }

  private async logRequest(entry: {
    meta?: JellyRequestMeta;
    method: string;
    path: string;
    statusCode: number | null;
    durationMs: number;
    retryAfterSeconds: number | null;
    error: string | null;
  }): Promise<void> {
    try {
      await db.insert(jellyRequestLog).values({
        actionId: entry.meta?.actionId ?? null,
        method: entry.method,
        path: templatePath(entry.path),
        statusCode: entry.statusCode,
        durationMs: entry.durationMs,
        retryAfterSeconds: entry.retryAfterSeconds,
        error: entry.error,
        actorType: entry.meta?.actorType ?? "system",
        apiKeyId: entry.meta?.apiKeyId ?? null,
        userId: entry.meta?.userId ?? null,
      });
    } catch (error) {
      // Never let observability failures take down the call they observe.
      console.warn("Failed to write jelly_request_log entry", error);
    }
  }

  private async attempt<T>(
    method: string,
    path: string,
    options: RequestOptions,
  ): Promise<T> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api${path}`, {
        ...options,
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...options.headers,
        },
      });
    } catch (cause) {
      clearTimeout(timeout);
      const aborted = cause instanceof Error && cause.name === "AbortError";
      const message = aborted
        ? "Jelly request timed out"
        : `Jelly request failed: ${cause instanceof Error ? cause.message : String(cause)}`;
      await this.logRequest({
        meta: options.meta,
        method,
        path,
        statusCode: null,
        durationMs: Date.now() - started,
        retryAfterSeconds: null,
        error: message,
      });
      await recordCircuitFailure("team", this.teamId, {
        throttled: false,
        retryAfterSeconds: null,
      });
      // The request may or may not have reached Jelly, so the outcome of a
      // mutation is genuinely unknown here.
      throw new JellyApiError({
        message,
        kind: "unknown",
        status: null,
        method,
        path,
      });
    }
    clearTimeout(timeout);

    const durationMs = Date.now() - started;
    const retryAfterSeconds = parseRetryAfter(
      response.headers.get("Retry-After"),
    );
    const kind = classifyStatus(response.status);

    let body: unknown = null;
    const text = await response.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    await this.logRequest({
      meta: options.meta,
      method,
      path,
      statusCode: response.status,
      durationMs,
      retryAfterSeconds,
      error:
        kind === "success" ? null : `${response.status} ${response.statusText}`,
    });

    if (kind === "success") {
      await recordCircuitSuccess("team", this.teamId);
      return body as T;
    }

    await recordCircuitFailure("team", this.teamId, {
      throttled: kind === "throttled",
      retryAfterSeconds,
    });

    throw new JellyApiError({
      message: `Jelly API ${method} ${path} failed: ${response.status} ${response.statusText}`,
      kind,
      status: response.status,
      retryAfterSeconds,
      body,
      method,
      path,
    });
  }

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const circuit = await checkCircuit("team", this.teamId);
    if (circuit.open) {
      throw new JellyApiError({
        message: circuit.reason,
        kind: "throttled",
        status: null,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((circuit.retryAt.getTime() - Date.now()) / 1000),
        ),
        method,
        path,
      });
    }

    const quota = await checkTeamQuota(this.teamId, {
      worker: options.meta?.worker,
    });
    if (!quota.allowed) {
      throw new JellyApiError({
        message: quota.reason,
        kind: "throttled",
        status: null,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((quota.retryAt.getTime() - Date.now()) / 1000),
        ),
        method,
        path,
      });
    }

    const maxRetries =
      options.maxRetries ?? (method === "GET" ? DEFAULT_READ_RETRIES : 0);

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await consumeQuota([
        { scope: "team", scopeId: this.teamId },
        ...(options.meta?.quotaTargets ?? []),
      ]);

      try {
        return await this.attempt<T>(method, path, options);
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof JellyApiError &&
          (error.kind === "transient" || error.kind === "unknown");
        if (!retryable || attempt === maxRetries) throw error;
        await sleep(backoffMs(attempt));
      }
    }
    throw lastError;
  }

  private buildQuery(params: Record<string, unknown> | undefined): string {
    if (!params) return "";
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      search.set(key, String(value));
    }
    const query = search.toString();
    return query ? `?${query}` : "";
  }

  // ---------------------------------------------------------------- reads

  async listMembers(meta?: JellyRequestMeta): Promise<JellyMember[]> {
    return this.request("GET", "/members", { meta });
  }

  async getMember(
    memberId: string,
    meta?: JellyRequestMeta,
  ): Promise<JellyMember> {
    const allMembers = await this.listMembers(meta);
    const member = allMembers.find((m) => m.id === memberId);
    if (!member) {
      throw new Error(`Member not found: ${memberId}`);
    }
    return member;
  }

  async listMailboxes(meta?: JellyRequestMeta): Promise<JellyMailbox[]> {
    return this.request("GET", "/mailboxes", { meta });
  }

  async listMailboxMembers(
    mailboxId: string,
    meta?: JellyRequestMeta,
  ): Promise<JellyMember[]> {
    return this.request("GET", `/mailboxes/${mailboxId}/members`, { meta });
  }

  async listConversations(
    params?: {
      status?: string;
      mailbox_id?: string;
      label_id?: string;
      limit?: number;
      cursor?: string;
    },
    meta?: JellyRequestMeta,
  ): Promise<{
    conversations: JellyConversation[];
    next_cursor: string | null;
  }> {
    return this.request("GET", `/conversations${this.buildQuery(params)}`, {
      meta,
    });
  }

  async getConversation(
    conversationId: string,
    meta?: JellyRequestMeta,
  ): Promise<JellyConversation> {
    return this.request("GET", `/conversations/${conversationId}`, { meta });
  }

  async listMessages(
    conversationId: string,
    params?: { limit?: number; cursor?: string },
    meta?: JellyRequestMeta,
  ): Promise<{ messages: JellyMessage[]; next_cursor: string | null }> {
    return this.request(
      "GET",
      `/conversations/${conversationId}/messages${this.buildQuery(params)}`,
      { meta },
    );
  }

  async listComments(
    conversationId: string,
    params?: { limit?: number; cursor?: string },
    meta?: JellyRequestMeta,
  ): Promise<{ comments: JellyComment[]; next_cursor: string | null }> {
    return this.request(
      "GET",
      `/conversations/${conversationId}/comments${this.buildQuery(params)}`,
      { meta },
    );
  }

  async listLabels(meta?: JellyRequestMeta): Promise<JellyLabel[]> {
    return this.request("GET", "/labels", { meta });
  }

  // --------------------------------------------------------------- writes
  //
  // Every method below takes `maxRetries: 0`. Whether a failed mutation may be
  // retried depends on whether that action type is idempotent, which only the
  // action outbox knows.

  private write<T>(
    method: string,
    path: string,
    body: unknown,
    meta?: JellyRequestMeta,
  ): Promise<T> {
    return this.request<T>(method, path, {
      meta,
      maxRetries: 0,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  archiveConversation(id: string, meta?: JellyRequestMeta) {
    return this.write<JellyConversation>(
      "POST",
      `/conversations/${id}/archive`,
      undefined,
      meta,
    );
  }

  unarchiveConversation(id: string, meta?: JellyRequestMeta) {
    return this.write<JellyConversation>(
      "DELETE",
      `/conversations/${id}/archive`,
      undefined,
      meta,
    );
  }

  trashConversation(id: string, meta?: JellyRequestMeta) {
    return this.write<JellyConversation>(
      "POST",
      `/conversations/${id}/trash`,
      undefined,
      meta,
    );
  }

  restoreConversation(id: string, meta?: JellyRequestMeta) {
    return this.write<JellyConversation>(
      "DELETE",
      `/conversations/${id}/trash`,
      undefined,
      meta,
    );
  }

  spamConversation(id: string, meta?: JellyRequestMeta) {
    return this.write<JellyConversation>(
      "POST",
      `/conversations/${id}/spam`,
      undefined,
      meta,
    );
  }

  unspamConversation(id: string, meta?: JellyRequestMeta) {
    return this.write<JellyConversation>(
      "DELETE",
      `/conversations/${id}/spam`,
      undefined,
      meta,
    );
  }

  snoozeConversation(
    id: string,
    body: { snooze_until: string; member_id?: string; email?: string },
    meta?: JellyRequestMeta,
  ) {
    return this.write<JellyConversation>(
      "POST",
      `/conversations/${id}/snooze`,
      body,
      meta,
    );
  }

  unsnoozeConversation(id: string, meta?: JellyRequestMeta) {
    return this.write<JellyConversation>(
      "DELETE",
      `/conversations/${id}/snooze`,
      undefined,
      meta,
    );
  }

  ignoreConversation(
    id: string,
    body: { member_id?: string; email?: string },
    meta?: JellyRequestMeta,
  ) {
    return this.write<JellyConversation>(
      "POST",
      `/conversations/${id}/ignore`,
      body,
      meta,
    );
  }

  setConversationMailboxes(
    id: string,
    body: { mailbox_ids: string[] },
    meta?: JellyRequestMeta,
  ) {
    return this.write<JellyConversation>(
      "PATCH",
      `/conversations/${id}/mailboxes`,
      body,
      meta,
    );
  }

  assignConversation(
    id: string,
    body: { member_id?: string; email?: string },
    meta?: JellyRequestMeta,
  ) {
    return this.write<JellyConversation>(
      "POST",
      `/conversations/${id}/assignments`,
      body,
      meta,
    );
  }

  unassignConversation(id: string, memberId: string, meta?: JellyRequestMeta) {
    return this.write<JellyConversation>(
      "DELETE",
      `/conversations/${id}/assignments/${memberId}`,
      undefined,
      meta,
    );
  }

  applyLabel(id: string, body: { label_id: string }, meta?: JellyRequestMeta) {
    return this.write<{ labels: JellyLabel[] }>(
      "POST",
      `/conversations/${id}/labels`,
      body,
      meta,
    );
  }

  removeLabel(id: string, labelId: string, meta?: JellyRequestMeta) {
    return this.write<{ labels: JellyLabel[] }>(
      "DELETE",
      `/conversations/${id}/labels/${labelId}`,
      undefined,
      meta,
    );
  }

  createComment(
    conversationId: string,
    body: { body: string },
    meta?: JellyRequestMeta,
  ) {
    return this.write<JellyComment>(
      "POST",
      `/conversations/${conversationId}/comments`,
      body,
      meta,
    );
  }

  createLabel(body: { name: string; color?: string }, meta?: JellyRequestMeta) {
    return this.write<JellyLabel>("POST", "/labels", body, meta);
  }

  updateLabel(
    labelId: string,
    body: { name?: string; color?: string },
    meta?: JellyRequestMeta,
  ) {
    return this.write<JellyLabel>("PATCH", `/labels/${labelId}`, body, meta);
  }

  deleteLabel(labelId: string, meta?: JellyRequestMeta) {
    return this.write<null>("DELETE", `/labels/${labelId}`, undefined, meta);
  }

  upsertContact(body: JellyContact, meta?: JellyRequestMeta) {
    return this.write<JellyContact>("POST", "/contacts", body, meta);
  }

  updateAutoresponder(
    body: { enabled?: boolean; message?: string },
    meta?: JellyRequestMeta,
  ) {
    return this.write<{ enabled: boolean; message: string | null }>(
      "PATCH",
      "/autoresponder",
      body,
      meta,
    );
  }

  /**
   * Creates a draft. Jelly never sends it: "Nothing is sent to the recipient
   * until a team member sends it."
   */
  createDraftConversation(
    body: {
      subject?: string;
      to?: string[];
      cc?: string[];
      bcc?: string[];
      from?: string;
      body?: string;
      member_id?: string;
      mailbox_id?: string;
    },
    meta?: JellyRequestMeta,
  ) {
    return this.write<JellyMessage>("POST", "/draft_conversations", body, meta);
  }

  createDraftReply(
    conversationId: string,
    body: {
      body: string;
      member_id?: string;
      message_id?: string;
      to?: string[];
      cc?: string[];
      bcc?: string[];
    },
    meta?: JellyRequestMeta,
  ) {
    return this.write<JellyMessage>(
      "POST",
      `/conversations/${conversationId}/draft_reply`,
      body,
      meta,
    );
  }

  updateDraft(
    messageId: string,
    body: {
      body?: string;
      subject?: string;
      to?: string[];
      cc?: string[];
      bcc?: string[];
    },
    meta?: JellyRequestMeta,
  ) {
    return this.write<JellyMessage>(
      "PATCH",
      `/messages/${messageId}`,
      body,
      meta,
    );
  }
}

export type { JellyApiClient };

let jellyClient: JellyApiClient | null = null;

export function getJellyClient(): JellyApiClient {
  if (!jellyClient) {
    if (!env.JELLY_API_URL || !env.JELLY_API_KEY) {
      throw new Error("JELLY_API_URL and JELLY_API_KEY must be set");
    }
    jellyClient = new JellyApiClient(
      env.JELLY_API_URL,
      env.JELLY_API_KEY,
      env.JELLY_TEAM_ID,
    );
  }
  return jellyClient;
}

export function createJellyClient(
  apiUrl: string,
  apiKey: string,
  teamId: string = env.JELLY_TEAM_ID,
): JellyApiClient {
  return new JellyApiClient(apiUrl, apiKey, teamId);
}
