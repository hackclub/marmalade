import { createAuthContext } from "@marmalade-v2/api/context";
import {
  ACTIVE_TEAM_COOKIE,
  ACTIVE_TEAM_HEADER,
} from "@marmalade-v2/api/lib/team";
import { appRouter } from "@marmalade-v2/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createRouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { toast } from "sonner";

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        toast.error(`Error: ${error.message}`, {
          action: {
            label: "retry",
            onClick: () => {
              query.invalidate();
            },
          },
        });
      },
    }),
    defaultOptions: { queries: { staleTime: 60 * 1000 } },
  });
}

function activeTeam(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === ACTIVE_TEAM_COOKIE);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

const getORPCClient = createIsomorphicFn()
  .server(() =>
    createRouterClient(appRouter, {
      context: async () => {
        return createAuthContext({ req: getRequest() });
      },
    }),
  )
  .client((): RouterClient<typeof appRouter> => {
    const link = new RPCLink({
      url: `${window.location.origin}/api/rpc`,
      // The cookie would carry the active team on its own. Sending the header
      // too means a request still names its team if the cookie is blocked, and
      // makes the team visible in the network tab when a call comes back with
      // another team's data.
      headers: () => {
        const team = activeTeam();
        return team ? { [ACTIVE_TEAM_HEADER]: team } : {};
      },
      fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: "include",
        });
      },
    });

    return createORPCClient(link);
  });

export const client: RouterClient<typeof appRouter> = getORPCClient();

export const orpc = createTanstackQueryUtils(client);
