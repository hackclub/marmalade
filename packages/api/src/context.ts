import { auth } from "@marmalade-v2/auth";
import { ORPCError } from "@orpc/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@marmalade-v2/env/server";

export async function createAuthContext({ req }: { req: Request }) {
  const session = await auth.api.getSession({
    headers: req.headers,
  });
  return {
    auth: null,
    session,
  };
}

export async function createJellyWebhookContext({
  req,
  rawBody,
}: {
  req: Request;
  rawBody: string;
}) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Basic ")) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid webhook credentials",
    });
  }

  const credentials = Buffer.from(authHeader.slice(6), "base64").toString(
    "utf-8",
  );
  const separatorIndex = credentials.indexOf(":");
  if (separatorIndex === -1) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid webhook credentials",
    });
  }

  const username = credentials.slice(0, separatorIndex);
  const password = credentials.slice(separatorIndex + 1);

  const expectedUser = env.WEBHOOK_USERNAME || "jelly";
  const expectedPass = env.WEBHOOK_PASSWORD;
  if (!expectedPass || username !== expectedUser || password !== expectedPass) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid webhook credentials",
    });
  }

  const signatureHeader = req.headers.get("X-Jelly-Signature");
  if (!signatureHeader) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid Jelly signature",
    });
  }

  const secret = env.JELLY_WEBHOOK_SECRET;
  if (!secret) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Jelly webhook secret is not configured",
    });
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const normalizedSignature = signatureHeader
    .trim()
    .toLowerCase()
    .replace(/^sha256=/, "");

  const expectedBuffer = Buffer.from(expectedSignature, "utf-8");
  const providedBuffer = Buffer.from(normalizedSignature, "utf-8");

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid Jelly signature",
    });
  }

  return {
    rawBody,
    request: req,
  };
}

export type AuthContext = Awaited<ReturnType<typeof createAuthContext>>;
export type WebhookContext = Awaited<ReturnType<typeof createJellyWebhookContext>>;
