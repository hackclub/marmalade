import { defineConfig } from "drizzle-kit";

/**
 * Schema for tests, pushed into a throwaway PGlite database.
 *
 * `push` rather than `migrate` on purpose: production applies the schema with
 * `db:push`, and the migration files are advisory. Tests that built their
 * tables from the migrations would be checking something the deployment does
 * not do, and would keep passing if push and the files ever disagreed.
 */
export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  driver: "pglite",
  dbCredentials: {
    url: process.env.TEST_DATABASE_DIR ?? "./.test-db",
  },
});
