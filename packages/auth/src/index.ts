import { expo } from "@better-auth/expo";
import { auditRouter } from "@marmalade-v2/api/routers/audit";
import { mailboxRouter } from "@marmalade-v2/api/routers/mailbox";
import { teamRouter } from "@marmalade-v2/api/routers/team";

import { createDb } from "@marmalade-v2/db";
import * as schema from "@marmalade-v2/db/schema/auth";
import { env } from "@marmalade-v2/env/server";
import { call } from "@orpc/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";

export function createAuth() {
  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",

      schema: schema,
    }),
    trustedOrigins: [
      env.CORS_ORIGIN,
      "marmalade-v2://",
      "exp://",
      "http://localhost:8081",
    ],
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    databaseHooks: {
      account: {
        create: {
          after: async (account) => {
            const user = await db.query.user.findFirst({
              where: (user, { eq }) => eq(user.id, account.userId),
            });
            if (user && true) {
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
    plugins: [
      tanstackStartCookies(),
      expo(),
      genericOAuth({
        config: env.HACKCLUB_CLIENT_ID
          ? [
              {
                providerId: "hackclub",
                discoveryUrl:
                  "https://auth.hackclub.com/.well-known/openid-configuration",
                clientId: env.HACKCLUB_CLIENT_ID,
                clientSecret: env.HACKCLUB_CLIENT_SECRET,
                redirectURI: `${env.BETTER_AUTH_URL}/api/auth/oauth2/callback/hackclub`,
                scopes: ["openid", "profile", "email", "verification_status"],
              },
            ]
          : [],
      }),
    ],
  });
}

export const auth = createAuth();
