import { createCookieSessionStorage, redirect, type Session } from "react-router";

import { ApiError } from "~/api/error";
import * as portalApi from "~/api/portal";
import { env } from "~/lib/env.server";
import { PORTAL_HOME, PORTAL_LOGIN_PATH, PORTAL_VERIFY_PATH } from "~/lib/paths";
import type { PortalProfile, PortalTokens } from "~/lib/portal";

/**
 * The customer's session — a second cookie, entirely apart from the staff
 * one, because the two token families are different and a customer must
 * never be mistaken for staff or the other way round. The shape mirrors
 * `session.server.ts`: tokens in an httpOnly cookie, every call through
 * `withPortalAuth`, and one refresh at a time per spent token.
 */

/** Signed out after this long without a request. */
const IDLE_TIMEOUT_SECONDS = 60 * 60;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const REFRESH_REPLAY_MS = 2 * 60 * 1000;
const DATA_SUFFIX = ".data";
const MAX_REDIRECT_LENGTH = 512;

type PortalSessionData = {
  customer: PortalProfile;
  accessToken: string;
  refreshToken: string;
  pendingOtpPhone: string;
  pendingOtpRedirectTo: string;
  lastActiveAt: number;
};

const storage = createCookieSessionStorage<PortalSessionData>({
  cookie: {
    name: `${env.sessionCookieName}_portal`,
    httpOnly: true,
    secure: env.sessionCookieSecure,
    sameSite: "lax",
    path: "/portal",
    domain: env.sessionCookieDomain,
    secrets: [env.sessionSecret, env.sessionSecretPrevious].filter(Boolean),
    maxAge: IDLE_TIMEOUT_SECONDS,
  },
});

function getSession(request: Request) {
  return storage.getSession(request.headers.get("Cookie"));
}

function isIdle(session: Session<PortalSessionData>): boolean {
  const at = session.get("lastActiveAt");
  return typeof at === "number" && Date.now() - at > IDLE_TIMEOUT_SECONDS * 1000;
}

function touch(session: Session<PortalSessionData>): boolean {
  const at = session.get("lastActiveAt");
  if (typeof at === "number" && Date.now() - at < TOUCH_INTERVAL_MS) return false;
  session.set("lastActiveAt", Date.now());
  return true;
}

function pagePath(url: URL): string {
  if (!url.pathname.endsWith(DATA_SUFFIX)) return url.pathname;
  return url.pathname.slice(0, -DATA_SUFFIX.length) || "/";
}

/** Only paths inside the portal are safe places to send a customer. */
export function safePortalRedirect(value: FormDataEntryValue | string | null): string {
  if (typeof value !== "string") return PORTAL_HOME;
  if (!value.startsWith("/portal") || value.startsWith("//")) return PORTAL_HOME;
  if (value.length > MAX_REDIRECT_LENGTH) return PORTAL_HOME;
  if (value.split("?")[0].endsWith(DATA_SUFFIX)) return PORTAL_HOME;
  return value;
}

function returnTo(url: URL): string {
  const search = new URLSearchParams(url.search);
  search.delete("_routes");
  const qs = search.toString();
  return safePortalRedirect(`${pagePath(url)}${qs ? `?${qs}` : ""}`);
}

/* ----------------------------------------------------------------- start --- */

