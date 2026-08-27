/**
 * Server-only configuration. Read from `process.env`, never bundled into the
 * client — the API base URL and the cookie secret must not leave the server.
 */

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value == null || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flag(name: string): boolean {
  const raw = process.env[name];
  return raw === "true" || raw === "1";
}

const isProduction = process.env.NODE_ENV === "production";

export const env = {
  isProduction,

  /** Includes the `/api/v1` prefix. Trailing slash stripped so paths compose. */
  apiBaseUrl: required("API_BASE_URL").replace(/\/$/, ""),
  apiTimeoutMs: integer("API_TIMEOUT_MS", 15_000),
  /**
   * Print every upstream call — method, path, status, milliseconds — to the
   * server console. What it answers is "did that click actually hit the API,
   * and how long did it hold the page up", which is otherwise invisible: the
   * browser never talks to the API directly, so its network tab shows only
   * this app's own requests. Never in production, whatever the variable says.
   */
  apiDebugLogging: flag("API_DEBUG_LOGGING") && !isProduction,

  /** A dev fallback keeps `npm run dev` working; production must supply one. */
  sessionSecret: required(
    "SESSION_SECRET",
    isProduction ? undefined : "dev-insecure-secret",
  ),
  /** Set during a secret rotation so cookies signed with the old one still verify. */
  sessionSecretPrevious: process.env.SESSION_SECRET_PREVIOUS ?? "",
  sessionCookieName: process.env.SESSION_COOKIE_NAME || "__yadah_session",
  sessionMaxAgeSeconds: integer("SESSION_MAX_AGE_SECONDS", 60 * 60 * 24 * 30),
  sessionCookieSecure:
    (process.env.SESSION_COOKIE_SECURE ?? String(isProduction)) === "true",
  sessionCookieDomain: process.env.SESSION_COOKIE_DOMAIN || undefined,
};
