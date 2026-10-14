import { db } from "@marmalade-v2/db";
import { comment, conversation } from "@marmalade-v2/db/schema/convo";
import { jellyTeam, jellyTeamContact } from "@marmalade-v2/db/schema/team";
import { env } from "@marmalade-v2/env/server";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

/**
 * The one team a request acts on, resolved once at the context boundary.
 *
 * Every handler reads this instead of `env.JELLY_TEAM_ID`. Resolving once and
 * passing it down is what makes the single-team assumption removable: a global
 * read inside a handler is invisible at the call site, so there is no way to
 * tell by looking whether a handler is tenant-safe.
 */
export type ResolvedTeam = {
  /** Jelly's own team id, and the value stored in every `jelly_team_id`. */
  id: string;
  /** URL handle. Falls back to the id until `ensureTeamSlug` has run. */
  slug: string;
  name: string | null;
  apiBaseUrl: string;
  dailyCeiling: number;
  active: boolean;
};

export type TeamContext = { team: ResolvedTeam };

const SLUG_MAX_LENGTH = 48;

/**
 * Roles that make someone part of a Jelly team rather than someone it
 * corresponds with. Mirrors `STAFF_ROLES` in the team router, kept here so
 * context resolution does not import a router.
 */
const STAFF_ROLES = ["owner", "admin", "member"] as const;

/** URL-safe handle derived from a display name or a team id. */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH);
  return slug || "team";
}

function toResolvedTeam(row: typeof jellyTeam.$inferSelect): ResolvedTeam {
  return {
    id: row.id,
    slug: row.slug ?? row.id,
    name: row.name,
    apiBaseUrl: row.apiBaseUrl,
    dailyCeiling: row.dailyCeiling,
    active: row.active,
  };
}

/**
 * Give a team a slug if it does not have one.
 *
 * `db:push` is the deploy path here, so a `NOT NULL` slug would stop the push
 * and the data step inside a migration file would never run. Backfilling from
 * application code is the only shape that actually executes, and it is the
 * same pattern `team.resync` uses to repair `exists_in_jelly`.
 */
export async function ensureTeamSlug(teamId: string): Promise<string> {
  const [row] = await db
    .select({ slug: jellyTeam.slug })
    .from(jellyTeam)
    .where(eq(jellyTeam.id, teamId))
    .limit(1);

  if (row?.slug) return row.slug;

  const base = slugify(teamId);
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      const updated = await db
        .update(jellyTeam)
        .set({ slug: candidate })
        .where(eq(jellyTeam.id, teamId))
        .returning({ slug: jellyTeam.slug });
      if (updated[0]?.slug) return updated[0].slug;
    } catch {
      // The slug is unique, so another team already holds this candidate — or
      // another instance assigned one to this team between the read and the
      // write. Re-read before trying the next candidate; an assigned slug is
      // the answer whoever wrote it.
      const [again] = await db
        .select({ slug: jellyTeam.slug })
        .from(jellyTeam)
        .where(eq(jellyTeam.id, teamId))
        .limit(1);
      if (again?.slug) return again.slug;
    }
  }

  throw new Error(`Could not assign a slug to team ${teamId}`);
}

export async function resolveTeamById(
  teamId: string,
): Promise<ResolvedTeam | null> {
  const [row] = await db
    .select()
    .from(jellyTeam)
    .where(eq(jellyTeam.id, teamId))
    .limit(1);
  return row ? toResolvedTeam(row) : null;
}

export async function resolveTeamBySlug(
  slug: string,
): Promise<ResolvedTeam | null> {
  const [row] = await db
    .select()
    .from(jellyTeam)
    .where(eq(jellyTeam.slug, slug))
    .limit(1);
  if (row) return toResolvedTeam(row);

  // A team onboarded before slugs existed answers to its id, which is what
  // `ensureTeamSlug` would have given it anyway.
  const [byId] = await db
    .select()
    .from(jellyTeam)
    .where(eq(jellyTeam.id, slug))
    .limit(1);
  return byId ? toResolvedTeam(byId) : null;
}

export async function listTeams(): Promise<ResolvedTeam[]> {
  const rows = await db.select().from(jellyTeam);
  return rows.map(toResolvedTeam);
}

/**
 * The team to use when nothing in the request names one.
 *
 * `JELLY_TEAM_ID` is consulted first so an existing deploy keeps behaving
 * exactly as it did, then the sole row if there is exactly one. With several
 * teams and no selector this throws, which is the point: a silent default
 * across tenants is a cross-team write waiting to happen.
 */
export async function resolveDefaultTeam(): Promise<ResolvedTeam> {
  if (env.JELLY_TEAM_ID) {
    const configured = await resolveTeamById(env.JELLY_TEAM_ID);
    if (configured) return configured;
    // First boot of a fresh database: the row does not exist yet, and the
    // sync paths create it. Describe the configured team without inventing a
    // row here, so reads stay read-only.
    return {
      id: env.JELLY_TEAM_ID,
      slug: slugify(env.JELLY_TEAM_ID),
      name: null,
      apiBaseUrl: env.JELLY_API_URL,
      dailyCeiling: 80_000,
      active: true,
    };
  }

  const teams = await listTeams();
  const active = teams.filter((team) => team.active);
  if (active.length === 1 && active[0]) return active[0];

  throw new ORPCError("BAD_REQUEST", {
    message:
      active.length === 0
        ? "No Jelly team is connected. Onboard one first."
        : "This deployment serves several Jelly teams; name one with the " +
          `${ACTIVE_TEAM_HEADER} header.`,
  });
}

