import {
  pruneRequestLogs,
  pruneWebhookDeliveries,
  rollUpUsage,
} from "@marmalade-v2/api/lib/observability";
import { env } from "@marmalade-v2/env/server";
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

/**
 * Folds elapsed hours of `jelly_request_log` into `usage_rollup` and prunes
 * rows past their retention.
 *
 * The admin dashboards read only the rollup, so this job is what keeps them
 * fast as the raw log grows by one row per outbound Jelly call.
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

async function handleRollup({ request }: { request: Request }) {
  if (!authorise(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rollup = await rollUpUsage({ hours: 3 });
    const prunedRequests = await pruneRequestLogs(30);
    const prunedWebhooks = await pruneWebhookDeliveries(30);

    return Response.json({ ...rollup, prunedRequests, prunedWebhooks });
  } catch (error) {
    console.error("Usage rollup failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Rollup failed" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/internal/rollup")({
  server: {
    handlers: {
      GET: handleRollup,
      POST: handleRollup,
    },
  },
});
