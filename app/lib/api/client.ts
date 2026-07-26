import { env } from "~/lib/env.server";

/**
 * Low-level API client for the Yadah Microfinance API.
 *
 * - Prefixes requests with the configured base URL.
 * - Sends/parses JSON.
 * - Normalises the `{ error: { code, message, details? } }` envelope into a
 *   typed `ApiError` that callers can branch on by `status` / `code`.
 *
 * Server-only (imports env.server). Call it from loaders/actions.
 */

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

/**
 * A failure flattened into something that survives the trip to the browser.
 *
 * Actions can only send plain data to the client, so an `ApiError` has to be
 * unpacked to reach it. Worth carrying: `details` is where the API says which
 * field it objected to, and collapsing a failure to its `message` throws that
 * away — leaving "Request validation failed" with no clue as to what failed.
 */
export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export function toApiFailure(error: unknown): ApiFailure {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }
  return {
    status: 0,
    code: "UNKNOWN",
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error ? error.stack : undefined,
  };
}

/**
 * Rethrow a loader's failure as the HTTP response it stands for.
 *
 * A record that doesn't exist, or one this user isn't allowed to open, should
 * render the router's error boundary as a 404/403 — not as the generic
 * "unexpected error" an unrecognised throw produces. 401 is deliberately not
 * translated: `withAuth` owns that, and turning it into a page would strand the
 * user instead of refreshing their session.
 */
export function throwAsRouteError(error: unknown): never {
  if (error instanceof Response) throw error;
  if (error instanceof ApiError) {
    // A 400 the API blames on a *path parameter* means the URL itself is
    // malformed — `/customers/undefined`, a truncated id, a typo. That is a
    // missing page, not a server fault, so it renders as 404 rather than as an
    // unhandled throw with a stack trace.
    const badPathParam =
      error.status === 400 &&
      Array.isArray(error.details) &&
      error.details.some(
        (issue) =>
          issue !== null &&
          typeof issue === "object" &&
          (issue as { in?: unknown }).in === "params",
      );
    if (badPathParam || error.status === 403 || error.status === 404) {
      throw new Response(error.message, {
        status: badPathParam ? 404 : error.status,
        statusText: error.message,
      });
    }
  }
  throw error;
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  /** JSON-serialisable body. Do not set `Content-Type`; it is added for you. */
  json?: unknown;
  /**
   * Multipart body, for the file-upload endpoints. Mutually exclusive with
   * `json`. `Content-Type` is deliberately left unset: only `fetch` knows the
   * boundary it generated, and setting the header by hand drops it, which the
   * server then reads as a malformed body.
   */
  formData?: FormData;
  /** Bearer access token for authenticated endpoints. */
  accessToken?: string;
}

export async function apiFetch<T>(
  path: string,
  { json, formData, accessToken, headers, ...init }: ApiFetchOptions = {},
): Promise<T> {
  const url = `${env.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const finalHeaders = new Headers(headers);
  finalHeaders.set("Accept", "application/json");
  if (json !== undefined) finalHeaders.set("Content-Type", "application/json");
  if (accessToken) finalHeaders.set("Authorization", `Bearer ${accessToken}`);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: finalHeaders,
      body:
        json !== undefined ? JSON.stringify(json) : (formData ?? undefined),
    });
  } catch (cause) {
    // Network/DNS/timeout — surface as a consistent ApiError.
    throw new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "Could not reach the server. Check your connection and retry.",
      details: cause instanceof Error ? cause.message : String(cause),
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const body: ApiErrorBody =
      payload && typeof payload === "object" && "error" in payload
        ? (payload.error as ApiErrorBody)
        : {
            code: "UNKNOWN",
            message: response.statusText || "Request failed.",
          };
    throw new ApiError(response.status, body);
  }

  return payload as T;
}
