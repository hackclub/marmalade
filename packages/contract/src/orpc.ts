import { type as orpcType } from "@orpc/contract";
import { implement } from "@orpc/server";
import {
  healthCheckOutputSchema,
  membershipInfoOutputSchema,
  privateDataOutputSchema,
  routes,
} from "./schemas/procedures";
import {
  mailboxActivateOutputSchema,
  mailboxCreateInputSchema,
  mailboxCreateMemberInputSchema,
  mailboxCreateMemberOutputSchema,
  mailboxCreateOutputSchema,
  mailboxDeactivateOutputSchema,
  mailboxGetMailboxDetailsInputSchema,
  mailboxGetMailboxDetailsOutputSchema,
  mailboxListOutputSchema,
  mailboxRemoveMemberInputSchema,
  mailboxRemoveMemberOutputSchema,
  mailboxResyncMembersInputSchema,
  mailboxResyncMembersOutputSchema,
  mailboxResyncOutputSchema,
  mailboxToggleActiveInputSchema,
} from "./schemas/procedures";
import {
  teamAddInputSchema,
  teamAddOutputSchema,
  teamGetInputSchema,
  teamGetOutputSchema,
  teamListOutputSchema,
  teamResyncOutputSchema,
} from "./schemas/procedures";
import {
  apiKeyCreateInputSchema,
  apiKeyCreateOutputSchema,
  apiKeyDeleteInputSchema,
  apiKeyDeleteOutputSchema,
  apiKeyListMailboxInputSchema,
  apiKeyListMailboxOutputSchema,
  apiKeyListTeamOutputSchema,
  apiKeyRevokeInputSchema,
  apiKeyRevokeOutputSchema,
  apiKeyRevokePublicInputSchema,
  apiKeyRevokePublicOutputSchema,
  apiKeyRevokeTeamKeyInputSchema,
  apiKeyRevokeTeamKeyOutputSchema,
} from "./schemas/procedures";
import {
  jellyEventWebhookOutputSchema,
  jellyWebhookSchema,
} from "./schemas/webhook";

const unimplemented = (): never => {
  throw new Error(
    "@marm/contract: this router is for typing/contracts only",
  );
};

