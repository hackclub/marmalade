/**
 * How a session-authenticated client names the team it is looking at.
 *
 * These two constants live apart from the rest of the team code because the
 * browser needs them: the switcher writes the cookie and the oRPC link sends
 * the header. `lib/team.ts` imports the database and the server environment,
 * so importing these from there pulled `@marmalade-v2/env/server` — and with
 * it `dotenv/config` and `process.env` — into the client bundle, where
 * `process` does not exist and the module throws before anything renders.
 *
 * Nothing may be added to this file that imports anything.
 */

/** API keys do not need this: the key row already names its team. */
export const ACTIVE_TEAM_HEADER = "x-marmalade-team";

/**
 * The same value as a cookie.
 *
 * The header covers client-side RPC calls, but a server-rendered navigation
 * is a plain document request with no chance to set one, so the switcher
 * would silently stop working on reload. A cookie travels on both.
 */
export const ACTIVE_TEAM_COOKIE = "marmalade_team";
