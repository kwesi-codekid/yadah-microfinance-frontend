import { ApiError, type ApiErrorBody } from "~/api/error";
import { env } from "~/lib/env.server";

/**
 * The single fetch every loader and action goes through. It encodes the API's
 * conventions once — bearer auth, the `{ error: { code, message } }` envelope,
 * JSON bodies, a timeout — so no feature module repeats them.
 *
 * Server-only: it reads `env`, which holds the base URL and never leaves the
 * server. Call it from a `loader` or an `action`, never from a component.
 */

export { ApiError, throwAsRouteError } from "~/api/error";
export type { ApiErrorBody } from "~/api/error";

/** Network, DNS and timeout failures, so callers only ever see `ApiError`. */
const NETWORK_ERROR: ApiErrorBody = {
  code: "NETWORK_ERROR",
  message: "Could not reach the server. Check your connection and try again.",
};

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  /** JSON-serialisable body. Do not set `Content-Type`; it is added for you. */
  json?: unknown;
  formData?: FormData;
  /** Bearer access token, for authenticated endpoints. */
  accessToken?: string;
}

function urlFor(path: string): string {
  return `${env.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function errorFrom(response: Response): Promise<ApiError> {
  const payload = await response.json().catch(() => null);
  const body: ApiErrorBody =
    payload && typeof payload === "object" && "error" in payload
      ? (payload.error as ApiErrorBody)
      : { code: "UNKNOWN", message: response.statusText || "Request failed." };
  return new ApiError(response.status, body);
}

async function send(url: string, init: RequestInit): Promise<Response> {
  // Every upstream call in the app funnels through here, which makes this the
  // one place worth timing when a screen feels slow.
  const started = env.apiDebugLogging ? performance.now() : 0;
  const trace = (outcome: string) => {
    if (!env.apiDebugLogging) return;
    const ms = Math.round(performance.now() - started);
    const path = url.slice(env.apiBaseUrl.length) || "/";
    console.log(`[api] ${init.method ?? "GET"} ${path} → ${outcome} ${ms}ms`);
  };

  try {
    const response = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(env.apiTimeoutMs),
    });
    trace(String(response.status));
    return response;
  } catch (cause) {
    trace("failed");
    throw new ApiError(0, {
      ...NETWORK_ERROR,
      details: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

export async function apiFetch<T>(
  path: string,
  { json, formData, accessToken, headers, ...init }: ApiFetchOptions = {},
): Promise<T> {
  const finalHeaders = new Headers(headers);
  finalHeaders.set("Accept", "application/json");
  if (json !== undefined) finalHeaders.set("Content-Type", "application/json");
  if (accessToken) finalHeaders.set("Authorization", `Bearer ${accessToken}`);

  const response = await send(urlFor(path), {
    ...init,
    headers: finalHeaders,
    body: json !== undefined ? JSON.stringify(json) : (formData ?? undefined),
  });

  if (!response.ok) throw await errorFrom(response);
  if (response.status === 204) return undefined as T;

  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");
  return (isJson ? await response.json().catch(() => null) : null) as T;
}

/**
 * The raw `Response`, for the endpoints that answer with something other than
 * JSON — `format=csv|xlsx` exports and the registration-form PDF. Errors still
 * arrive as JSON and are thrown as `ApiError` exactly as `apiFetch` does.
 */
export async function apiFetchRaw(
  path: string,
  { accessToken, headers, ...init }: ApiFetchOptions = {},
): Promise<Response> {
  const finalHeaders = new Headers(headers);
  if (accessToken) finalHeaders.set("Authorization", `Bearer ${accessToken}`);

  const response = await send(urlFor(path), { ...init, headers: finalHeaders });
  if (!response.ok) throw await errorFrom(response);
  return response;
}
