import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    HACKCLUB_CLIENT_ID: z.string().min(1).optional(),
    HACKCLUB_CLIENT_SECRET: z.string().min(1).optional(),
    JELLY_API_KEY: z.string().min(1),
    JELLY_API_URL: z.string().min(1),
    JELLY_TEAM_ID: z.string().min(1),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
