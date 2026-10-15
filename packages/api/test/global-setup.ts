import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Build a real Postgres for the suite, once.
 *
 * PGlite is Postgres compiled to WebAssembly, so the queries under test run
 * against the same engine and the same constraints production has. A mocked
 * database would answer whatever the mock was told to, which is useless for
 * the thing these tests exist to check: that a `where` clause names the team.
 */
export default function setup() {
  const dir = mkdtempSync(join(tmpdir(), "marmalade-test-db-"));
  process.env.TEST_DATABASE_DIR = dir;

  execFileSync(
    "pnpm",
    [
      "exec",
      "drizzle-kit",
      "push",
      "--force",
      "--config=drizzle.test.config.ts",
    ],
    {
      cwd: new URL("../../db", import.meta.url).pathname,
      env: { ...process.env, TEST_DATABASE_DIR: dir },
      stdio: "inherit",
    },
  );

  return () => {
    rmSync(dir, { recursive: true, force: true });
  };
}
