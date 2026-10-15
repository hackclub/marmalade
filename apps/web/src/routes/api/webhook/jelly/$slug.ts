import { createJellyWebhookContext } from "@marmalade-v2/api/context";
import { recordWebhookDelivery } from "@marmalade-v2/api/lib/observability";
import {
  webhookRouter,
  type JellyWebhookInput,
} from "@marmalade-v2/api/routers/webhook";
import { ORPCError, call } from "@orpc/server";
import { createFileRoute } from "@tanstack/react-router";

/**
 * Per-team webhook endpoint.
 *
 * Jelly's payload carries no team identifier and the signing secret is
 * per-webhook-configuration, so the URL is the only thing that can say which
 * team a delivery belongs to. The team is resolved from the slug before the
 * signature is checked, because there is no signature to check until it is
 * known whose secret to check it against.
 *
 * The old `/api/webhook/jelly` endpoint still works and still means the
 * configured team, so an integration already pointed at it does not break.
 */
async function handleWebhook({
  request,
  params,
}: {
  request: Request;
  params: { slug: string };
}) {
  // Jelly never retries a failed delivery and switches the webhook off after
  // 10 consecutive failures, so every outcome is recorded here too — the
  // per-team endpoint is the one new teams use, and a team whose deliveries
  // went unrecorded would have no webhook health at all.
  const started = Date.now();
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

  let jellyTeamId: string | null = null;

  try {
    const context = await createJellyWebhookContext({
      req: request,
      rawBody,
      slug: params.slug,
    });
    jellyTeamId = context.team?.id ?? null;

    const result = await call(
      webhookRouter.jellyEventWebhook,
      body as JellyWebhookInput,
      { context },
    );

    await recordWebhookDelivery({
      event: (body as { event?: string } | null)?.event ?? eventType,
      jellyTeamId,
      // A mailbox Marmalade does not manage is a correct no-op, not a
      // failure.
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
        CONFLICT: 409,
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

export const Route = createFileRoute("/api/webhook/jelly/$slug")({
  server: {
    handlers: {
      POST: handleWebhook,
    },
  },
});
