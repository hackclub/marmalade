import { db } from "@marmalade-v2/db";
import { user as authUser } from "@marmalade-v2/db/schema/auth";
import {
  jellyMailbox,
  jellyMailboxMember,
  marmaladeMailbox,
  marmaladeMailboxMember,
} from "@marmalade-v2/db/schema/mailbox";
import { jellyTeam, jellyTeamContact } from "@marmalade-v2/db/schema/team";
import { call } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { aliasedTable } from "drizzle-orm/alias";
import { getJellyClient } from "../lib/jelly";

import { env } from "@marmalade-v2/env/server";
import { ORPCError } from "@orpc/client";
import z from "zod";
import {
  mailboxScopedProcedure,
  publicProcedure,
  requireMailboxAccess,
  teamAdminProtectedProcedure,
} from "../index";
import { auditRouter } from "./audit";
import { mailboxListItemSchema } from "../schemas/output";

const jelly = getJellyClient();
const jellyMailboxMembersAll = aliasedTable(
  jellyMailboxMember,
  "jelly_mailbox_members_all",
);

const marmaladeMailboxMembersAll = aliasedTable(
  marmaladeMailboxMember,
  "marmalade_mailbox_members_all",
);

const jellyMailboxMemberTeamMember = aliasedTable(
  jellyTeamContact,
  "jelly_mailbox_member_team_member",
);

const jellyMailboxMemberUser = aliasedTable(
  authUser,
  "jelly_mailbox_member_user",
);

const marmaladeMailboxMemberUser = aliasedTable(
  authUser,
  "marmalade_mailbox_member_user",
);

const marmaladeMailboxMemberTeamMember = aliasedTable(
  jellyTeamContact,
  "marmalade_mailbox_member_team_member",
);

type JellyMailboxRow = typeof jellyMailbox.$inferSelect;
type MarmaladeMailboxRow = typeof marmaladeMailbox.$inferSelect;
type MarmaladeMailboxMemberRow = typeof marmaladeMailboxMember.$inferSelect;
type TeamMemberRow = typeof jellyTeamContact.$inferSelect;
type AuthUserRow = typeof authUser.$inferSelect;

type MailboxMemberItem = {
  jelly: TeamMemberRow | null;
  marmalade: AuthUserRow | null;
};

type MailboxListQueryRow = {
  jellyMailbox: JellyMailboxRow;
  jellyMailboxMemberTeamMember: TeamMemberRow | null;
  jellyMailboxMemberUser: AuthUserRow | null;
  marmaladeMailbox: MarmaladeMailboxRow | null;
  marmaladeMailboxMemberUser: typeof authUser.$inferSelect | null;
  marmaladeMailboxMemberTeamMember: TeamMemberRow | null;
  marmaladeMailboxMembership: MarmaladeMailboxMemberRow | null;
};

