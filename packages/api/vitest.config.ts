import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The suite never reaches a real deployment, and the server env module
    // would otherwise refuse to load without a database URL and auth secret.
    env: {
      SKIP_ENV_VALIDATION: "1",
      DATABASE_URL: "postgres://unused",
      BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-to-pass",
      BETTER_AUTH_URL: "http://localhost:3000",
      CORS_ORIGIN: "http://localhost:3001",
      MARMALADE_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
      JELLY_API_URL: "https://jelly.test",
      LOOPS_API_KEY: "unused",
      LOOPS_API_URL: "https://loops.test",
    },
    globalSetup: ["./test/global-setup.ts"],
    // The tests share one PGlite database and seed their own rows, so they
    // must not interleave.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
