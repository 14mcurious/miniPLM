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
 * Call an OpenServerless web action through the dev/prod proxy and normalize
 * both direct and `{ body: ... }`-wrapped responses.
 */
export async function api<T = any>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const raw = await response.json().catch(() => null);
  const data =
    raw && typeof raw === "object" && "body" in raw
      ? (raw as { body: unknown }).body
      : raw;
  const body = (data ?? {}) as Record<string, any>;
  if (!response.ok || body.ok === false || body.error) {
    throw new ApiError(
      body.error || `Request failed: ${response.status}`,
      typeof body.error === "string" ? body.error : undefined,
      body.errorParams && typeof body.errorParams === "object"
        ? body.errorParams
        : undefined
    );
  }
  return data as T;
}
