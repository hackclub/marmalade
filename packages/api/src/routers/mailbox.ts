import { db } from "@marmalade-v2/db";
import { apiKey, apiKeyScope } from "@marmalade-v2/db/schema/api";
import { user as authUser } from "@marmalade-v2/db/schema/auth";
import {
  jellyMailbox,
  jellyMailboxMember,
  marmaladeMailbox,
  marmaladeMailboxMember,
} from "@marmalade-v2/db/schema/mailbox";
import { jellyTeam, jellyTeamContact } from "@marmalade-v2/db/schema/team";
import { call } from "@orpc/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { aliasedTable } from "drizzle-orm/alias";
import { getJellyClient } from "../lib/jelly";

import { ORPCError } from "@orpc/client";
import z from "zod";
import {
  checkRouterScope,
  filterFieldsByScope,
  mailboxScopedProcedure,
  requireMailboxAccess,
  sessionOrInternalProcedure,
  teamAdminProtectedProcedure,
  teamIdOf,
  teamIdOrDefault,
  teamMemberProtectedProcedure,
} from "../index";
import { canAdministerTeam } from "../lib/roles";
import { backfillTeamIds, ensureTeamSlug } from "../lib/team";
import { mailboxListItemSchema } from "../schemas/output";
import { auditRouter } from "./audit";

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
      checkRouterScope(context, "mailbox");
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
          .where(
            and(
              eq(jellyMailbox.jellyMailboxId, input.jellyMailboxId),
              eq(jellyMailbox.jellyTeamId, teamIdOf(context)),
            ),
          )
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
        .where(
          and(
            eq(marmaladeMailbox.jellyMailboxId, input.jellyMailboxId),
            eq(marmaladeMailbox.jellyTeamId, teamIdOf(context)),
          ),
        )
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
      checkRouterScope(context, "mailbox");

      if ("apiKey" in context) {
        const hasTeamScope =
          "apiKey" in context && context.apiKey.resourceScopes.includes("team");

        if (hasTeamScope) {
          const results = ((await db
            .select({
              jellyMailbox: jellyMailbox,
              jellyMailboxMemberTeamMember: jellyMailboxMemberTeamMember,
              jellyMailboxMemberUser: jellyMailboxMemberUser,
              marmaladeMailbox: marmaladeMailbox,
              marmaladeMailboxMemberUser: marmaladeMailboxMemberUser,
              marmaladeMailboxMemberTeamMember:
                marmaladeMailboxMemberTeamMember,
            })
            .from(jellyMailbox)
            .innerJoin(
              marmaladeMailbox,
              and(
                eq(
                  jellyMailbox.jellyMailboxId,
                  marmaladeMailbox.jellyMailboxId,
                ),
                eq(jellyMailbox.jellyTeamId, marmaladeMailbox.jellyTeamId),
              ),
            )
            .where(
              and(
                eq(jellyMailbox.jellyTeamId, teamIdOf(context)),
                inArray(jellyMailbox.jellyMailboxId, context.allowedMailboxIds),
              ),
            )
            .leftJoin(
              jellyMailboxMembersAll,
              and(
                eq(
                  jellyMailbox.jellyMailboxId,
                  jellyMailboxMembersAll.jellyMailboxId,
                ),
                eq(
                  jellyMailbox.jellyTeamId,
                  jellyMailboxMembersAll.jellyTeamId,
                ),
              ),
            )
            .leftJoin(
              jellyMailboxMemberTeamMember,
              eq(
                jellyMailboxMembersAll.jellyContactId,
                jellyMailboxMemberTeamMember.id,
              ),
            )
            .leftJoin(
              jellyMailboxMemberUser,
              eq(
                jellyMailboxMemberTeamMember.email,
                jellyMailboxMemberUser.email,
              ),
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
              ),
            )) ?? []) as any[];

          const mailboxById = new Map<number, any>();

          for (const result of results) {
            const mailboxId = result.jellyMailbox.id;
            let entry = mailboxById.get(mailboxId);

            if (!entry) {
              const jellyMembers: MailboxMemberItem[] = [];
              const marmaladeMembers: MailboxMemberItem[] = [];
              entry = {
                jellyMailbox: {
                  ...filterFieldsByScope(
                    context,
                    "mailbox",
                    result.jellyMailbox,
                  ),
                  memberCount: 0,
                  members: jellyMembers,
                },
                marmaladeMailbox: {
                  ...filterFieldsByScope(
                    context,
                    "mailbox",
                    result.marmaladeMailbox,
                  ),
                  memberCount: 0,
                  members: marmaladeMembers,
                },
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
              entry.jellyMailbox.memberCount =
                entry.jellyMailbox.members.length;
            }

            if (
              result.marmaladeMailboxMemberTeamMember &&
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
          }

          return Array.from(mailboxById.values()).map((entry) => ({
            jellyMailbox: entry.jellyMailbox,
            marmaladeMailbox: entry.marmaladeMailbox,
            marmaladeMailboxMembership: null,
          }));
        }

        const mailboxes = await db
          .select({
            jelly_mailbox: jellyMailbox,
            mailbox: marmaladeMailbox,
            jellyMemberCount: sql<number>`coalesce((
              select count(*)::int from ${jellyMailboxMember}
              where ${jellyMailboxMember.jellyMailboxId} = ${jellyMailbox.jellyMailboxId}
            ), 0)`,
            marmaladeMemberCount: sql<number>`coalesce((
              select count(*)::int from ${marmaladeMailboxMember}
              where ${marmaladeMailboxMember.marmaladeMailboxId} = ${marmaladeMailbox.id}
            ), 0)`,
          })
          .from(jellyMailbox)
          .innerJoin(
            marmaladeMailbox,
            and(
              eq(jellyMailbox.jellyMailboxId, marmaladeMailbox.jellyMailboxId),
              eq(jellyMailbox.jellyTeamId, marmaladeMailbox.jellyTeamId),
            ),
          )
          .where(
            and(
              eq(jellyMailbox.jellyTeamId, teamIdOf(context)),
              inArray(jellyMailbox.jellyMailboxId, context.allowedMailboxIds),
            ),
          );

        return mailboxes.map((row) => ({
          jellyMailbox: {
            ...filterFieldsByScope(context, "mailbox", row.jelly_mailbox),
            memberCount: row.jellyMemberCount,
            members: [],
          },
          marmaladeMailbox: {
            ...filterFieldsByScope(context, "mailbox", row.mailbox),
            memberCount: row.marmaladeMemberCount,
            members: [],
          },
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

      // Everyone else's list is built from the mailboxes they are a Jelly
      // member of, which is right for a member and wrong for an admin: it
      // hides every mailbox nobody has joined, including all of them in a
      // team that has just been connected. The admin cannot then register
      // one, because the control to do that lives on the row that is not
      // shown. Admins get the team's mailboxes instead, registered or not.
      if (canAdministerTeam(context.role)) {
        const teamId = teamIdOf(context);

        const rows = await db
          .select({ jelly_mailbox: jellyMailbox, mailbox: marmaladeMailbox })
          .from(jellyMailbox)
          // Left, not inner: an unregistered mailbox is exactly the one an
          // admin needs to see.
          .leftJoin(
            marmaladeMailbox,
            and(
              eq(jellyMailbox.jellyMailboxId, marmaladeMailbox.jellyMailboxId),
              eq(jellyMailbox.jellyTeamId, marmaladeMailbox.jellyTeamId),
            ),
          )
          .where(eq(jellyMailbox.jellyTeamId, teamId));

        // Members are fetched, not counted with a subquery. Counting alone
        // produced a card headed "Jelly Mailbox Members (29)" above an empty
        // list, because the heading came from the count and the list from an
        // array that was never filled. Both now derive from the same rows,
        // so they cannot disagree.
        const jellyMembers = await db
          .select({
            jellyMailboxId: jellyMailboxMember.jellyMailboxId,
            contact: jellyTeamContact,
            marmalade: authUser,
          })
          .from(jellyMailboxMember)
          .innerJoin(
            jellyTeamContact,
            and(
              eq(jellyMailboxMember.jellyContactId, jellyTeamContact.id),
              eq(jellyTeamContact.jellyTeamId, teamId),
            ),
          )
          .leftJoin(authUser, eq(jellyTeamContact.email, authUser.email))
          .where(eq(jellyMailboxMember.jellyTeamId, teamId));

        const marmaladeMembers = await db
          .select({
            marmaladeMailboxId: marmaladeMailboxMember.marmaladeMailboxId,
            marmalade: authUser,
            contact: jellyTeamContact,
          })
          .from(marmaladeMailboxMember)
          .innerJoin(
            marmaladeMailbox,
            and(
              eq(
                marmaladeMailboxMember.marmaladeMailboxId,
                marmaladeMailbox.id,
              ),
              eq(marmaladeMailbox.jellyTeamId, teamId),
            ),
          )
          .innerJoin(
            authUser,
            eq(marmaladeMailboxMember.marmaladeUserId, authUser.id),
          )
          .leftJoin(
            jellyTeamContact,
            and(
              eq(jellyTeamContact.email, authUser.email),
              eq(jellyTeamContact.jellyTeamId, teamId),
            ),
          );

        return rows.map((row) => {
          const jelly = jellyMembers
            .filter(
              (member) =>
                member.jellyMailboxId === row.jelly_mailbox.jellyMailboxId,
            )
            .map((member) => ({
              jelly: member.contact,
              marmalade: member.marmalade,
            }));

          const granted = row.mailbox
            ? marmaladeMembers
                .filter(
                  (member) => member.marmaladeMailboxId === row.mailbox!.id,
                )
                .map((member) => ({
                  jelly: member.contact,
                  marmalade: member.marmalade,
                }))
            : [];

          return {
            jellyMailbox: {
              ...filterFieldsByScope(context, "mailbox", row.jelly_mailbox),
              memberCount: jelly.length,
              members: jelly,
            },
            marmaladeMailbox: row.mailbox
              ? {
                  ...filterFieldsByScope(context, "mailbox", row.mailbox),
                  memberCount: granted.length,
                  members: granted,
                }
              : null,
            marmaladeMailboxMembership: null,
          };
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
          and(
            eq(jellyMailbox.jellyMailboxId, jellyMailboxMember.jellyMailboxId),
            eq(jellyMailbox.jellyTeamId, jellyMailboxMember.jellyTeamId),
          ),
        )
        .innerJoin(
          jellyTeamContact,
          and(
            eq(jellyMailboxMember.jellyContactId, jellyTeamContact.id),
            eq(jellyTeamContact.jellyTeamId, teamIdOf(context)),
            eq(jellyTeamContact.email, requesterEmail),
          ),
        )
        .leftJoin(
          jellyMailboxMembersAll,
          and(
            eq(
              jellyMailbox.jellyMailboxId,
              jellyMailboxMembersAll.jellyMailboxId,
            ),
            eq(jellyMailbox.jellyTeamId, jellyMailboxMembersAll.jellyTeamId),
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
          and(
            eq(jellyMailbox.jellyMailboxId, marmaladeMailbox.jellyMailboxId),
            eq(jellyMailbox.jellyTeamId, marmaladeMailbox.jellyTeamId),
          ),
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
        .where(
          and(
            eq(jellyMailbox.jellyMailboxId, input.jellyMailboxId),
            eq(jellyMailbox.jellyTeamId, teamIdOf(context)),
          ),
        );
      // `db.select()` resolves to an array, so the previous `!mailbox` check
      // was always false and a Marmalade mailbox could be created for a Jelly
      // mailbox that does not exist.
      if (mailbox.length === 0) {
        throw new ORPCError("NOT_FOUND", {
          message: "Mailbox not found",
        });
      }

      // Nothing stopped this handler creating a second row for the same Jelly
      // mailbox, which is how the duplicates this branch adds a constraint for
      // came about. Answer clearly rather than letting the constraint surface
      // as a raw database error.
      const existing = await db
        .select({ id: marmaladeMailbox.id })
        .from(marmaladeMailbox)
        .where(
          and(
            eq(marmaladeMailbox.jellyMailboxId, input.jellyMailboxId),
            eq(marmaladeMailbox.jellyTeamId, teamIdOf(context)),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        throw new ORPCError("CONFLICT", {
          message: "This mailbox is already managed by Marmalade",
        });
      }

      const newMailbox = await db
        .insert(marmaladeMailbox)
        .values({
          jellyMailboxId: input.jellyMailboxId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          jellyTeamId: teamIdOf(context),
          active: true,
        })
        .onConflictDoNothing()
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
  resync: sessionOrInternalProcedure
    .route({ method: "POST", path: "/mailboxes/resync" })
    .output(z.object({ message: z.string() }))
    .handler(async ({ context }) => {
      const teamId = await teamIdOrDefault(context);

      const existingTeam = await db
        .select()
        .from(jellyTeam)
        .where(eq(jellyTeam.id, teamId))
        .limit(1);
      if (existingTeam.length === 0) {
        await db.insert(jellyTeam).values({ id: teamId }).onConflictDoNothing();
      }

      // Same self-repair as `team.resync`: `db:push` applies columns and
      // never runs a data step, so the backfill has to live in code that
      // actually executes. Both calls are no-ops once they have taken effect.
      await ensureTeamSlug(teamId);
      await backfillTeamIds(teamId);

      let mailboxes;
      try {
        const jelly = await getJellyClient(teamId);
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
        .where(
          and(
            eq(jellyMailbox.jellyTeamId, teamId),
            inArray(jellyMailbox.jellyMailboxId, mailboxIds),
          ),
        );
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
            and(
              eq(jellyMailbox.jellyTeamId, teamId),
              inArray(
                jellyMailbox.jellyMailboxId,
                removedMailboxes.map((mailbox) => mailbox.jellyMailboxId),
              ),
            ),
          );
      }
      if (newMailboxes.length > 0) {
        await db.insert(jellyMailbox).values(
          newMailboxes.map((mailbox) => ({
            jellyMailboxId: mailbox.id,
            name: mailbox.name,
            jellyTeamId: teamId,
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
  resyncMembers: teamMemberProtectedProcedure
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
      const teamId = teamIdOf(context);

      let mailboxMembers;
      try {
        const jelly = await getJellyClient(teamId);
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
        .where(
          and(
            inArray(jellyMailboxMember.jellyContactId, memberIds),
            eq(jellyMailboxMember.jellyMailboxId, input.mailboxId),
          ),
        );
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
              and(
                eq(jellyTeamContact.jellyTeamId, teamId),
                inArray(
                  jellyTeamContact.id,
                  newMembers.map((m) => m.id),
                ),
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
              jellyTeamId: teamId,
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
        .where(
          and(
            eq(marmaladeMailbox.id, input.marmaladeMailboxId),
            // `marmalade_mailbox_id` is a surrogate key, so it names a
            // mailbox without saying whose. Without the team, an admin of one
            // team could act on another team's mailbox by passing its id.
            eq(marmaladeMailbox.jellyTeamId, teamIdOf(context)),
          ),
        );
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
          // Set on the write, not left for the backfill. A grant made
          // between deploy and the next resync would otherwise sit with a
          // null team.
          jellyTeamId: teamIdOf(context),
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

      const [targetMailbox] = await db
        .select({ jellyMailboxId: marmaladeMailbox.jellyMailboxId })
        .from(marmaladeMailbox)
        .where(
          and(
            eq(marmaladeMailbox.id, input.marmaladeMailboxId),
            eq(marmaladeMailbox.jellyTeamId, teamIdOf(context)),
          ),
        )
        .limit(1);
      if (!targetMailbox) {
        throw new ORPCError("NOT_FOUND", { message: "Mailbox not found" });
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

      // Rescinding has to reach the keys this person already minted for the
      // mailbox. Otherwise it only removes them from the UI while their
      // existing credentials keep working, which is the same gap that made
      // the grant table decorative in the first place.
      //
      // Only their own keys: an admin's key scoped to the same mailbox is not
      // this person's access to lose.
      let scopesRemoved = 0;
      const keysRevoked: number[] = [];

      if (targetMailbox) {
        const removed = await db
          .delete(apiKeyScope)
          .where(
            and(
              eq(apiKeyScope.scopeResourceType, "mailbox"),
              eq(apiKeyScope.scopeResourceId, targetMailbox.jellyMailboxId),
              inArray(
                apiKeyScope.apiKeyId,
                db
                  .select({ id: apiKey.id })
                  .from(apiKey)
                  .where(
                    and(
                      eq(apiKey.createdBy, input.marmaladeMemberId),
                      eq(apiKey.jellyTeamId, teamIdOf(context)),
                    ),
                  ),
              ),
            ),
          )
          .returning({ apiKeyId: apiKeyScope.apiKeyId });
        scopesRemoved = removed.length;

        // A key that has lost its last mailbox scope can no longer reach
        // anything. Leaving it active is a live credential that looks valid
        // and authorises nothing; revoke it so it reads as revoked.
        for (const keyId of new Set(removed.map((r) => r.apiKeyId))) {
          const remaining = await db
            .select({ id: apiKeyScope.id })
            .from(apiKeyScope)
            .where(
              and(
                eq(apiKeyScope.apiKeyId, keyId),
                eq(apiKeyScope.scopeResourceType, "mailbox"),
              ),
            )
            .limit(1);

          if (remaining.length === 0) {
            await db
              .update(apiKey)
              .set({ revokedAt: new Date(), active: false })
              .where(and(eq(apiKey.id, keyId), isNull(apiKey.revokedAt)));
            keysRevoked.push(keyId);
          }
        }
      }
      await call(
        auditRouter.create,
        {
          resource: "mailbox_member",
          resourceId: input.marmaladeMemberId,
          action: "delete",
          metadata: {
            jellyMailboxId: targetMailbox?.jellyMailboxId ?? null,
            apiKeyScopesRemoved: scopesRemoved,
            apiKeysRevoked: keysRevoked,
          },
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
        .where(
          and(
            eq(marmaladeMailbox.id, input.marmaladeMailboxId),
            eq(marmaladeMailbox.jellyTeamId, teamIdOf(context)),
          ),
        );
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
        .where(
          and(
            eq(marmaladeMailbox.id, input.marmaladeMailboxId),
            eq(marmaladeMailbox.jellyTeamId, teamIdOf(context)),
          ),
        );
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
