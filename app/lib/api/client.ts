import { env } from "~/lib/env.server";

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

export function throwAsRouteError(error: unknown): never {
  if (error instanceof Response) throw error;
  if (error instanceof ApiError) {
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
