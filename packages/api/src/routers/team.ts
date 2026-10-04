import { db } from "@marmalade-v2/db";
import { user as authUser } from "@marmalade-v2/db/schema/auth";
import { jellyTeam, jellyTeamContact } from "@marmalade-v2/db/schema/team";
import { env } from "@marmalade-v2/env/server";
import { call, ORPCError } from "@orpc/server";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import z from "zod";
import {
  apiKeyOrSessionOrWebhookProcedure,
  checkRouterScope,
  jellyWebhookProcedure,
  publicProcedure,
} from "..";
import { getJellyClient } from "../lib/jelly";
import { teamMemberSchema, userSchema } from "../schemas/output";
import { auditRouter } from "./audit";

const jelly = getJellyClient();

/**
 * Roles that make someone part of the Jelly team, as opposed to someone the
 * team corresponds with.
 *
 * `jelly_contact` is dual-purpose: `team.resync` fills it from Jelly's
 * `/api/members`, and the webhook also writes a row for every inbound sender
 * with the default role `contact`. Almost everything that says "member"
 * means the former.
 */
export const STAFF_ROLES = ["owner", "admin", "member"] as const;

export const teamRouter = {
  list: apiKeyOrSessionOrWebhookProcedure
    .route({ method: "GET", path: "/members" })
    .input(
      z
        .object({
          /** Also return correspondents, who are not part of the team. */
          includeContacts: z.coerce.boolean().optional(),
        })
        .optional(),
    )
    .output(
      z.array(
        z.object({
          jelly: teamMemberSchema.nullable(),
          marmalade: userSchema.nullable(),
        }),
      ),
    )
    .handler(async ({ context, input }) => {
      checkRouterScope(context, "team");

      // `/members` means team members. Correspondents live in the same table
      // but are not part of the team, and returning several hundred of them
      // from this route buries the people it is about.
      const conditions = [eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID)];
      if (!input?.includeContacts) {
        conditions.push(inArray(jellyTeamContact.role, [...STAFF_ROLES]));
      }

      const results = await db
        .select({
          jelly: jellyTeamContact,
          marmalade: authUser,
        })
        .from(jellyTeamContact)
        .leftJoin(authUser, eq(jellyTeamContact.email, authUser.email))
        .where(and(...conditions));

      return results.map((row) => ({
        jelly: row.jelly ?? null,
        marmalade: row.marmalade ?? null,
      }));
    }),
  get: apiKeyOrSessionOrWebhookProcedure
    .route({ method: "GET", path: "/members/:id" })
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        jelly: teamMemberSchema.nullable(),
        marmalade: userSchema.nullable(),
      }),
    )
    .handler(async ({ context, input }) => {
      checkRouterScope(context, "team");

      const result = await db
        .select({
          jelly: jellyTeamContact,
          marmalade: authUser,
        })
        .from(jellyTeamContact)
        .leftJoin(authUser, eq(jellyTeamContact.email, authUser.email))
        .where(
          and(
            eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID),
            eq(jellyTeamContact.id, input.id),
          ),
        )
        .limit(1);

      if (result.length === 0) {
        throw new ORPCError("NOT_FOUND");
      }

      return {
        jelly: result[0]?.jelly ?? null,
        marmalade: result[0]?.marmalade ?? null,
      };
    }),
  add: jellyWebhookProcedure
    .route({ method: "POST", path: "/members" })
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        email: z.string().email().optional(),
      }),
    )
    .output(
      z.object({
        jelly: teamMemberSchema.nullable(),
        marmalade: userSchema.nullable(),
      }),
    )
    .handler(async ({ context, input }) => {
      checkRouterScope(context, "team");

      const existingMember = await db
        .select()
        .from(jellyTeamContact)
        .where(
          and(
            eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID),
            eq(jellyTeamContact.id, input.id),
          ),
        )
        .limit(1);

      if (existingMember.length > 0) {
        throw new ORPCError("CONFLICT", {
          message: "Team member already exists",
        });
      }

      if (!input.email) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Email must be provided",
        });
      }

      await db.insert(jellyTeamContact).values({
        id: input.id,
        name: input.name ?? null,
        email: input.email ?? null,
        role: "contact",
        active: true,
        jellyTeamId: env.JELLY_TEAM_ID,
        existsInJelly: true,
      });

      const result = await db
        .select({
          jelly: jellyTeamContact,
          marmalade: authUser,
        })
        .from(jellyTeamContact)
        .leftJoin(authUser, eq(jellyTeamContact.email, authUser.email))
        .where(
          and(
            eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID),
            eq(jellyTeamContact.id, input.id),
          ),
        )
        .limit(1);

      return {
        jelly: result[0]?.jelly ?? null,
        marmalade: result[0]?.marmalade ?? null,
      };
    }),
  resync: publicProcedure
    .route({ method: "POST", path: "/resync" })
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
      let teamMembers;
      try {
        teamMembers = await jelly.listMembers();
      } catch {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to fetch team members from Jelly",
        });
      }
      if (!teamMembers || teamMembers.length === 0) {
        throw new ORPCError("NOT_FOUND", {
          message: "No team members found in Jelly",
        });
      }
      const teamMemberIds = teamMembers.map((member) => member.id);
      const existingTeamMembers = await db
        .select()
        .from(jellyTeamContact)
        .where(eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID));
      const existingTeamMemberIds = existingTeamMembers.map(
        (teamMember) => teamMember.id,
      );
      const newTeamMembers = teamMembers.filter(
        (member) => !existingTeamMemberIds.includes(member.id),
      );
      // Only staff can go missing from `/api/members`, because only staff
      // were ever in it. Sweeping every row meant each resync flagged all
      // several hundred webhook-created correspondents as gone from Jelly,
      // which turned `exists_in_jelly` into "is a team member" and made the
      // struck-through styling on /team meaningless.
      const removedTeamMembers = existingTeamMembers.filter(
        (member) =>
          !teamMemberIds.includes(member.id) &&
          (STAFF_ROLES as readonly string[]).includes(member.role),
      );
      const updatedTeamMembers = teamMembers.filter((member) => {
        const existingMember = existingTeamMembers.find(
          (teamMember) => teamMember.id === member.id,
        );
        if (!existingMember) return false;
        return (
          existingMember.name !== member.name ||
          existingMember.email !== member.email ||
          existingMember.role !== member.role ||
          existingMember.active !== member.active ||
          existingMember.existsInJelly !== true
        );
      });
      if (updatedTeamMembers.length > 0) {
        for (const member of updatedTeamMembers) {
          await db
            .update(jellyTeamContact)
            .set({
              name: member.name,
              email: member.email,
              role: member.role,
              active: member.active,
              existsInJelly: true,
            })
            .where(eq(jellyTeamContact.id, member.id))
            .returning({ id: jellyTeamContact.id });
        }
      }
      // Undo the damage the old sweep did. Correspondents were flagged as
      // gone from Jelly on every resync because they were compared against a
      // list they were never in; this clears that, and is a no-op once the
      // data is clean.
      await db
        .update(jellyTeamContact)
        .set({ existsInJelly: true })
        .where(
          and(
            eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID),
            eq(jellyTeamContact.existsInJelly, false),
            notInArray(jellyTeamContact.role, [...STAFF_ROLES]),
          ),
        );

      if (removedTeamMembers.length > 0) {
        await db
          .update(jellyTeamContact)
          .set({ existsInJelly: false })
          .where(
            inArray(
              jellyTeamContact.id,
              removedTeamMembers.map((team) => team.id),
            ),
          );
      }
      if (newTeamMembers.length > 0) {
        await db
          .insert(jellyTeamContact)
          .values(
            newTeamMembers.map((member) => ({
              id: member.id,
              name: member.name,
              email: member.email,
              role: member.role,
              active: member.active,
              jellyTeamId: env.JELLY_TEAM_ID,
              existsInJelly: true,
            })),
          )
          .onConflictDoNothing();
      }
      await call(
        auditRouter.create,
        {
          resource: "team",
          action: "resync",
        },
        {
          context,
        },
      );
      return { message: "Resync completed successfully" };
    }),
};
