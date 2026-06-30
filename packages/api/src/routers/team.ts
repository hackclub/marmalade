import { call, ORPCError } from "@orpc/server";
import { protectedProcedure, publicProcedure } from "..";
import { jellyTeamMember } from "@marmalade-v2/db/schema/team";
import { db } from "@marmalade-v2/db";
import { user as authUser } from "@marmalade-v2/db/schema/auth";
import { getJellyClient } from '../lib/jelly';
import {inArray, eq} from "drizzle-orm";
import { auditRouter } from "./audit";
import { env } from "@marmalade-v2/env/server";

const jelly = getJellyClient();

export const teamRouter = {
    list: protectedProcedure.handler(async () => {
        const results = await db
          .select({
            jelly: jellyTeamMember,
            marmalade: authUser,
          })
          .from(jellyTeamMember)
          .leftJoin(authUser, eq(jellyTeamMember.email, authUser.email))
          .where(eq(jellyTeamMember.jellyTeamId, env.JELLY_TEAM_ID));

        return results.map((row) => ({
          jelly: row.jelly ?? null,
          marmalade: row.marmalade ?? null,
        }));
    }),
     resync: publicProcedure.handler(async ({ context }) => {
          let teamMembers;
          try {
            teamMembers = await jelly.listMembers()
            console.log('teamMembers', teamMembers)
          }        catch (e) {
              throw new ORPCError("INTERNAL_SERVER_ERROR", {
                message: "Failed to fetch team members from Jelly",
              })
            }
            if (!teamMembers || teamMembers.length === 0) {
              throw new ORPCError("NOT_FOUND", {
                message: "No team members found in Jelly",
              })
            }
            const teamMemberIds = teamMembers.map(member => member.id);
            console.log('TEAM ID', env.JELLY_TEAM_ID)
            const existingTeamMembers = await db.select().from(jellyTeamMember).where(eq(jellyTeamMember.jellyTeamId, env.JELLY_TEAM_ID));
                      console.log('existingTeamMembers', existingTeamMembers)

            const existingTeamMemberIds = existingTeamMembers.map(teamMember => teamMember.id);
            console.log('existingTeamMemberIds', existingTeamMemberIds)
            const newTeamMembers = teamMembers.filter(member => !existingTeamMemberIds.includes(member.id));
            console.log('newTeamMembers', newTeamMembers)
            const removedTeamMembers = existingTeamMembers.filter(team => !teamMemberIds.includes(team.jellyTeamId));
            const updatedTeamMembers = teamMembers.filter(member => {
              const existingMember = existingTeamMembers.find(teamMember => teamMember.id === member.id);
              console.log('existingMember', existingMember)
              if (!existingMember) return false;
              return (
                existingMember.name !== member.name ||
                existingMember.email !== member.email ||
                existingMember.role !== member.role ||
                existingMember.active !== member.active
              );
            });
            console.log('updatedTeamMembers', updatedTeamMembers)
            if (updatedTeamMembers.length > 0) {
              console.log('updatedTeamMembers', updatedTeamMembers)
              for (const member of updatedTeamMembers) {
                console.log(await db.update(jellyTeamMember).set({
                  name: member.name,
                  email: member.email,
                  role: member.role,
                  active: member.active,
                  existsInJelly: true
                }).where(eq(jellyTeamMember.id, member.id)).returning({ id: jellyTeamMember.id }));
              }
            }
            if (removedTeamMembers.length > 0) {
              await db.update(jellyTeamMember).set({ existsInJelly: false }).where(inArray(jellyTeamMember.jellyTeamId, removedTeamMembers.map(team => team.jellyTeamId)));
            }
            if (newTeamMembers.length > 0) {
              await db.insert(jellyTeamMember).values(newTeamMembers.map(member => ({
                id: member.id,
                name: member.name,
                email: member.email,
                role: member.role,
                active: member.active,
                jellyTeamId: env.JELLY_TEAM_ID,
                existsInJelly: true
              })));
            }
          await call(auditRouter.create, {
            resource: "team",
            action: "resync",
          }, {
            context,
          })
          return { message: "Resync completed successfully" };
        }),
}