export const appContract = {
  healthCheck: orpcType()
    .route(routes.healthCheck)
    .output(healthCheckOutputSchema),
  privateData: orpcType()
    .route(routes.privateData)
    .output(privateDataOutputSchema),
  membershipInfo: orpcType()
    .route(routes.membershipInfo)
    .output(membershipInfoOutputSchema),

  mailbox: {
    getMailboxDetails: orpcType()
      .route(routes.mailbox.getMailboxDetails)
      .input(mailboxGetMailboxDetailsInputSchema)
      .output(mailboxGetMailboxDetailsOutputSchema),
    list: orpcType()
      .route(routes.mailbox.list)
      .output(mailboxListOutputSchema),
    create: orpcType()
      .route(routes.mailbox.create)
      .input(mailboxCreateInputSchema)
      .output(mailboxCreateOutputSchema),
    resync: orpcType()
      .route(routes.mailbox.resync)
      .output(mailboxResyncOutputSchema),
    resyncMembers: orpcType()
      .route(routes.mailbox.resyncMembers)
      .input(mailboxResyncMembersInputSchema)
      .output(mailboxResyncMembersOutputSchema),
    createMember: orpcType()
      .route(routes.mailbox.createMember)
      .input(mailboxCreateMemberInputSchema)
      .output(mailboxCreateMemberOutputSchema),
    removeMember: orpcType()
      .route(routes.mailbox.removeMember)
      .input(mailboxRemoveMemberInputSchema)
      .output(mailboxRemoveMemberOutputSchema),
    deactivate: orpcType()
      .route(routes.mailbox.deactivate)
      .input(mailboxToggleActiveInputSchema)
      .output(mailboxDeactivateOutputSchema),
    activate: orpcType()
      .route(routes.mailbox.activate)
      .input(mailboxToggleActiveInputSchema)
      .output(mailboxActivateOutputSchema),
  },

  team: {
    list: orpcType().route(routes.team.list).output(teamListOutputSchema),
    get: orpcType()
      .route(routes.team.get)
      .input(teamGetInputSchema)
      .output(teamGetOutputSchema),
    add: orpcType()
      .route(routes.team.add)
      .input(teamAddInputSchema)
      .output(teamAddOutputSchema),
    resync: orpcType().route(routes.team.resync).output(teamResyncOutputSchema),
  },

  apiKey: {
    create: orpcType()
      .route(routes.apiKey.create)
      .input(apiKeyCreateInputSchema)
      .output(apiKeyCreateOutputSchema),
    listMailbox: orpcType()
      .route(routes.apiKey.listMailbox)
      .input(apiKeyListMailboxInputSchema)
      .output(apiKeyListMailboxOutputSchema),
    listTeam: orpcType()
      .route(routes.apiKey.listTeam)
      .output(apiKeyListTeamOutputSchema),
    revokeTeamKey: orpcType()
      .route(routes.apiKey.revokeTeamKey)
      .input(apiKeyRevokeTeamKeyInputSchema)
      .output(apiKeyRevokeTeamKeyOutputSchema),
    revoke: orpcType()
      .route(routes.apiKey.revoke)
      .input(apiKeyRevokeInputSchema)
      .output(apiKeyRevokeOutputSchema),
    revokePublic: orpcType()
      .route(routes.apiKey.revokePublic)
      .input(apiKeyRevokePublicInputSchema)
      .output(apiKeyRevokePublicOutputSchema),
    delete: orpcType()
      .route(routes.apiKey.delete)
      .input(apiKeyDeleteInputSchema)
      .output(apiKeyDeleteOutputSchema),
  },

  webhook: {
    jellyEventWebhook: orpcType()
      .input(jellyWebhookSchema)
      .output(jellyEventWebhookOutputSchema),
  },
} as const;

const impl = implement(appContract);

export const appRouterContract = {
  healthCheck: impl.healthCheck.handler(unimplemented),
  privateData: impl.privateData.handler(unimplemented),
  membershipInfo: impl.membershipInfo.handler(unimplemented),

  mailbox: {
    getMailboxDetails: impl.mailbox.getMailboxDetails.handler(unimplemented),
    list: impl.mailbox.list.handler(unimplemented),
    create: impl.mailbox.create.handler(unimplemented),
    resync: impl.mailbox.resync.handler(unimplemented),
    resyncMembers: impl.mailbox.resyncMembers.handler(unimplemented),
    createMember: impl.mailbox.createMember.handler(unimplemented),
    removeMember: impl.mailbox.removeMember.handler(unimplemented),
    deactivate: impl.mailbox.deactivate.handler(unimplemented),
    activate: impl.mailbox.activate.handler(unimplemented),
  },

  team: {
    list: impl.team.list.handler(unimplemented),
    get: impl.team.get.handler(unimplemented),
    add: impl.team.add.handler(unimplemented),
    resync: impl.team.resync.handler(unimplemented),
  },

  apiKey: {
    create: impl.apiKey.create.handler(unimplemented),
    listMailbox: impl.apiKey.listMailbox.handler(unimplemented),
    listTeam: impl.apiKey.listTeam.handler(unimplemented),
    revokeTeamKey: impl.apiKey.revokeTeamKey.handler(unimplemented),
    revoke: impl.apiKey.revoke.handler(unimplemented),
    revokePublic: impl.apiKey.revokePublic.handler(unimplemented),
    delete: impl.apiKey.delete.handler(unimplemented),
  },

  webhook: {
    jellyEventWebhook: impl.webhook.jellyEventWebhook.handler(unimplemented),
  },
} as const;

export type AppRouter = typeof appRouterContract;

