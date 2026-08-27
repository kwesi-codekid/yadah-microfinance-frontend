/**
 * The error shape every endpoint uses: `{ error: { code, message, details? } }`.
 *
 * Kept apart from the fetch layer so route components can branch on a code
 * without pulling server-only configuration into the browser bundle.
 */

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  /** A stable machine-readable string. Branch on this, never on `message`. */
  readonly code: string;
  /** An issue array on `VALIDATION_ERROR`; endpoint-specific payloads elsewhere. */
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

/** Convert an `ApiError` into the response a route error boundary renders. */
export function throwAsRouteError(error: unknown): never {
  if (error instanceof Response) throw error;
  if (error instanceof ApiError && [403, 404].includes(error.status)) {
    throw new Response(error.message, {
      status: error.status,
      statusText: error.message,
    });
  }
  throw error;
}

/**
 * What to put in front of someone on a signed-out page. Only the codes these
 * five endpoints actually return; everything else falls back to the API's own
 * message, which is written for people rather than for logs.
 */
export function describeAuthError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Something went wrong. Try again.";
  }

  switch (error.code) {
    case "NETWORK_ERROR":
      return error.message;
    case "INVALID_CREDENTIALS":
      // The pair is wrong, not the username — pinning it to one field misleads.
      return "That username and password do not match.";
    case "INVALID_OTP":
      return "That code is wrong or has expired. Request a new one.";
    case "OTP_COOLDOWN":
      return "A code was just sent. Wait a minute before asking for another.";
    case "INVALID_REFRESH_TOKEN":
      return "Your session ended. Sign in again.";
    default:
      break;
  }

  if (error.status === 429) {
    return "Too many attempts. Wait a moment and try again.";
  }
  if (error.status === 502 || error.status === 503) {
    return "The server is unavailable right now. Try again shortly.";
  }
  return error.message;
}
