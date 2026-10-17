/** Normalized error thrown by {@link api} for non-success responses. */
export class ApiError extends Error {
  /** Stable i18n key returned by the backend (e.g. "users.error.verifyMismatch"). */
  serverKey: string | null;
  /** Substitution parameters for the i18n key (e.g. { min: 12 }). */
  serverParams: Record<string, string | number> | null;

  constructor(
    message: string,
    serverKey?: string,
    serverParams?: Record<string, string | number>
  ) {
    super(message);
    this.name = "ApiError";
    this.serverKey = serverKey ?? null;
    this.serverParams = serverParams ?? null;
  }
}

/**
 * Module-level authentication store.
 *
 * The opaque session token is the only authoritative browser state; the
 * CSRF token travels in an `x-csrf-token` header and is bound server-side to
 * the same session (same lifetime, usable only with that session).
 */
let authToken: string | null = null;
let csrfToken: string | null = null;

type SessionInvalidHandler = () => void;
const sessionInvalidHandlers = new Set<SessionInvalidHandler>();

/** Called whenever the backend rejects the session (expired, revoked, ...). */
export function onSessionInvalid(handler: SessionInvalidHandler): () => void {
  sessionInvalidHandlers.add(handler);
  return () => {
    sessionInvalidHandlers.delete(handler);
  };
}

function emitSessionInvalid(): void {
  sessionInvalidHandlers.forEach((handler) => {
    try {
      handler();
    } catch {
      // Never let one listener break the others.
    }
  });
}

/** Update the headers injected into every request (called by the auth provider). */
export function setAuthHeaders(token: string | null, csrf: string | null): void {
  authToken = token;
  csrfToken = csrf;
}

/** @internal Notify listeners that the session is no longer valid. */
export function reportSessionInvalid(): void {
  emitSessionInvalid();
}

/** Delay helper for transient-error retries. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const TRANSIENT_READY_ERROR = "Response not yet ready.";
const TRANSIENT_MAX_ATTEMPTS = 3;
const TRANSIENT_RETRY_DELAYS_MS = [1500, 4000];

/**
 * OpenWhisk cold starts can outlive the gateway poll window, which then
 * answers with the transient envelope `{"code": "<activationId>",
 * "error": "Response not yet ready."}` (usually on a 5xx status). The action
 * keeps running and the next attempt hits a warm instance, so these errors
 * are safe to retry with a short backoff.
 */
function isTransientGatewayError(
  status: number,
  body: Record<string, any>
): boolean {
  if (status >= 502 && status <= 504) {
    return true;
  }
  const message = typeof body?.error === "string" ? body.error : "";
  return message === TRANSIENT_READY_ERROR || /not yet ready/i.test(message);
}

/**
 * Operations that are safe to retry: reads only. Mutation operations are
 * never retried because the first activation may have completed in the
 * background and a retry could apply the change twice.
 */
const READ_ONLY_OPERATIONS = new Set([
  "list",
  "get",
  "search",
  "history",
  "me",
  "download",
  "get-columns",
  "get-settings",
]);

function isReadOnlyRequest(options?: RequestInit): boolean {
  const method = (options?.method ?? "GET").toUpperCase();
  if (method === "GET") {
    return true;
  }
  if (method === "POST" && typeof options?.body === "string") {
    try {
      const parsed = JSON.parse(options.body) as Record<string, unknown>;
      const operation = String(
        parsed.operation ?? parsed.action ?? ""
      ).toLowerCase();
      return READ_ONLY_OPERATIONS.has(operation);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Call an OpenServerless web action through the dev/prod proxy and normalize
 * both direct and `{ body: ... }`-wrapped responses.
 *
 * When an authenticated session is active, the `Authorization` (opaque
 * session token) and `x-csrf-token` headers are attached automatically.
 *
 * Transient gateway errors (cold-start "Response not yet ready") are
 * retried with a short backoff for read-only requests only.
 */
export async function api<T = any>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
    if (csrfToken) {
      headers["x-csrf-token"] = csrfToken;
    }
  }
  const retryable = isReadOnlyRequest(options);

  for (let attempt = 0; attempt < TRANSIENT_MAX_ATTEMPTS; attempt++) {
    const response = await fetch(path, {
      ...options,
      headers,
    });
    const raw = await response.json().catch(() => null);
    const data =
      raw && typeof raw === "object" && "body" in raw
        ? (raw as { body: unknown }).body
        : raw;
    const body = (data ?? {}) as Record<string, any>;
    const errorKey =
      typeof body.error === "string" ? body.error : null;
    if (!response.ok || body.ok === false || errorKey) {
      // The server answers with the literal "wrong credentials" message for
      // any failed authentication step (spec requirement).
      if (errorKey === "session" || errorKey === "csrf") {
        reportSessionInvalid();
      }
      const error = new ApiError(
        errorKey || `Request failed: ${response.status}`,
        errorKey ?? undefined,
        body.errorParams && typeof body.errorParams === "object"
          ? body.errorParams
          : undefined
      );
      const transient = isTransientGatewayError(response.status, body);
      const canRetry =
        retryable && transient && attempt < TRANSIENT_MAX_ATTEMPTS - 1;
      if (errorKey !== "session" && errorKey !== "csrf" && canRetry) {
        await sleep(TRANSIENT_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw error;
    }
    return data as T;
  }
  throw new ApiError(
    `Request failed after ${TRANSIENT_MAX_ATTEMPTS} attempts`
  );
}