export async function startPortalOtp(
  request: Request,
  { phone, redirectTo }: { phone: string; redirectTo: string },
) {
  const session = await getSession(request);
  session.set("pendingOtpPhone", phone);
  session.set("pendingOtpRedirectTo", safePortalRedirect(redirectTo));
  return redirect(PORTAL_VERIFY_PATH, {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

export async function getPendingPortalOtp(
  request: Request,
): Promise<{ phone: string; redirectTo: string } | null> {
  const session = await getSession(request);
  const phone = session.get("pendingOtpPhone");
  if (!phone) return null;
  return { phone, redirectTo: session.get("pendingOtpRedirectTo") ?? PORTAL_HOME };
}

export async function cancelPortalOtp(request: Request) {
  const session = await getSession(request);
  session.unset("pendingOtpPhone");
  session.unset("pendingOtpRedirectTo");
  return redirect(PORTAL_LOGIN_PATH, {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

export async function createPortalSession({
  customer,
  tokens,
  redirectTo,
}: {
  customer: PortalProfile;
  tokens: PortalTokens;
  redirectTo: string;
}) {
  const session = await storage.getSession();
  session.set("customer", customer);
  session.set("accessToken", tokens.accessToken);
  session.set("refreshToken", tokens.refreshToken);
  session.set("lastActiveAt", Date.now());
  return redirect(safePortalRedirect(redirectTo), {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

/* ------------------------------------------------------------------ read --- */

export async function getOptionalCustomer(request: Request): Promise<PortalProfile | null> {
  const session = await getSession(request);
  if (isIdle(session)) return null;
  return session.get("customer") ?? null;
}

export async function requireCustomer(request: Request): Promise<PortalProfile> {
  const session = await getSession(request);
  const customer = isIdle(session) ? null : session.get("customer");
  if (!customer) throw await loginRedirect(request, session);
  return customer;
}

/* ------------------------------------------------------------------ call --- */

async function loginRedirect(request: Request, session: Session<PortalSessionData>) {
  const params = new URLSearchParams({ redirectTo: returnTo(new URL(request.url)) });
  return redirect(`${PORTAL_LOGIN_PATH}?${params}`, {
    headers: { "Set-Cookie": await storage.destroySession(session) },
  });
}

const CREDENTIAL_401_CODES = new Set(["INVALID_CREDENTIALS", "INVALID_OTP"]);
const isExpiredAccessToken = (e: unknown) =>
  e instanceof ApiError && e.status === 401 && !CREDENTIAL_401_CODES.has(e.code);
const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;
const isRejectedRefresh = (e: unknown) =>
  e instanceof ApiError && (e.status === 401 || e.status === 403);

const refreshesInFlight = new Map<string, { tokens: Promise<PortalTokens>; expiresAt: number }>();

function renewTokens(refreshToken: string): Promise<PortalTokens> {
  const now = Date.now();
  const existing = refreshesInFlight.get(refreshToken);
  if (existing && existing.expiresAt > now) return existing.tokens;
  for (const [key, entry] of refreshesInFlight) if (entry.expiresAt <= now) refreshesInFlight.delete(key);
  const tokens = portalApi.refresh({ refreshToken });
  tokens.catch(() => refreshesInFlight.delete(refreshToken));
  refreshesInFlight.set(refreshToken, { tokens, expiresAt: now + REFRESH_REPLAY_MS });
  return tokens;
}

function withCookie(response: Response, cookie: string) {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Run a portal call. On an expired access token it renews once and retries;
 * anything the renewal cannot fix ends the session at the portal login.
 * Return the `headers` from your loader, or rotated tokens are lost.
 */
export async function withPortalAuth<T>(
  request: Request,
  call: (accessToken: string) => Promise<T>,
): Promise<{ data: T; headers?: { "Set-Cookie": string } }> {
  const session = await getSession(request);
  if (isIdle(session)) throw await loginRedirect(request, session);
  const accessToken = session.get("accessToken");
  const refreshToken = session.get("refreshToken");
  if (!accessToken) throw await loginRedirect(request, session);
  const touched = touch(session);

  try {
    const result = await call(accessToken);
    return touched
      ? { data: result, headers: { "Set-Cookie": await storage.commitSession(session) } }
      : { data: result };
  } catch (error) {
    if (!isExpiredAccessToken(error)) throw error;
    if (!refreshToken) throw await loginRedirect(request, session);

    let tokens: PortalTokens;
    try {
      tokens = await renewTokens(refreshToken);
    } catch (refreshError) {
      if (isRejectedRefresh(refreshError)) throw await loginRedirect(request, session);
      throw refreshError;
    }
    session.set("accessToken", tokens.accessToken);
    session.set("refreshToken", tokens.refreshToken);

    let result: T;
    try {
      result = await call(tokens.accessToken);
    } catch (retryError) {
      if (isUnauthorized(retryError)) throw await loginRedirect(request, session);
      if (retryError instanceof Response) {
        throw withCookie(retryError, await storage.commitSession(session));
      }
      throw retryError;
    }
    return { data: result, headers: { "Set-Cookie": await storage.commitSession(session) } };
  }
}

/* ------------------------------------------------------------------- end --- */

export async function portalLogout(request: Request) {
  const session = await getSession(request);
  const refreshToken = session.get("refreshToken");
  if (refreshToken) {
    refreshesInFlight.delete(refreshToken);
    try {
      await portalApi.logout({ refreshToken });
    } catch {
      // The local session is cleared either way.
    }
  }
  return redirect(PORTAL_LOGIN_PATH, {
    headers: { "Set-Cookie": await storage.destroySession(session) },
  });
}
