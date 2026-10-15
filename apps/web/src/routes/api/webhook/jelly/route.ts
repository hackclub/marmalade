import { createJellyWebhookContext } from "@marmalade-v2/api/context";
import { recordWebhookDelivery } from "@marmalade-v2/api/lib/observability";
import {
  webhookRouter,
  type JellyWebhookInput,
} from "@marmalade-v2/api/routers/webhook";
import { ORPCError, call } from "@orpc/server";
import { createFileRoute } from "@tanstack/react-router";

/**
 * Legacy single-team webhook endpoint.
 *
 * Kept working so an integration already configured in Jelly does not break
 * on deploy. It can only mean `JELLY_TEAM_ID`: with no slug there is nothing
 * in the request to tell teams apart. New teams are pointed at
 * `/api/webhook/jelly/{slug}` instead.
 */
async function handleWebhook({ request }: { request: Request }) {
  const started = Date.now();
  // Jelly never retries a failed delivery and switches the webhook off after
  // 10 consecutive failures, so every outcome is recorded — a mirror that has
  // quietly stopped updating still serves reads and looks healthy otherwise.
  const eventType = request.headers.get("X-Jelly-Event") ?? "unknown";
  const rawBody = await request.text();

  if (!rawBody) {
    await recordWebhookDelivery({
      event: eventType,
      status: "rejected",
      error: "Request body is required",
      durationMs: Date.now() - started,
    });
    return Response.json(
      { error: "Request body is required" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    await recordWebhookDelivery({
      event: eventType,
      status: "rejected",
      error: "Invalid JSON",
      durationMs: Date.now() - started,
    });
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Resolved outside the try so a failure further down can still say whose
  // delivery it was, where the team got far enough to be known.
  let jellyTeamId: string | null = null;

  try {
    const context = await createJellyWebhookContext({ req: request, rawBody });
    jellyTeamId = context.team?.id ?? null;

    const result = await call(
      webhookRouter.jellyEventWebhook,
      body as JellyWebhookInput,
      { context },
    );

    await recordWebhookDelivery({
      event: (body as { event?: string } | null)?.event ?? eventType,
      jellyTeamId,
      // A mailbox Marmalade does not manage is a correct no-op, not a failure.
      status: result.reason ? "skipped" : "accepted",
      error: result.reason ?? null,
      durationMs: Date.now() - started,
    });

    return Response.json(result);
  } catch (error) {
    await recordWebhookDelivery({
      event: (body as { event?: string } | null)?.event ?? eventType,
      jellyTeamId,
      status: error instanceof ORPCError ? "rejected" : "failed",
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    });

    if (error instanceof ORPCError) {
      const statusMap: Record<string, number> = {
        BAD_REQUEST: 400,
        FORBIDDEN: 403,
        INTERNAL_SERVER_ERROR: 500,
        NOT_FOUND: 404,
        UNAUTHORIZED: 401,
      };
      return Response.json(
        { error: error.message || error.code },
        { status: statusMap[error.code] ?? 500 },
      );
    }

    console.error("Jelly webhook failed", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/webhook/jelly")({
  server: {
    handlers: {
      POST: handleWebhook,
    },
  },
});
