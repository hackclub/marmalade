import { z } from "zod";
import {
  apiKeySchema,
  mailboxListItemSchema,
  teamMemberSchema,
  userSchema,
} from "./entities";

export const routes = {
  healthCheck: { method: "GET", path: "/health" },
  privateData: { method: "GET", path: "/me" },
  membershipInfo: { method: "GET", path: "/membership" },
  mailbox: {
    getMailboxDetails: { method: "GET", path: "/mailboxes/{jellyMailboxId}" },
    list: { method: "GET", path: "/mailboxes" },
    create: { method: "POST", path: "/mailboxes" },
    resync: { method: "POST", path: "/mailboxes/resync" },
    resyncMembers: {
      method: "POST",
      path: "/mailboxes/{mailboxId}/members/resync",
    },
    createMember: {
      method: "POST",
      path: "/mailboxes/{marmaladeMailboxId}/members",
    },
    removeMember: {
      method: "DELETE",
      path: "/mailboxes/{marmaladeMailboxId}/members/{marmaladeMemberId}",
    },
    deactivate: {
      method: "POST",
      path: "/mailboxes/{marmaladeMailboxId}/deactivate",
    },
    activate: {
      method: "POST",
      path: "/mailboxes/{marmaladeMailboxId}/activate",
    },
  },
  team: {
    list: { method: "GET", path: "/members" },
    get: { method: "GET", path: "/members/:id" },
    add: { method: "POST", path: "/members" },
    resync: { method: "POST", path: "/resync" },
  },
  apiKey: {
    create: { method: "POST", path: "/keys" },
    listMailbox: { method: "GET", path: "/mailboxes/{mailboxId}/keys" },
    listTeam: { method: "GET", path: "/keys" },
    revokeTeamKey: { method: "POST", path: "/keys/{keyId}/revoke" },
    revoke: { method: "DELETE", path: "/mailboxes/{mailboxId}/keys/{keyId}" },
    revokePublic: { method: "POST", path: "/revoke" },
    delete: { method: "DELETE", path: "/admin/keys/{keyId}" },
  },
} as const;

const messageOutputSchema = z.object({ message: z.string() });

export const healthCheckOutputSchema = z.literal("OK");

export const privateDataOutputSchema = z.object({
  message: z.string(),
  user: z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      image: z.string().nullable().optional(),
    })
    .nullable(),
});

export const membershipInfoOutputSchema = teamMemberSchema;

export const auditCreateInputSchema = z.object({
  resource: z.string().min(1),
  action: z.string().min(1),
  resourceId: z.string().optional(),
  status: z.string().optional(),
  changes: z.any().optional(),
  metadata: z.any().optional(),
});

export const mailboxGetMailboxDetailsInputSchema = z.object({
  jellyMailboxId: z.string().min(1),
});

export const mailboxGetMailboxDetailsOutputSchema = z.discriminatedUnion(
  "allowed",
  [
    z.object({
      success: z.literal(true),
      allowed: z.literal(true),
      inboxId: z.number(),
    }),
    z.object({
      success: z.literal(true),
      allowed: z.literal(false),
      reason: z.string(),
    }),
  ],
);

export const mailboxListOutputSchema = z.array(mailboxListItemSchema);

export const mailboxCreateInputSchema = z.object({
  jellyMailboxId: z.string().min(1),
});

export const mailboxCreateOutputSchema = messageOutputSchema;
export const mailboxResyncOutputSchema = messageOutputSchema;

export const mailboxResyncMembersInputSchema = z.object({
  mailboxId: z.string().min(1),
});
export const mailboxResyncMembersOutputSchema = messageOutputSchema;

export const mailboxCreateMemberInputSchema = z.object({
  marmaladeMailboxId: z.number().int().min(1),
  marmaladeMemberId: z.string().min(1),
});
export const mailboxCreateMemberOutputSchema = messageOutputSchema;

export const mailboxRemoveMemberInputSchema = z.object({
  marmaladeMailboxId: z.number().int().min(1),
  marmaladeMemberId: z.string().min(1),
});
export const mailboxRemoveMemberOutputSchema = messageOutputSchema;

export const mailboxToggleActiveInputSchema = z.object({
  marmaladeMailboxId: z.number().int().min(1),
});
export const mailboxDeactivateOutputSchema = messageOutputSchema;
export const mailboxActivateOutputSchema = messageOutputSchema;

export const teamMemberWithUserSchema = z.object({
  jelly: teamMemberSchema.nullable(),
  marmalade: userSchema.nullable(),
});
export const teamListOutputSchema = z.array(teamMemberWithUserSchema);

export const teamGetInputSchema = z.object({ id: z.string() });
export const teamGetOutputSchema = teamMemberWithUserSchema;

export const teamAddInputSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  email: z.string().email().optional(),
});
export const teamAddOutputSchema = teamMemberWithUserSchema;

export const teamResyncOutputSchema = messageOutputSchema;

export const apiKeyCreateInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  mailboxIds: z.array(z.string().min(1)).optional(),
  resourceScopes: z.array(z.string().min(1)).optional(),
  fieldScopes: z
    .array(
      z.object({
        resourceType: z.string(),
        field: z.string(),
      }),
    )
    .optional(),
  expiresAt: z.string().datetime().optional(),
});

export const apiKeyCreateOutputSchema = z.object({
  id: z.number(),
  keyPrefix: z.string(),
  secret: z.string(),
  name: z.string(),
  mailboxIds: z.array(z.string()),
  resourceScopes: z.array(z.string()),
  fieldScopes: z.array(
    z.object({
      resourceType: z.string(),
      field: z.string(),
    }),
  ),
  expiresAt: z.string().nullable(),
});

export const apiKeyListMailboxInputSchema = z.object({
  mailboxId: z.string().min(1),
});
export const apiKeyListMailboxOutputSchema = z.array(apiKeySchema);

export const apiKeyListTeamOutputSchema = z.array(apiKeySchema);

export const apiKeyRevokeTeamKeyInputSchema = z.object({
  keyId: z.coerce.number().min(1),
});
export const apiKeyRevokeTeamKeyOutputSchema = messageOutputSchema;

export const apiKeyRevokeInputSchema = z.object({
  mailboxId: z.string().min(1),
  keyId: z.coerce.number().min(1),
});
export const apiKeyRevokeOutputSchema = messageOutputSchema;

export const apiKeyRevokePublicInputSchema = z.object({
  key: z.string().min(1),
  revoker: z.string().optional(),
});
export const apiKeyRevokePublicOutputSchema = messageOutputSchema;

export const apiKeyDeleteInputSchema = z.object({
  keyId: z.coerce.number().min(1),
});
export const apiKeyDeleteOutputSchema = messageOutputSchema;
