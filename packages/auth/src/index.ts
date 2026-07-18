import { expo } from "@better-auth/expo";
import { createDb } from "@marmalade-v2/db";
import * as schema from "@marmalade-v2/db/schema/auth";
import { env } from "@marmalade-v2/env/server";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, genericOAuth } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import nodemailer from "nodemailer";

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
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    secure: true,
    port: 465,
    auth: {
      user: env.EMAIL_USER,
      pass: env.EMAIL_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
  const mailOptions = {
    from: env.EMAIL_USER,
    to: email,
    subject: "Marmalade One Time Password",
    html: `<div><p>*sigh* i guess you're really serious about making my life harder, so here's your one-time code vro: </p> <h1>${otp}</h1>
    <i>PS: in case it wasn't clear, i'd appreciate if you considered switching your HCA over to this address since i don't want to deal with sending email OTPs or maintaining two different authentication methods, kthxbye</i></div>`,
  };
  try {
    await transporter.sendMail(mailOptions);
  } finally {
    transporter.close();
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
      emailOTP({
        async sendVerificationOTP({ email, otp, type }) {
          await sendEmailVerificationOTP({ email, otp });
        },
      }),
    ],
  });
}

export const auth = createAuth();
