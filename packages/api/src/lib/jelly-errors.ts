/**
 * Classification of a single Jelly HTTP attempt.
 *
 * The distinction that matters most is `throttled` vs `transient`. A 429 means
 * "not yet"; burning retry budget on it turns a busy hour into dead letters.
 */
export type JellyOutcomeKind =
  | "success"
  | "throttled"
  | "transient"
  | "contended"
  | "invalid"
  | "conflict"
  | "credential"
  | "missing"
  | "unknown";

export class JellyApiError extends Error {
  readonly kind: JellyOutcomeKind;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;
  readonly body: unknown;
  readonly method: string;
  readonly path: string;

  constructor(init: {
    message: string;
    kind: JellyOutcomeKind;
    status: number | null;
    retryAfterSeconds?: number | null;
    body?: unknown;
    method: string;
    path: string;
  }) {
    super(init.message);
    this.name = "JellyApiError";
    this.kind = init.kind;
    this.status = init.status;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.body = init.body ?? null;
    this.method = init.method;
    this.path = init.path;
  }

  /** Whether another attempt could plausibly succeed. */
  get retryable(): boolean {
    return (
      this.kind === "throttled" ||
      this.kind === "transient" ||
      this.kind === "contended" ||
      this.kind === "missing"
    );
  }

  /**
   * True when the request may or may not have been applied by Jelly. A
   * timeout or a dropped connection leaves the outcome unknown, so a
   * non-idempotent action must reconcile before retrying.
   */
  get outcomeUnknown(): boolean {
    return (
      this.kind === "unknown" ||
      (this.kind === "transient" && this.status === null)
    );
  }

  toJSON() {
    return {
      kind: this.kind,
      status: this.status,
      message: this.message,
      retryAfterSeconds: this.retryAfterSeconds,
      body: this.body,
    };
  }
}

export function classifyStatus(status: number): JellyOutcomeKind {
  if (status >= 200 && status < 300) return "success";
  if (status === 429) return "throttled";
  if (status === 423) return "contended";
  if (status === 401 || status === 403) return "credential";
  if (status === 404) return "missing";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "invalid";
  if (status >= 500) return "transient";
  return "invalid";
}

/**
 * `Retry-After` is the only rate-limit header Jelly documents. It may be a
 * delta in seconds or an HTTP date.
 */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/**
 * Collapse resource ids out of a path so request-log rows group by endpoint.
 * "/conversations/abc123/labels/9" -> "/conversations/:id/labels/:id"
 */
export function templatePath(path: string): string {
  const [withoutQuery] = path.split("?");
  return (withoutQuery ?? path)
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (/^\d+$/.test(segment)) return ":id";
      // Jelly ids are opaque; treat any long mixed token as an id.
      if (/^[A-Za-z0-9_-]{8,}$/.test(segment) && /\d/.test(segment)) {
        return ":id";
      }
      return segment;
    })
    .join("/");
}
