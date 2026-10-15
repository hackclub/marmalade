import { createEnv } from "@t3-oss/env-core";
import "dotenv/config";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    HACKCLUB_CLIENT_ID: z.string().min(1).optional(),
    HACKCLUB_CLIENT_SECRET: z.string().min(1).optional(),
    /**
     * AES-256-GCM key protecting third-party credentials at rest.
     * Generate with `openssl rand -base64 32`.
     *
     * Required: a missing key should stop the process at boot rather than let
     * it fall back to storing Jelly tokens in plaintext.
     */
    MARMALADE_ENCRYPTION_KEY: z.string().min(32),
    /**
     * Bootstrap only. On first use the token is encrypted into
     * `jelly_team.api_token_encrypted` and this variable can be removed.
     */
    JELLY_API_KEY: z.string().min(1).optional(),
    JELLY_API_URL: z.string().min(1),
    /**
     * Bootstrap and single-team compatibility only.
     *
     * The team a request acts on is resolved at the context boundary: from the
     * API key row, from the webhook endpoint's slug, or from the web app's
     * active-team header. This variable is the fallback for a deployment that
     * has not been told which team to use, and for the legacy webhook endpoint
     * that carries no slug. Optional so a multi-team deployment can leave it
     * unset — once it is unset, nothing can silently default to one tenant.
     */
    JELLY_TEAM_ID: z.string().min(1).optional(),
    /** Bootstrap only, as above, for `jelly_team.webhook_secret_encrypted`. */
    JELLY_WEBHOOK_SECRET: z.string().min(1).optional(),
    WEBHOOK_PASSWORD: z.string().min(1).optional(),
    WEBHOOK_USERNAME: z.string().min(1).optional(),
    /**
     * Comma-separated Better Auth user ids that are always instance admins,
     * whatever `user.role` says. Break-glass only — day-to-day promotion
     * happens through the admin UI.
     */
    BETTER_AUTH_ADMIN_USER_IDS: z.string().optional(),
    CRON_SECRET: z.string().min(16).optional(),
    LOOPS_API_KEY: z.string().min(1),
    LOOPS_API_URL: z.string().min(1),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
