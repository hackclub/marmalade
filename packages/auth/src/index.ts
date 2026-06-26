import { expo } from "@better-auth/expo";
import { createDb } from "@marmalade-v2/db";
import * as schema from "@marmalade-v2/db/schema/auth";
import { env } from "@marmalade-v2/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";

export function createAuth() {
  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",

      schema: schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN, "marmalade-v2://", "exp://", "http://localhost:8081"],
    emailAndPassword: {
      enabled: true,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    plugins: [tanstackStartCookies(), expo()],
  });
}

export const auth = createAuth();
