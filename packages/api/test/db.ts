import { PGlite } from "@electric-sql/pglite";
import * as schema from "@marmalade-v2/db/schema/index";
import { drizzle } from "drizzle-orm/pglite";

/**
 * The database the suite runs against: real Postgres, compiled to WebAssembly.
 *
 * It matters that this is not a mock. These tests exist to check that queries
 * name the team they act on, and a mock answers whatever it was told to —
 * it would pass a query with the `where` clause removed. PGlite enforces the
 * same constraints production does, so a missing filter shows up as the wrong
 * rows and a broken unique shows up as an accepted insert.
 *
 * The schema is applied by `drizzle-kit push`, which is how production
 * applies it too.
 */
const client = new PGlite(process.env.TEST_DATABASE_DIR);

export const testDb = drizzle(client, { schema });

/** Empty every table, so one test's rows cannot explain another's result. */
export async function resetDb() {
  await client.exec(`
    truncate table
      "jelly_message_attachment", "jelly_message_contact", "jelly_message",
      "comment", "jelly_conversation_label", "jelly_conversation_assignment",
      "jelly_conversation_mailbox", "jelly_conversation", "jelly_label",
      "api_key_field_scope", "api_key_scope", "api_key",
      "mailbox_member", "mailbox", "jelly_mailbox_member", "jelly_mailbox",
      "audit_log", "jelly_contact", "jelly_team",
      "session", "account", "verification", "user"
    restart identity cascade;
  `);
}

export async function closeDb() {
  await client.close();
}
