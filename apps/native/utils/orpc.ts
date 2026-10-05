import type { AppRouterClient } from "@marmalade-v2/api/routers/index";
import { env } from "@marmalade-v2/env/native";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";

import { authClient } from "@/lib/auth-client";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      console.warn("[marmalade]", error.message);
    },
  }),
  defaultOptions: { queries: { staleTime: 60 * 1000, retry: 1 } },
});

async function expoFetch(request: Request, init?: RequestInit) {
  const { fetch } = await import("expo/fetch");

  return fetch(request.url, {
    body: await request.blob(),
    headers: request.headers,
    method: request.method,
    signal: request.signal,
    ...init,
  });
}

export const link = new RPCLink({
  url: `${env.EXPO_PUBLIC_SERVER_URL}/api/rpc`,
  fetch(request, init) {
    return expoFetch(request, {
      ...init,
      // Better Auth's Expo client forwards the session cookie by hand on
      // native, so the platform cookie jar must stay out of it.
      credentials: Platform.OS === "web" ? "include" : "omit",
    });
  },
  async headers() {
    if (Platform.OS === "web") return {};

    const cookies = await authClient.getCookie();
    return cookies ? { Cookie: cookies } : {};
  },
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
