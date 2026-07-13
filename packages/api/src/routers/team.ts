import { db } from "@marmalade-v2/db";
import { user as authUser } from "@marmalade-v2/db/schema/auth";
import { jellyTeam, jellyTeamContact } from "@marmalade-v2/db/schema/team";
import { env } from "@marmalade-v2/env/server";
import { call, ORPCError } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { protectedProcedure, publicProcedure } from "..";
import { getJellyClient } from "../lib/jelly";
import { auditRouter } from "./audit";

const jelly = getJellyClient();

export const teamRouter = {
  list: protectedProcedure
    .route({ method: "GET", path: "/team/{teamId}/members" })
    .handler(async () => {
    const results = await db
      .select({
        jelly: jellyTeamContact,
        marmalade: authUser,
      })
      .from(jellyTeamContact)
      .leftJoin(authUser, eq(jellyTeamContact.email, authUser.email))
      .where(eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID));

    return results.map((row) => ({
      jelly: row.jelly ?? null,
      marmalade: row.marmalade ?? null,
    }));
  }),
  resync: publicProcedure
    .route({ method: "POST", path: "/team/{teamId}/resync" })
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
      console.log("Fetched team members from Jelly:", teamMembers);
    } catch (e) {
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
    console.log("Team member IDs from Jelly:", teamMemberIds);
    const existingTeamMembers = await db
      .select()
      .from(jellyTeamContact)
      .where(eq(jellyTeamContact.jellyTeamId, env.JELLY_TEAM_ID));
    console.log('existingTeamMembers', existingTeamMembers)

    const existingTeamMemberIds = existingTeamMembers.map(
      (teamMember) => teamMember.id,
    );
    const newTeamMembers = teamMembers.filter(
      (member) => !existingTeamMemberIds.includes(member.id),
    );
    console.log('existingTeamMembers', existingTeamMembers)
    const removedTeamMembers = existingTeamMembers.filter(
      (member) => !teamMemberIds.includes(member.id),
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
    if (removedTeamMembers.length > 0) {
      console.log('removed team members')
      await db
        .update(jellyTeamContact)
        .set({ existsInJelly: false })
        .where(
          inArray(
            jellyTeamContact.jellyTeamId,
            removedTeamMembers.map((team) => team.jellyTeamId),
          ),
        );
    }
    if (newTeamMembers.length > 0) {
      await db.insert(jellyTeamContact).values(
        newTeamMembers.map((member) => ({
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role,
          active: member.active,
          jellyTeamId: env.JELLY_TEAM_ID,
          existsInJelly: true,
        })),
      );
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
