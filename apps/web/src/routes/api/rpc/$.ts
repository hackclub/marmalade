import {
  createApiKeyContext,
  createAuthContext,
} from "@marm/api/context";
import { appRouter } from "@marm/api/routers/index";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createFileRoute } from "@tanstack/react-router";

const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
      specGenerateOptions: {
        info: {
          title: "Marmalade API",
          version: "1.0.0",
        },
        servers: [{ url: "/api/rpc" }],
        security: [{ BearerAuth: [] }],
        components: {
          securitySchemes: {
            BearerAuth: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "API Key",
            },
          },
        },
      },
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

async function resolveContext({ request }: { request: Request }) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return createApiKeyContext({ req: request });
  }
  return createAuthContext({ req: request });
}

async function handle({ request }: { request: Request }) {
  const url = new URL(request.url);

  // Only serve OpenAPI spec/docs without auth
  if (
    url.pathname === "/api/rpc/api-reference" ||
    url.pathname === "/api/rpc/api-reference/" ||
    url.pathname === "/api/rpc/api-reference/spec.json"
  ) {
    const apiResult = await apiHandler.handle(request, {
      prefix: "/api/rpc/api-reference",
      context: { auth: null, session: null },
    });
    if (apiResult.response) return apiResult.response;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const context: any = await resolveContext({ request });

  const rpcResult = await rpcHandler.handle(request, {
    prefix: "/api/rpc",
    context,
  });
  if (rpcResult.response) return rpcResult.response;

  const apiResult = await apiHandler.handle(request, {
    prefix: "/api/rpc",
    context,
  });
  if (apiResult.response) return apiResult.response;

  return new Response("Not found", { status: 404 });
}

export const Route = createFileRoute("/api/rpc/$")({
  server: {
    handlers: {
      HEAD: handle,
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
});
