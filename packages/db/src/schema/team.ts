import { boolean, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * A Jelly team Marmalade is connected to, and the credentials it uses to talk
 * to that team.
 *
 * Credentials live here rather than in the environment so that connecting a
 * team is a row rather than a redeploy. Both secret columns hold AES-256-GCM
 * envelopes produced by `seal()` in `@marmalade-v2/api/lib/crypto`; neither is
 * ever returned to a client in plaintext.
 */
export const jellyTeam = pgTable("jelly_team", {
  id: text("id").notNull().primaryKey(),
  /** Display name, as reported by Jelly. Unknown until the first sync. */
  name: text("name"),
  apiBaseUrl: text("api_base_url")
    .notNull()
    .default("https://app.letsjelly.com"),
  apiTokenEncrypted: text("api_token_encrypted"),
  webhookSecretEncrypted: text("webhook_secret_encrypted"),
  /** Cleared teams are skipped by sync and refuse new work. */
  active: boolean("active").notNull().default(true),
  credentialsUpdatedAt: timestamp("credentials_updated_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// export const jellyTeamContact = pgTable(
//   "jelly_team_member",
//   {
//     id: text("id").notNull().primaryKey(),
//     name: text("name").notNull(),
//     email: text("email").notNull().unique(),
//     role: text("role").notNull(),
//     active: boolean("active").default(true).notNull(),
//     jellyTeamId: text("jelly_team_id").notNull(),
//     existsInJelly: boolean("exists_in_jelly")
//       .notNull()
//       .$default(() => true),
//   },
//   (t) => [unique().on(t.email, t.jellyTeamId)],
// );

export const jellyTeamContact = pgTable(
  "jelly_contact",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    email: text("email").notNull(),
    role: text("role").notNull().default("contact"), // e.g. admin, member, owner, contact
    active: boolean("active").default(true).notNull(),
    jellyTeamId: text("jelly_team_id")
      .notNull()
      .references(() => jellyTeam.id, { onDelete: "cascade" }),
    existsInJelly: boolean("exists_in_jelly")
      .notNull()
      .$default(() => true),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  // An email is unique within a team, not globally: one person can be a
  // contact in several Jelly teams. A global constraint makes that
  // unrepresentable, which is why the commented-out table above already had
  // this composite before it was replaced.
  (t) => [unique().on(t.email, t.jellyTeamId)],
);
