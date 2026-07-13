import { auditLog } from "@marmalade-v2/db/schema/audit";
import { env } from "@marmalade-v2/env/server";
import { call } from "@orpc/server";
import { auditRouter } from "../routers/audit";

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

  private async auditLogJellyRequest<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const startTime = Date.now();
    try {
      const result = await this.request(path, options);
      const isSuccessful = true;
      const endTime = Date.now();
      await auditLog({
        action: "JELLY_API_CALL",
        metadata: {
          path,
          duration: endTime - startTime,
        },
      });
      return result;
    } catch (error) {
      const endTime = Date.now();
      await call(
        auditRouter.create,
        {
          resource: "mailbox",
          action: "resync",
        },
        {
          path: ["/audit"],
        },
      );
      throw error;
    }
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
      console.log(`Jelly API error: ${response.status} ${response.statusText}`);
      throw new Error(
        `Jelly API error: ${response.status} ${response.statusText}`,
      );
    }

    return response.json();
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

let jellyClient: JellyApiClient | null = null;

export function getJellyClient(): JellyApiClient {
  if (!jellyClient) {
    if (!env.JELLY_API_URL || !env.JELLY_API_KEY) {
      throw new Error("JELLY_API_URL and JELLY_API_KEY must be set");
    }
    jellyClient = new JellyApiClient(env.JELLY_API_URL, env.JELLY_API_KEY);
  }
  return jellyClient;
}

export function createJellyClient(
  apiUrl: string,
  apiKey: string,
): JellyApiClient {
  return new JellyApiClient(apiUrl, apiKey);
}
