import { createAuth } from "@marmalade-v2/auth";
import { auditRouter } from "@marmalade-v2/api/routers/audit";
import { mailboxRouter } from "@marmalade-v2/api/routers/mailbox";
import { teamRouter } from "@marmalade-v2/api/routers/team";
import { createDb } from "@marmalade-v2/db";
import { call } from "@orpc/server";

const db = createDb();

export const auth = createAuth({
  databaseHooks: {
    account: {
      create: {
        after: async (account) => {
          const user = await db.query.user.findFirst({
            where: (user, { eq }) => eq(user.id, account.userId),
          });
          if (user && true) {
            await call(
              teamRouter.resync,
              {},
              {
                path: ["/team"],
                context: {
                  auth: null,
                  session: {
                    user,
                    session: {
                      ...account,
                      expiresAt: new Date(),
                      token: "uwu",
                    },
                  },
                },
              },
            );
            await call(
              mailboxRouter.resync,
              {},
              {
                path: ["/mailboxes"],
                context: {
                  auth: null,
                  session: {
                    user,
                    session: {
                      ...account,
                      expiresAt: new Date(),
                      token: "uwu",
                    },
                  },
                },
              },
            );
            await call(
              auditRouter.create,
              {
                resource: "user",
                action: "create",
                resourceId: user.id,
                status: "success",
                metadata: {
                  email: user.email,
                  name: user.name,
                },
              },
              {
                path: ["/audit"],
                context: {
                  auth: null,
                  session: {
                    user,
                    session: {
                      ...account,
                      expiresAt: new Date(),
                      token: "uwu",
                    },
                  },
                },
              },
            );
          }
        },
      },
    },
  },
});
