import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import { orpc } from "@/utils/orpc";
import { ACTIVE_TEAM_COOKIE } from "@marmalade-v2/api/lib/team-cookie";

/**
 * Which Jelly team the session is looking at.
 *
 * The selection is a cookie rather than component state: a server-rendered
 * navigation is a plain document request, so anything held only in the client
 * would be forgotten on every reload and the page would silently render
 * another team's data.
 *
 * The displayed team comes from the server too. With nothing selected the
 * server falls back to the configured team, which need not be the first of
 * this user's, so a client-side guess would name one team while the page
 * rendered another.
 *
 * Hidden when there is only one team to choose from, which is every
 * single-team deployment.
 */
export default function TeamSwitcher() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const mine = useQuery(orpc.team.listMine.queryOptions());

  const teams = mine.data?.teams ?? [];
  // An operator sees the selector even with one team connected, because
  // onboarding a second is a thing they do from here.
  const minimum = mine.data?.isInstanceOperator ? 1 : 2;
  if (teams.length < minimum) return null;

  const select = (slug: string) => {
    // Path-wide and a year out, so the choice survives navigation and
    // reloads. Not `Secure`, because local development is plain HTTP.
    document.cookie = `${ACTIVE_TEAM_COOKIE}=${encodeURIComponent(
      slug,
    )}; path=/; max-age=31536000; samesite=lax`;
    // Everything already fetched belongs to the previous team.
    queryClient.clear();
    router.invalidate();
  };

  return (
    <select
      aria-label="Active team"
      className="rounded-md border px-2 py-1 text-sm"
      value={mine.data?.activeSlug ?? teams[0]!.slug}
      onChange={(event) => select(event.target.value)}
    >
      {teams.map((team) => (
        <option key={team.id} value={team.slug}>
          {team.name ?? team.slug}
        </option>
      ))}
    </select>
  );
}
