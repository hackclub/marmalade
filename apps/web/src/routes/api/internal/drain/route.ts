import { drainActions } from "@marmalade-v2/api/lib/actions/outbox";
import { env } from "@marmalade-v2/env/server";
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

/**
 * Drains the Jelly action queue.
 *
 * Marmalade runs on Vercel, which has no always-on process, so the queue is
 * drained by cron (see `vercel.json`) while the request path dispatches
 * inline. `drainActions` is a plain function, so moving to a long-lived worker
 * later is a deployment change rather than a rewrite.
 */
function authorise(request: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("Authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = Buffer.from(secret, "utf-8");
  const actual = Buffer.from(provided, "utf-8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function handleDrain({ request }: { request: Request }) {
  if (!authorise(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), 100)
      : 25;

  try {
    const result = await drainActions({ limit });
    return Response.json(result);
  } catch (error) {
    console.error("Action drain failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Drain failed" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/internal/drain")({
  server: {
    handlers: {
      GET: handleDrain,
      POST: handleDrain,
    },
  },
});
