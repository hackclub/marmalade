import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";
import { getJellyClient } from './lib/jelly';

export const o = os.$context<Context>();

export const publicProcedure = o;

const jelly = getJellyClient();


const requireAuth = o.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({
    context: {
      session: context.session,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);
export const teamAdminProtectedProcedure = protectedProcedure.use(async ({ context, next }) => {
  const userId = context.session.user.id;
  let role;
  try {
    role = (await jelly.getMember(userId)).role;
    if (role !== 'admin' &&  role !== 'owner') {
      throw new ORPCError("FORBIDDEN");
    }
    return next({
      context: {
        session: context.session,
      },
    });
  } catch (e) {
    throw new ORPCError("FORBIDDEN");
  }
});