/**
 * Header a session-authenticated client uses to say which team it is looking
 * at. API keys do not need it — the key row already names its team — so the
 * public API is unchanged by multi-team.
 */
export const ACTIVE_TEAM_HEADER = "x-marmalade-team";

/**
 * Cookie carrying the same value.
 *
 * The header covers client-side RPC calls, but a server-rendered navigation
 * is a plain document request with no chance to set one, so the switcher
 * would silently stop working on reload. A cookie travels on both.
 */
export const ACTIVE_TEAM_COOKIE = "marmalade_team";

function teamFromCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === ACTIVE_TEAM_COOKIE) {
      return decodeURIComponent(rest.join("=")) || null;
    }
  }
  return null;
}

/**
 * The teams a signed-in user may act in: a staff contact row in an active
 * team. A correspondent who happens to share an email address with a user is
 * not a member.
 */
export async function teamsForEmail(email: string): Promise<ResolvedTeam[]> {
  const rows = await db
    .select({ team: jellyTeam })
    .from(jellyTeamContact)
    .innerJoin(jellyTeam, eq(jellyTeam.id, jellyTeamContact.jellyTeamId))
    .where(
      and(
        eq(jellyTeamContact.email, email),
        eq(jellyTeam.active, true),
        inArray(jellyTeamContact.role, [...STAFF_ROLES]),
      ),
    );
  return rows.map((row) => toResolvedTeam(row.team));
}

/**
 * Which team this request acts in.
 *
 * The requested team is checked against the caller's membership here, at the
 * boundary, rather than left to whatever the handler happens to look up. The
 * slug arrives in a cookie the client sets, so without this check any
 * signed-in user could name any team. Downstream role checks would still
 * refuse them, but only the ones that check — a handler on
 * `publicProcedure` reading `teamIdOf` would happily act under the named
 * team.
 */
export async function resolveTeamFromRequest(
  req: Request,
  email?: string | null,
): Promise<ResolvedTeam> {
  const requested =
    req.headers.get(ACTIVE_TEAM_HEADER)?.trim() || teamFromCookie(req)?.trim();

  if (!requested) {
    // No selection. For a member of exactly one team that team is the only
    // sensible answer, and it beats the configured default, which may be a
    // team they do not belong to.
    if (email) {
      const mine = await teamsForEmail(email);
      if (mine.length === 1 && mine[0]) return mine[0];
    }
    return resolveDefaultTeam();
  }

  const team = await resolveTeamBySlug(requested);
  if (!team) {
    throw new ORPCError("NOT_FOUND", { message: `Unknown team ${requested}` });
  }
  if (!team.active) {
    throw new ORPCError("FORBIDDEN", {
      message: `Jelly team ${team.id} is not active`,
    });
  }

  if (email) {
    const mine = await teamsForEmail(email);
    if (!mine.some((candidate) => candidate.id === team.id)) {
      throw new ORPCError("FORBIDDEN", {
        message: `You are not a member of team ${team.slug}`,
      });
    }
  }

  return team;
}

/**
 * Fill `jelly_team_id` on the content tables that gained one.
 *
 * Idempotent and cheap once it has run: each statement is a no-op when there
 * is nothing left to fill. It lives here rather than in a migration file
 * because `db:push` applies the columns and never executes the data step.
 *
 * Child rows take their team from the conversation they hang off, which is why
 * the conversation itself has to be filled first.
 */
export async function backfillTeamIds(teamId: string): Promise<void> {
  await db
    .update(conversation)
    .set({ jellyTeamId: teamId })
    .where(isNull(conversation.jellyTeamId));

  await db.execute(sql`
    update "jelly_message" m
       set "jelly_team_id" = c."jelly_team_id"
      from "jelly_conversation" c
     where m."conversation_id" = c."id"
       and m."jelly_team_id" is null
       and c."jelly_team_id" is not null
  `);

  await db
    .update(comment)
    .set({ jellyTeamId: teamId })
    .where(isNull(comment.jellyTeamId));

  await db.execute(sql`
    update "jelly_conversation_assignment" a
       set "jelly_team_id" = c."jelly_team_id"
      from "jelly_conversation" c
     where a."conversation_id" = c."id"
       and a."jelly_team_id" is null
       and c."jelly_team_id" is not null
  `);

  await db.execute(sql`
    update "jelly_conversation_label" l
       set "jelly_team_id" = c."jelly_team_id"
      from "jelly_conversation" c
     where l."conversation_id" = c."id"
       and l."jelly_team_id" is null
       and c."jelly_team_id" is not null
  `);

  await db.execute(sql`
    update "jelly_message_contact" mc
       set "jelly_team_id" = m."jelly_team_id"
      from "jelly_message" m
     where mc."message_id" = m."id"
       and mc."jelly_team_id" is null
       and m."jelly_team_id" is not null
  `);

  await db.execute(sql`
    update "jelly_message_attachment" ma
       set "jelly_team_id" = m."jelly_team_id"
      from "jelly_message" m
     where ma."message_id" = m."id"
       and ma."jelly_team_id" is null
       and m."jelly_team_id" is not null
  `);

  await db.execute(sql`
    update "mailbox_member" mm
       set "jelly_team_id" = mb."jelly_team_id"
      from "mailbox" mb
     where mm."marmalade_mailbox_id" = mb."id"
       and mm."jelly_team_id" is null
  `);

  // Labels carry no conversation, so the only sound source is the team being
  // synced. Safe while a label row cannot yet belong to two teams; the
  // composite unique added alongside this column keeps it that way.
  await db.execute(sql`
    update "jelly_label" set "jelly_team_id" = ${teamId}
     where "jelly_team_id" is null
  `);
}
