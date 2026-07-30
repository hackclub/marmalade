import { expo } from "@better-auth/expo";
import { createDb } from "@marm/db";
import * as schema from "@marm/db/schema/auth";
import { env } from "@marm/env/server";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, genericOAuth } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";

export type AuthOptions = {
  databaseHooks?: BetterAuthOptions["databaseHooks"];
};

async function sendEmailVerificationOTP({
  email,
  otp,
}: {
  email: string;
  otp: string;
}) {
  const res = await fetch(env.LOOPS_API_URL + "/api/v1/transactional", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LOOPS_API_KEY}`,
    },
    body: JSON.stringify({
      transactionalId: "cmrv63typ01ma0j03qecudz35",
      email,
      dataVariables: { otp },
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to send OTP email: ${res.status} ${await res.text()}`);
  }
}

export function createAuth(options?: AuthOptions) {
  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",

      schema: schema,
    }),
    trustedOrigins: [
      env.CORS_ORIGIN,
      "marm://",
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
      emailOTP({
        async sendVerificationOTP({ email, otp, type }) {
          await sendEmailVerificationOTP({ email, otp });
        },
      }),
    ],
  });
}

export const auth = createAuth();
