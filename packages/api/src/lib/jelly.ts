import { env } from "@marmalade-v2/env/server";
import { getTeamCredentials } from "./team-credentials";

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

class JellyApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      console.warn(
        `Jelly API error: ${response.status} ${response.statusText}`,
      );
      throw new Error(
        `Jelly API error: ${response.status} ${response.statusText}`,
      );
    }

    return response.json() as Promise<T>;
  }

  async listMembers(): Promise<JellyMember[]> {
    return this.request("/members");
  }

  async getMember(memberId: string): Promise<JellyMember> {
    const allMembers: JellyMember[] = await this.request("/members");
    const member = allMembers.find((m: JellyMember) => m.id === memberId);
    if (!member) {
      throw new Error(`Member not found: ${memberId}`);
    }
    return member;
  }

  async listMailboxes(): Promise<JellyMailbox[]> {
    return this.request("/mailboxes");
  }

  async listMailboxMembers(mailboxId: string): Promise<JellyMember[]> {
    return this.request(`/mailboxes/${mailboxId}/members`);
  }

  async listConversations(params?: {
    status?: string;
    mailbox_id?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    conversations: JellyConversation[];
    next_cursor: string | null;
  }> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    if (params?.mailbox_id) searchParams.set("mailbox_id", params.mailbox_id);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.cursor) searchParams.set("cursor", params.cursor);
    const query = searchParams.toString();
    return this.request(`/conversations${query ? `?${query}` : ""}`);
  }

  async getConversation(conversationId: string): Promise<JellyConversation> {
    return this.request(`/conversations/${conversationId}`);
  }

  async listMessages(
    conversationId: string,
    params?: { limit?: number; cursor?: string },
  ): Promise<{ messages: JellyMessage[]; next_cursor: string | null }> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.cursor) searchParams.set("cursor", params.cursor);
    const query = searchParams.toString();
    return this.request(
      `/conversations/${conversationId}/messages${query ? `?${query}` : ""}`,
    );
  }
}

export type { JellyApiClient };

/**
 * Build a client for one Jelly team from the credentials stored on its row.
 *
 * Async and per-team on purpose. The previous module-level singleton baked one
 * team's environment-supplied token into the module at import time, which made
 * rotating a token a redeploy and connecting a second team impossible.
 *
 * `getTeamCredentials` caches the decrypted token keyed on the row's
 * `credentialsUpdatedAt`, so the common path is a single indexed row read.
 */
export async function getJellyClient(
  teamId: string = env.JELLY_TEAM_ID,
): Promise<JellyApiClient> {
  const credentials = await getTeamCredentials(teamId);

  if (!credentials.active) {
    throw new Error(`Jelly team ${teamId} is not active`);
  }

  return new JellyApiClient(credentials.apiBaseUrl, credentials.apiToken);
}

/** Escape hatch for credentials that are not (yet) stored on a team row. */
export function createJellyClient(
  apiUrl: string,
  apiKey: string,
): JellyApiClient {
  return new JellyApiClient(apiUrl, apiKey);
}