export const mailboxRouter = {
  getMailboxDetails: mailboxScopedProcedure
    .route({ method: "GET", path: "/mailboxes/{jellyMailboxId}" })
    .input(
      z.object({
        jellyMailboxId: z.string().min(1),
      }),
    )
    .output(
      z.discriminatedUnion("allowed", [
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
      ]),
    )
    .handler(async ({ input, context }) => {
      requireMailboxAccess(context, input.jellyMailboxId);

      let jellyMailboxRows: Array<{
        id: number;
        isArchived: boolean;
      }> = [];

      try {
        jellyMailboxRows = await db
          .select({
            id: jellyMailbox.id,
            isArchived: jellyMailbox.isArchived,
          })
          .from(jellyMailbox)
          .where(eq(jellyMailbox.jellyMailboxId, input.jellyMailboxId))
          .limit(1);
      } catch (error) {
        console.warn("Jelly mailbox table unavailable during webhook", error);
      }

      if (jellyMailboxRows.length === 0) {
        return {
          success: true as const,
          allowed: false as const,
          reason: "mailbox not found",
        };
      }

      const jellyMailboxRow = jellyMailboxRows[0];

      if (!jellyMailboxRow) {
        return {
          success: true as const,
          allowed: false as const,
          reason: "mailbox not found",
        };
      }

      if (jellyMailboxRow.isArchived) {
        return {
          success: true as const,
          allowed: false as const,
          reason: "mailbox archived",
        };
      }

      const marmaladeMailboxRows = await db
        .select({
          id: marmaladeMailbox.id,
          active: marmaladeMailbox.active,
        })
        .from(marmaladeMailbox)
        .where(eq(marmaladeMailbox.jellyMailboxId, input.jellyMailboxId))
        .limit(1);

      if (marmaladeMailboxRows.length === 0) {
        return {
          success: true as const,
          allowed: false as const,
          reason: "mailbox not setup",
        };
      }

      const marmaladeMailboxRow = marmaladeMailboxRows[0];

      if (!marmaladeMailboxRow || !marmaladeMailboxRow.active) {
        return {
          success: true as const,
          allowed: false as const,
          reason: "mailbox not active",
        };
      }

      return {
        success: true as const,
        allowed: true as const,
        inboxId: marmaladeMailboxRow.id,
      };
    }),
  list: mailboxScopedProcedure
    .route({ method: "GET", path: "/mailboxes" })
    .output(z.array(mailboxListItemSchema))
    .handler(async ({ context }) => {
      if ("apiKey" in context) {
        const mailboxes = await db
          .select()
          .from(jellyMailbox)
          .innerJoin(
            marmaladeMailbox,
            eq(jellyMailbox.jellyMailboxId, marmaladeMailbox.jellyMailboxId),
          )
          .where(
            inArray(jellyMailbox.jellyMailboxId, context.allowedMailboxIds),
          );

        return mailboxes.map((row) => ({
          jellyMailbox: row.jelly_mailbox,
          marmaladeMailbox: row.mailbox,
          marmaladeMailboxMembership: null,
        }));
      }

      const requesterId = context.session?.user.id;
      const requesterEmail = context.session?.user.email;
      if (!requesterId || !requesterEmail) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "User is not authenticated",
        });
      }
      const results = ((await db
        .select({
          jellyMailbox: jellyMailbox,
          jellyMailboxMemberTeamMember: jellyMailboxMemberTeamMember,
          jellyMailboxMemberUser: jellyMailboxMemberUser,
          marmaladeMailbox: marmaladeMailbox,
          marmaladeMailboxMemberUser: marmaladeMailboxMemberUser,
          marmaladeMailboxMemberTeamMember: marmaladeMailboxMemberTeamMember,
          marmaladeMailboxMembership: marmaladeMailboxMember,
        })
        .from(jellyMailbox)
        .innerJoin(
          jellyMailboxMember,
          eq(jellyMailbox.jellyMailboxId, jellyMailboxMember.jellyMailboxId),
        )
        .innerJoin(
          jellyTeamContact,
          and(
            eq(jellyMailboxMember.jellyContactId, jellyTeamContact.id),
            eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID),
            eq(jellyTeamContact.email, requesterEmail),
          ),
        )
        .leftJoin(
          jellyMailboxMembersAll,
          eq(
            jellyMailbox.jellyMailboxId,
            jellyMailboxMembersAll.jellyMailboxId,
          ),
        )
        .leftJoin(
          jellyMailboxMemberTeamMember,
          and(
            eq(
              jellyMailboxMembersAll.jellyContactId,
              jellyMailboxMemberTeamMember.id,
            ),
          ),
        )
        .leftJoin(
          jellyMailboxMemberUser,
          eq(jellyMailboxMemberTeamMember.email, jellyMailboxMemberUser.email),
        )
        .leftJoin(
          marmaladeMailbox,
          eq(jellyMailbox.jellyMailboxId, marmaladeMailbox.jellyMailboxId),
        )
        .leftJoin(
          marmaladeMailboxMembersAll,
          eq(
            marmaladeMailbox.id,
            marmaladeMailboxMembersAll.marmaladeMailboxId,
          ),
        )
        .leftJoin(
          marmaladeMailboxMemberUser,
          eq(
            marmaladeMailboxMembersAll.marmaladeUserId,
            marmaladeMailboxMemberUser.id,
          ),
        )
        .leftJoin(
          marmaladeMailboxMemberTeamMember,
          and(
            eq(
              marmaladeMailboxMemberUser.email,
              marmaladeMailboxMemberTeamMember.email,
            ),
            eq(
              marmaladeMailboxMemberUser.email,
              marmaladeMailboxMemberTeamMember.email,
            ),
          ),
        )
        .leftJoin(
          marmaladeMailboxMember,
          and(
            eq(marmaladeMailbox.id, marmaladeMailboxMember.marmaladeMailboxId),
            eq(marmaladeMailboxMember.marmaladeUserId, requesterId),
          ),
        )) ?? []) as MailboxListQueryRow[];

      const mailboxById = new Map<number, any>();

      for (const result of results as any[]) {
        const mailboxId = result.jellyMailbox.id;
        let entry = mailboxById.get(mailboxId);

        if (!entry) {
          const jellyMembers: MailboxMemberItem[] = [];
          const marmaladeMembers: MailboxMemberItem[] = [];
          entry = {
            jellyMailbox: {
              ...result.jellyMailbox,
              memberCount: 0,
              members: jellyMembers,
            },
            marmaladeMailbox: result.marmaladeMailbox
              ? {
                  ...result.marmaladeMailbox,
                  memberCount: 0,
                  members: marmaladeMembers,
                }
              : null,
            marmaladeMailboxMembership: result.marmaladeMailboxMembership,
            jellyMemberIds: new Set<number>(),
            marmaladeMemberIds: new Set<number>(),
          };
          mailboxById.set(mailboxId, entry);
        }

        if (
          result.jellyMailboxMemberTeamMember &&
          !entry.jellyMemberIds.has(result.jellyMailboxMemberTeamMember.id)
        ) {
          entry.jellyMemberIds.add(result.jellyMailboxMemberTeamMember.id);
          entry.jellyMailbox.members.push({
            jelly: result.jellyMailboxMemberTeamMember,
            marmalade: result.jellyMailboxMemberUser,
          });
          entry.jellyMailbox.memberCount = entry.jellyMailbox.members.length;
        }

        if (
          result.marmaladeMailboxMemberTeamMember &&
          entry.marmaladeMailbox &&
          !entry.marmaladeMemberIds.has(
            result.marmaladeMailboxMemberTeamMember.id,
          )
        ) {
          entry.marmaladeMemberIds.add(
            result.marmaladeMailboxMemberTeamMember.id,
          );
          entry.marmaladeMailbox.members.push({
            jelly: result.marmaladeMailboxMemberTeamMember,
            marmalade: result.marmaladeMailboxMemberUser,
          });
          entry.marmaladeMailbox.memberCount =
            entry.marmaladeMailbox.members.length;
        }

        if (result.marmaladeMailboxMembership) {
          entry.marmaladeMailboxMembership = result.marmaladeMailboxMembership;
        }
      }

      return Array.from(mailboxById.values()).map((entry) => ({
        jellyMailbox: entry.jellyMailbox,
        marmaladeMailbox: entry.marmaladeMailbox,
        marmaladeMailboxMembership: entry.marmaladeMailboxMembership,
      }));
    }),
  create: teamAdminProtectedProcedure
    .route({ method: "POST", path: "/mailboxes" })
    .input(z.object({ jellyMailboxId: z.string().min(1) }))
    .output(z.object({ message: z.string() }))
    .handler(async ({ input, context }) => {
      const requesterId = context.session.user.id;
      const requesterEmail = context.session.user.email;
      if (!requesterId || !requesterEmail) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "User is not authenticated",
        });
      }
      const mailbox = await db
        .select()
        .from(jellyMailbox)
        .where(eq(jellyMailbox.jellyMailboxId, input.jellyMailboxId));
      if (!mailbox) {
        throw new ORPCError("NOT_FOUND", {
          message: "Mailbox not found",
        });
      }
      const newMailbox = await db
        .insert(marmaladeMailbox)
        .values({
          jellyMailboxId: input.jellyMailboxId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          jellyTeamId: env.JELLY_TEAM_ID,
          active: true,
        })
        .returning({ id: marmaladeMailbox.id });
      await call(
        auditRouter.create,
        {
          resource: "mailbox",
          action: "create",
          resourceId: newMailbox[0]?.id.toString() ?? undefined,
        },
        {
          context,
        },
      );
      return { message: "Mailbox created successfully" };
    }),
  resync: publicProcedure
    .route({ method: "POST", path: "/mailboxes/resync" })
    .output(z.object({ message: z.string() }))
    .handler(async ({ context }) => {
      const existingTeam = await db
        .select()
        .from(jellyTeam)
        .where(eq(jellyTeam.id, env.JELLY_TEAM_ID))
        .limit(1);
      if (existingTeam.length === 0) {
        await db.insert(jellyTeam).values({ id: env.JELLY_TEAM_ID });
      }
      let mailboxes;
      try {
        mailboxes = await jelly.listMailboxes();
      } catch {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to fetch mailboxes from Jelly",
        });
      }
      if (!mailboxes || mailboxes.length === 0) {
        throw new ORPCError("NOT_FOUND", {
          message: "No mailboxes found in Jelly",
        });
      }
      const mailboxIds = mailboxes.map((mailbox) => mailbox.id);
      const existingMailboxes = await db
        .select()
        .from(jellyMailbox)
        .where(inArray(jellyMailbox.jellyMailboxId, mailboxIds));
      const existingMailboxIds = existingMailboxes.map(
        (mailbox) => mailbox.jellyMailboxId,
      );
      const newMailboxes = mailboxes.filter(
        (mailbox) => !existingMailboxIds.includes(mailbox.id),
      );
      const removedMailboxes = existingMailboxes.filter(
        (mailbox) => !mailboxIds.includes(mailbox.jellyMailboxId),
      );
      if (removedMailboxes.length > 0) {
        await db
          .update(jellyMailbox)
          .set({ existsInJelly: false })
          .where(
            inArray(
              jellyMailbox.jellyMailboxId,
              removedMailboxes.map((mailbox) => mailbox.jellyMailboxId),
            ),
          );
      }
      if (newMailboxes.length > 0) {
        await db.insert(jellyMailbox).values(
          newMailboxes.map((mailbox) => ({
            jellyMailboxId: mailbox.id,
            name: mailbox.name,
            jellyTeamId: env.JELLY_TEAM_ID,
            createdAt: new Date(mailbox.created_at).toISOString(),
            updatedAt: new Date(mailbox.updated_at).toISOString(),
            isDefault: mailbox.default,
            isArchived: false,
            existsInJelly: true,
          })),
        );
      }
      for (const mailbox of mailboxes) {
        await call(
          mailboxRouter.resyncMembers,
          {
            mailboxId: mailbox.id,
          },
          {
            context,
          },
        );
      }
      await call(
        auditRouter.create,
        {
          resource: "mailbox",
          action: "resync",
        },
        {
          context,
        },
      );
      return { message: "Resync completed successfully" };
    }),
  resyncMembers: publicProcedure
    .route({
      method: "POST",
      path: "/mailboxes/{mailboxId}/members/resync",
    })
    .input(
      z.object({
        mailboxId: z.string().min(1),
      }),
    )
    .output(z.object({ message: z.string() }))
    .handler(async ({ input, context }) => {
      let mailboxMembers;
      try {
        mailboxMembers = await jelly.listMailboxMembers(input.mailboxId);
      } catch {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to fetch mailbox members from Jelly",
        });
      }
      if (!mailboxMembers || mailboxMembers.length === 0) {
        throw new ORPCError("NOT_FOUND", {
          message: "No mailbox members found in Jelly",
        });
      }
      const memberIds = mailboxMembers.map((member) => member.id);
      const existingMembers = await db
        .select()
        .from(jellyMailboxMember)
        .where(inArray(jellyMailboxMember.jellyContactId, memberIds));
      const existingMemberIds = existingMembers.map(
        (member) => member.jellyContactId,
      );
      const newMembers = mailboxMembers.filter(
        (member) => !existingMemberIds.includes(member.id),
      );
      const removedMembers = existingMembers.filter(
        (member) => !memberIds.includes(member.jellyContactId),
      );
      if (removedMembers.length > 0) {
        await db.delete(jellyMailboxMember).where(
          inArray(
            jellyMailboxMember.jellyContactId,
            removedMembers.map((member) => member.jellyContactId),
          ),
        );
      }
      if (newMembers.length > 0) {
        const existingContactIds = (
          await db
            .select({ id: jellyTeamContact.id })
            .from(jellyTeamContact)
            .where(
              inArray(
                jellyTeamContact.id,
                newMembers.map((m) => m.id),
              ),
            )
        ).map((c) => c.id);
        const membersWithContacts = newMembers.filter((m) =>
          existingContactIds.includes(m.id),
        );
        if (membersWithContacts.length > 0) {
          await db.insert(jellyMailboxMember).values(
            membersWithContacts.map((member) => ({
              jellyContactId: member.id,
              jellyMailboxId: input.mailboxId,
              jellyTeamId: env.JELLY_TEAM_ID,
            })),
          );
        }
      }
      await call(
        auditRouter.create,
        {
          resource: "mailbox_member",
          action: "resync",
        },
        {
          context,
        },
      );
      return { message: "Resync completed successfully" };
    }),
  createMember: teamAdminProtectedProcedure
    .route({
      method: "POST",
      path: "/mailboxes/{marmaladeMailboxId}/members",
    })
    .input(
      z.object({
        marmaladeMailboxId: z.int().min(1),
        marmaladeMemberId: z.string().min(1),
      }),
    )
    .output(z.object({ message: z.string() }))
    .handler(async ({ input, context }) => {
      const requesterId = context.session.user.id;
      const requesterEmail = context.session.user.email;
      if (!requesterId || !requesterEmail) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "User is not authenticated",
        });
      }
      const mailbox = await db
        .select()
        .from(marmaladeMailbox)
        .where(eq(marmaladeMailbox.id, input.marmaladeMailboxId));
      if (!mailbox || mailbox.length === 0 || !mailbox[0]) {
        throw new ORPCError("NOT_FOUND", {
          message: "Mailbox not found",
        });
      }
      const existingMember = await db
        .select()
        .from(marmaladeMailboxMember)
        .where(
          and(
            eq(marmaladeMailboxMember.marmaladeMailboxId, mailbox[0].id),
            eq(marmaladeMailboxMember.marmaladeUserId, input.marmaladeMemberId),
          ),
        );
      if (existingMember && existingMember.length > 0) {
        throw new ORPCError("CONFLICT", {
          message: "Member already exists in the mailbox",
        });
      }
      const newMember = await db
        .insert(marmaladeMailboxMember)
        .values({
          marmaladeMailboxId: mailbox[0].id,
          marmaladeUserId: input.marmaladeMemberId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .returning({ id: marmaladeMailboxMember.id });
      await call(
        auditRouter.create,
        {
          resource: "mailbox_member",
          action: "create",
          resourceId: newMember[0]?.id.toString() ?? undefined,
        },
        {
          context,
        },
      );
      return { message: "Mailbox member created successfully" };
    }),
  removeMember: teamAdminProtectedProcedure
    .route({
      method: "DELETE",
      path: "/mailboxes/{marmaladeMailboxId}/members/{marmaladeMemberId}",
    })
    .input(
      z.object({
        marmaladeMailboxId: z.int().min(1),
        marmaladeMemberId: z.string().min(1),
      }),
    )
    .output(z.object({ message: z.string() }))
    .handler(async ({ input, context }) => {
      const requesterId = context.session.user.id;
      const requesterEmail = context.session.user.email;
      if (!requesterId || !requesterEmail) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "User is not authenticated",
        });
      }

      const status = await db
        .delete(marmaladeMailboxMember)
        .where(
          and(
            eq(
              marmaladeMailboxMember.marmaladeMailboxId,
              input.marmaladeMailboxId,
            ),
            eq(marmaladeMailboxMember.marmaladeUserId, input.marmaladeMemberId),
          ),
        );
      if (status.rowCount === 0) {
        throw new ORPCError("NOT_FOUND", {
          message: "Mailbox member not found",
        });
      }
      await call(
        auditRouter.create,
        {
          resource: "mailbox_member",
          resourceId: input.marmaladeMemberId,
          action: "delete",
        },
        {
          context,
        },
      );
      return { message: "Mailbox member removed successfully" };
    }),
  deactivate: teamAdminProtectedProcedure
    .route({
      method: "POST",
      path: "/mailboxes/{marmaladeMailboxId}/deactivate",
    })
    .input(z.object({ marmaladeMailboxId: z.int().min(1) }))
    .output(z.object({ message: z.string() }))
    .handler(async ({ input, context }) => {
      const requesterId = context.session.user.id;
      const requesterEmail = context.session.user.email;
      if (!requesterId || !requesterEmail) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "User is not authenticated",
        });
      }

      const result = await db
        .update(marmaladeMailbox)
        .set({ active: false })
        .where(eq(marmaladeMailbox.id, input.marmaladeMailboxId));
      if (result.rowCount === 0) {
        throw new ORPCError("NOT_FOUND", {
          message: "Mailbox not found",
        });
      }

      await call(
        auditRouter.create,
        {
          resource: "mailbox",
          resourceId: input.marmaladeMailboxId.toString() ?? undefined,
          action: "deactivate",
        },
        {
          context,
        },
      );
      return { message: "Mailbox deactivated successfully" };
    }),
  activate: teamAdminProtectedProcedure
    .route({
      method: "POST",
      path: "/mailboxes/{marmaladeMailboxId}/activate",
    })
    .input(z.object({ marmaladeMailboxId: z.int().min(1) }))
    .output(z.object({ message: z.string() }))
    .handler(async ({ input, context }) => {
      const requesterId = context.session.user.id;
      const requesterEmail = context.session.user.email;
      if (!requesterId || !requesterEmail) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "User is not authenticated",
        });
      }
      const result = await db
        .update(marmaladeMailbox)
        .set({ active: true })
        .where(eq(marmaladeMailbox.id, input.marmaladeMailboxId));
      if (result.rowCount === 0) {
        throw new ORPCError("NOT_FOUND", {
          message: "Mailbox not found",
        });
      }

      await call(
        auditRouter.create,
        {
          resource: "mailbox",
          resourceId: input.marmaladeMailboxId.toString() ?? undefined,
          action: "activate",
        },
        {
          context,
        },
      );
      return { message: "Mailbox activated successfully" };
    }),
};
