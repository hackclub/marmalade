import { createJellyWebhookContext } from "@marm/api/context";
import {
  webhookRouter,
  type JellyWebhookInput,
} from "@marm/api/routers/webhook";
import { ORPCError, call } from "@orpc/server";
import { createFileRoute } from "@tanstack/react-router";

async function handleWebhook({ request }: { request: Request }) {
  const rawBody = await request.text();

  if (!rawBody) {
    return Response.json(
      { error: "Request body is required" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await call(
      webhookRouter.jellyEventWebhook,
      body as JellyWebhookInput,
      {
        context: {
          ...(await createJellyWebhookContext({ req: request, rawBody })),
        },
      },
    );

    return Response.json(result);
  } catch (error) {
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
