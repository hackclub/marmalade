import { db } from "@marmalade-v2/db";
import {
  jellyMailbox,
  jellyMailboxMember,
  marmaladeMailbox,
  marmaladeMailboxMember,
} from "@marmalade-v2/db/schema/mailbox";
import { jellyTeamMember } from "@marmalade-v2/db/schema/team";
import { call } from "@orpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getJellyClient } from "../lib/jelly";

import { env } from "@marmalade-v2/env/server";
import { ORPCError } from "@orpc/client";
import z from "zod";
import {
  protectedProcedure,
  publicProcedure,
  teamAdminProtectedProcedure,
} from "../index";
import { auditRouter } from "./audit";

const jelly = getJellyClient();

const jellyMailboxMemberCounts = db
  .select({
    jellyMailboxId: jellyMailboxMember.jellyMailboxId,
    jellyMailboxMemberCount: sql<number>`count(*)`
      .mapWith(Number)
      .as("jellyMailboxMemberCount"),
  })
  .from(jellyMailboxMember)
  .groupBy(jellyMailboxMember.jellyMailboxId)
  .as("jelly_mailbox_member_counts");

const marmaladeMailboxMemberCounts = db
  .select({
    marmaladeMailboxId: marmaladeMailboxMember.marmaladeMailboxId,
    marmaladeMailboxMemberCount: sql<number>`count(*)`
      .mapWith(Number)
      .as("marmaladeMailboxMemberCount"),
  })
  .from(marmaladeMailboxMember)
  .groupBy(marmaladeMailboxMember.marmaladeMailboxId)
  .as("marmalade_mailbox_member_counts");

export const mailboxRouter = {
  list: protectedProcedure.handler(async ({ context }) => {
    const requesterId = context.session.user.id;
    const requesterEmail = context.session.user.email;
    if (!requesterId || !requesterEmail) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "User is not authenticated",
      });
    }
    const results =
      (await db
        .select({
          jellyMailbox: jellyMailbox,
          jellyMailboxMemberCount: sql<number>`coalesce(${jellyMailboxMemberCounts.jellyMailboxMemberCount}, 0)`.mapWith(
            Number,
          ),
          marmaladeMailbox: marmaladeMailbox,
          marmaladeMailboxMemberCount: sql<number>`coalesce(${marmaladeMailboxMemberCounts.marmaladeMailboxMemberCount}, 0)`.mapWith(
            Number,
          ),
          marmaladeMailboxMembership: marmaladeMailboxMember,
        })
        .from(jellyMailbox)
        .innerJoin(
          jellyMailboxMember,
          eq(jellyMailbox.jellyMailboxId, jellyMailboxMember.jellyMailboxId),
        )
        .innerJoin(
          jellyTeamMember,
          and(
            eq(jellyMailboxMember.jellyMemberId, jellyTeamMember.id),
            eq(jellyMailboxMember.jellyTeamId, jellyTeamMember.jellyTeamId),
            eq(jellyTeamMember.email, requesterEmail),
          ),
        )
        .innerJoin(
          jellyMailboxMemberCounts,
          eq(
            jellyMailbox.jellyMailboxId,
            jellyMailboxMemberCounts.jellyMailboxId,
          ),
        )
        .leftJoin(
          marmaladeMailbox,
          eq(jellyMailbox.jellyMailboxId, marmaladeMailbox.jellyMailboxId),
        )
        .leftJoin(
          marmaladeMailboxMemberCounts,
          eq(
            marmaladeMailbox.id,
            marmaladeMailboxMemberCounts.marmaladeMailboxId,
          ),
        )
        .leftJoin(
          marmaladeMailboxMember,
          and(
            eq(marmaladeMailbox.id, marmaladeMailboxMember.marmaladeMailboxId),
            eq(marmaladeMailboxMember.marmaladeUserId, requesterId),
          ),
        )) || [];
    return results.map((result) => ({
      jellyMailbox: {
            ...result.jellyMailbox,
            memberCount: result.jellyMailboxMemberCount,
          },
      marmaladeMailbox: result.marmaladeMailbox
        ? {
            ...result.marmaladeMailbox,
            memberCount: result.marmaladeMailboxMemberCount,
          }
        : null,
      marmaladeMailboxMembership: result.marmaladeMailboxMembership,
    }));
  }),
  create: teamAdminProtectedProcedure
    .input(z.object({ jellyMailboxId: z.string().min(1) }))
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
          active: true,
        })
        .returning({ id: marmaladeMailbox.id });
      await call(
        auditRouter.create,
        {
          resource: "mailbox",
          action: "create",
          resourceId: newMailbox[0]?.id ?? -1,
        },
        {
          context,
        },
      );
      return { message: "Mailbox created successfully" };
    }),
  resync: publicProcedure.handler(async ({ context }) => {
    let mailboxes;
    try {
      mailboxes = await jelly.listMailboxes();
      console.log("mailboxes", mailboxes);
    } catch (e) {
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
    console.log("existingMailboxIds", existingMailboxIds);
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
          approvedBy: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isDefault: false,
        })),
      );
    }
    for (const mailbox of mailboxes) {
      call(
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
    .input(
      z.object({
        mailboxId: z.string().min(1),
      }),
    )
    .handler(async ({ input, context }) => {
      let mailboxMembers;
      try {
        mailboxMembers = await jelly.listMailboxMembers(input.mailboxId);
        console.log("mailboxMembers", mailboxMembers);
      } catch (e) {
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
        .where(inArray(jellyMailboxMember.jellyMemberId, memberIds));
      const existingMemberIds = existingMembers.map(
        (member) => member.jellyMemberId,
      );
      console.log("existingMemberIds", existingMemberIds);
      const newMembers = mailboxMembers.filter(
        (member) => !existingMemberIds.includes(member.id),
      );
      const removedMembers = existingMembers.filter(
        (member) => !memberIds.includes(member.jellyMemberId),
      );
      if (removedMembers.length > 0) {
        await db.delete(jellyMailboxMember).where(
          inArray(
            jellyMailboxMember.jellyMemberId,
            removedMembers.map((member) => member.jellyMemberId),
          ),
        );
      }
      if (newMembers.length > 0) {
        await db.insert(jellyMailboxMember).values(
          newMembers.map((member) => ({
            jellyMemberId: member.id,
            jellyMailboxId: input.mailboxId,
            jellyTeamId: env.JELLY_TEAM_ID,
          })),
        );
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
};
