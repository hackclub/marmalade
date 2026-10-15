import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

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
  /**
   * URL handle, used by the per-team webhook endpoint and the web app's team
   * switcher.
   *
   * Nullable because `db:push` is the deploy path: a `NOT NULL` column with no
   * default stops the push and takes the deploy with it. `ensureTeamSlug()`
   * backfills it from the team id on first use, so the column is effectively
   * required from application code's point of view without being declared so
   * to the database.
   */
  slug: text("slug").unique(),
  /** Display name, as reported by Jelly. Unknown until the first sync. */
  name: text("name"),
  apiBaseUrl: text("api_base_url")
    .notNull()
    .default("https://app.letsjelly.com"),
  apiTokenEncrypted: text("api_token_encrypted"),
  webhookSecretEncrypted: text("webhook_secret_encrypted"),
  /**
   * Jelly's published per-team ceiling is 100,000 requests a day. The default
   * leaves 20% of headroom for work Marmalade does not drive.
   *
   * Per team rather than per deployment because the limit itself is per team:
   * a second team brings its own budget rather than eating the first's.
   */
  dailyCeiling: integer("daily_ceiling").notNull().default(80_000),
  /**
   * How long an approval stays on offer, in minutes.
   *
   * Per team because the right answer depends on how the team works: a desk
   * staffed through the day can afford a short window, and one that answers
   * in the evenings needs the offer to survive the night.
   */
  approvalTtlMinutes: integer("approval_ttl_minutes").notNull().default(1440),
  /** Cleared teams are skipped by sync and refuse new work. */
  active: boolean("active").notNull().default(true),
  /** Set when onboarding stores a validated token for the team. */
  onboardedAt: timestamp("onboarded_at", { mode: "date" }),
  /**
   * Set by the first webhook delivery that verifies against this team's
   * secret. Until it is set, the mirror is one-way and a misconfigured Jelly
   * integration looks exactly like a quiet inbox.
   */
  firstWebhookAt: timestamp("first_webhook_at", { mode: "date" }),
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
