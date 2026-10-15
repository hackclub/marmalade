import { env } from "@marmalade-v2/env/server";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Envelope encryption for third-party credentials held at rest.
 *
 * The threat being addressed is a leaked database: a dump, a stray backup, a
 * read-only replica handed to someone for debugging. It is not a compromised
 * application host — anything that can run Marmalade's code can also read
 * `MARMALADE_ENCRYPTION_KEY` and decrypt. Defending against that needs a KMS
 * and is a different project.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

/**
 * Accepts either base64 (the output of `openssl rand -base64 32`) or 64 hex
 * characters, because both are what people reach for and silently truncating
 * the wrong one would produce a weak key that still appears to work.
 */
function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = env.MARMALADE_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "MARMALADE_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`.",
    );
  }

  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `MARMALADE_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. ` +
        "Generate one with `openssl rand -base64 32`.",
    );
  }

  cachedKey = key;
  return key;
}

/**
 * Additional authenticated data binds a ciphertext to the exact row and column
 * it was written for. Moving an encrypted Jelly token from one team's row to
 * another's, or from the token column into the webhook-secret column, fails to
 * decrypt instead of silently working.
 */
function aad(scope: string, purpose: string): Buffer {
  return Buffer.from(`${VERSION}:${scope}:${purpose}`, "utf-8");
}

export function seal(
  plaintext: string,
  scope: string,
  purpose: string,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv, {
    authTagLength: 16,
  });
  cipher.setAAD(aad(scope, purpose));

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);

  return [
    VERSION,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function open(envelope: string, scope: string, purpose: string): string {
  const [version, ivPart, tagPart, dataPart] = envelope.split(":");

  if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error(
      `Unsupported credential envelope format: ${version ?? "?"}`,
    );
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivPart, "base64"),
    { authTagLength: 16 },
  );
  decipher.setAAD(aad(scope, purpose));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64")),
    decipher.final(),
  ]).toString("utf-8");
}

/** Last four characters, for showing which credential is stored without showing it. */
export function credentialHint(plaintext: string): string {
  return plaintext.length <= 4 ? "****" : `****${plaintext.slice(-4)}`;
}
