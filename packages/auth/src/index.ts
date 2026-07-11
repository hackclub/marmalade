import { expo } from "@better-auth/expo";
import { createDb } from "@marmalade-v2/db";
import * as schema from "@marmalade-v2/db/schema/auth";
import { env } from "@marmalade-v2/env/server";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";

export type AuthOptions = {
  databaseHooks?: BetterAuthOptions["databaseHooks"];
};

export function createAuth(options?: AuthOptions) {
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
    databaseHooks: options?.databaseHooks,
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
