import { auditRouter } from "@marm/api/routers/audit";
import { mailboxRouter } from "@marm/api/routers/mailbox";
import { teamRouter } from "@marm/api/routers/team";
import { createAuth } from "@marm/auth";
import { createDb } from "@marm/db";
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
