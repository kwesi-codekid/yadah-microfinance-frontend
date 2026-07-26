/**
 * Server-only environment configuration.
 * Never import this from client components — it reads `process.env`.
 */

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value == null || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  /**
   * Base URL for the Yadah Microfinance API, including the /api/v1 prefix.
   * Sourced only from the environment (see .env / .env.example) — no hardcoded
   * fallback, so the endpoint is never baked into the code.
   */
  apiBaseUrl: required("API_BASE_URL").replace(/\/$/, ""),

  /**
   * Secret used to sign the session cookie. In production this MUST be set to a
   * long random value; the dev fallback exists only so `npm run dev` works.
   */
  sessionSecret: required(
    "SESSION_SECRET",
    process.env.NODE_ENV === "production" ? undefined : "dev-insecure-secret",
  ),

  isProduction: process.env.NODE_ENV === "production",
};
