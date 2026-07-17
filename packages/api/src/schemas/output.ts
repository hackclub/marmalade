import { z } from "zod";

export const NON_SCOPABLE_FIELDS: Record<string, string[]> = {
  conversation: [
    "id",
    "createdAt",
    "updatedAt",
    "url",
    "snoozedUntil",
    "markdownUrl",
    "messagesUrl",
    "commentsUrl",
    "draftReplyUrl",
  ],
  message: ["id", "createdAt", "conversationId"],
  comment: ["id", "createdAt", "conversationId"],
  team: ["id", "createdAt", "updatedAt"],
};

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const sessionSchema = z.object({
  id: z.string(),
  expiresAt: z.date(),
  token: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  userId: z.string(),
});

export const teamMemberSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  role: z.string(),
  active: z.boolean(),
  jellyTeamId: z.string(),
  existsInJelly: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const auditLogSchema = z.object({
  id: z.number(),
  timestamp: z.date(),
  userId: z.string(),
  jellyTeamId: z.string(),
  action: z.string(),
  resource: z.string(),
  resourceId: z.string(),
  status: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  changes: z.unknown().nullable(),
  metadata: z.unknown().nullable(),
});

export const conversationSchema = z.object({
  id: z.string(),
  subject: z.string().nullable(),
  status: z.string(),
  messagesCount: z.number(),
  commentsCount: z.number(),
  attachmentsCount: z.number(),
  snoozedUntil: z.date().nullable(),
  url: z.string().nullable(),
  markdownUrl: z.string().nullable(),
  messagesUrl: z.string().nullable(),
  commentsUrl: z.string().nullable(),
  draftReplyUrl: z.string().nullable(),
  createdAt: z.date(),
  lastMessageAt: z.date(),
  updatedAt: z.date(),
});

export const conversationAssignmentSchema = z.object({
  id: z.number(),
  conversationId: z.string(),
  jellyContactId: z.string(),
  createdAt: z.date(),
});

export const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  subject: z.string().nullable(),
  content: z.string().nullable(),
  contentHtml: z.string().nullable(),
  senderId: z.string().nullable(),
  isInbound: z.boolean(),
  attachmentsCount: z.number(),
  metadata: z.unknown().nullable(),
  sentAt: z.date().nullable(),
  createdAt: z.date(),
});

export const commentSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  body: z.string().nullable(),
  authorId: z.string().nullable(),
  metadata: z.unknown().nullable(),
  createdAt: z.date(),
});

export const apiKeySchema = z.object({
  id: z.number(),
  keyPrefix: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  mailboxIds: z.array(z.string()),
  resourceScopes: z.array(z.string()).optional(),
  fieldScopes: z
    .array(
      z.object({
        resourceType: z.string(),
        field: z.string(),
      }),
    )
    .optional(),
  createdByName: z.string().nullable().optional(),
});

export const jellyMailboxSchema = z.object({
  id: z.number(),
  jellyMailboxId: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  isDefault: z.boolean(),
  isArchived: z.boolean(),
  jellyTeamId: z.string(),
  existsInJelly: z.boolean(),
});

export const marmaladeMailboxSchema = z.object({
  id: z.number(),
  jellyMailboxId: z.string(),
  jellyTeamId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  active: z.boolean(),
});

export const mailboxMemberSchema = z.object({
  jelly: teamMemberSchema.nullable(),
  marmalade: userSchema.nullable(),
});

export const mailboxListItemSchema = z.object({
  jellyMailbox: jellyMailboxSchema.extend({
    memberCount: z.number(),
    members: z.array(mailboxMemberSchema),
  }),
  marmaladeMailbox: marmaladeMailboxSchema
    .extend({
      memberCount: z.number(),
      members: z.array(mailboxMemberSchema),
    })
    .nullable(),
  marmaladeMailboxMembership: z
    .object({
      id: z.number(),
      marmaladeUserId: z.string(),
      marmaladeMailboxId: z.number(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .nullable(),
});
