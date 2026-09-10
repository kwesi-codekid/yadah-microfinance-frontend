import {
  createCookieSessionStorage,
  redirect,
  type Session,
} from "react-router";

import * as authApi from "~/api/auth";
import { ApiError } from "~/api/error";
import type { AuthTokens, AuthUser, Role } from "~/lib/auth";
import { env } from "~/lib/env.server";
import {
  DEFAULT_LANDING,
  LOGIN_PATH,
  RESET_PASSWORD_PATH,
  VERIFY_OTP_PATH,
} from "~/lib/paths";

/**
 * Tokens live here — in an httpOnly cookie the browser cannot read — and every
 * authenticated call goes through `withAuth`, which owns the one dangerous
 * part of this API: refresh tokens are single-use, so two parallel refreshes
 * revoke the whole session.
 */

/** Signed out after this long without a request. Slides on every commit. */
const IDLE_TIMEOUT_SECONDS = 60 * 60 * 2;

/** Don't re-sign the cookie on every single request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How long a completed refresh keeps answering for the token it spent. Two
 * loaders on the same page start within milliseconds of each other; the second
 * must be handed the first one's result, not send the spent token again.
 */
const REFRESH_REPLAY_MS = 2 * 60 * 1000;

/** How stale the stored role may get before we re-read it from the API. */
const ROLE_CHECK_INTERVAL_MS = 60 * 1000;

export {
  DEFAULT_LANDING,
  LOGIN_PATH,
  RESET_PASSWORD_PATH,
  VERIFY_OTP_PATH,
} from "~/lib/paths";

/** What single fetch appends when a route is asked for its data alone. */
const DATA_SUFFIX = ".data";

/** Long enough for any real path, short enough that a loop can't reach 431. */
const MAX_REDIRECT_LENGTH = 512;

/**
 * The page a request belongs to. Single fetch asks for `/x.data`, which is the
 * same route as `/x` — comparing the raw pathname to a known path misses, and
 * a guard that redirects on the miss loops until the URL is too large.
 */
function pagePath(url: URL): string {
  if (!url.pathname.endsWith(DATA_SUFFIX)) return url.pathname;
  const base = url.pathname.slice(0, -DATA_SUFFIX.length);
  return base === "/_root" || base === "" ? "/" : base;
}

/** Same-origin absolute page paths only — never a single-fetch data URL. */
export function safeRedirect(
  value: FormDataEntryValue | string | null,
  fallback: string = DEFAULT_LANDING,
): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.length > MAX_REDIRECT_LENGTH) return fallback;
  if (value.split("?")[0].endsWith(DATA_SUFFIX)) return fallback;
  return value;
}

/** Where to send someone back to: the page they wanted, not its data URL. */
function returnTo(url: URL): string {
  const search = new URLSearchParams(url.search);
  search.delete("_routes");
  const qs = search.toString();
  return safeRedirect(`${pagePath(url)}${qs ? `?${qs}` : ""}`);
}

type SessionData = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  /** The number awaiting a login code. */
  pendingOtpPhone: string;
  /** Where that sign-in was headed before the code interrupted it. */
  pendingOtpRedirectTo: string;
  /** The number awaiting a password-reset code. */
  pendingResetPhone: string;
  lastActiveAt: number;
  /** When the stored role was last confirmed against the API. */
  roleCheckedAt: number;
};

const storage = createCookieSessionStorage<SessionData>({
  cookie: {
    name: env.sessionCookieName,
    httpOnly: true,
    secure: env.sessionCookieSecure,
    sameSite: "lax",
    path: "/",
    domain: env.sessionCookieDomain,
    secrets: [env.sessionSecret, env.sessionSecretPrevious].filter(Boolean),
    maxAge: IDLE_TIMEOUT_SECONDS,
  },
});

function getSession(request: Request) {
  return storage.getSession(request.headers.get("Cookie"));
}

function isIdle(session: Session<SessionData>): boolean {
  const lastActiveAt = session.get("lastActiveAt");
  if (typeof lastActiveAt !== "number") return false;
  return Date.now() - lastActiveAt > IDLE_TIMEOUT_SECONDS * 1000;
}

/** Mark the session used. Returns whether that changed anything worth saving. */
function touch(session: Session<SessionData>): boolean {
  const lastActiveAt = session.get("lastActiveAt");
  if (
    typeof lastActiveAt === "number" &&
    Date.now() - lastActiveAt < TOUCH_INTERVAL_MS
  ) {
    return false;
  }
  session.set("lastActiveAt", Date.now());
  return true;
}

/* ----------------------------------------------------------------- start --- */

export async function createUserSession({
  user,
  tokens,
  redirectTo,
}: {
  user: AuthUser;
  tokens: AuthTokens;
  redirectTo: string;
}) {
  const session = await storage.getSession();
  session.set("user", user);
  session.set("accessToken", tokens.accessToken);
  session.set("refreshToken", tokens.refreshToken);
  session.set("lastActiveAt", Date.now());
  // Straight from the API, so the role is confirmed as of now.
  session.set("roleCheckedAt", Date.now());
  return redirect(safeRedirect(redirectTo), {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

export async function startOtpVerification(
  request: Request,
  { phone, redirectTo }: { phone: string; redirectTo: string },
) {
  const session = await getSession(request);
  session.set("pendingOtpPhone", phone);
  session.set("pendingOtpRedirectTo", safeRedirect(redirectTo));
  return redirect(VERIFY_OTP_PATH, {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

/** The number awaiting a login code, or null when none was requested. */
export async function getPendingOtp(
  request: Request,
): Promise<{ phone: string; redirectTo: string } | null> {
  const session = await getSession(request);
  const phone = session.get("pendingOtpPhone");
  if (!phone) return null;
  return {
    phone,
    redirectTo: session.get("pendingOtpRedirectTo") ?? DEFAULT_LANDING,
  };
}

export async function cancelOtpVerification(request: Request) {
  const session = await getSession(request);
  session.unset("pendingOtpPhone");
  session.unset("pendingOtpRedirectTo");
  return redirect(LOGIN_PATH, {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

export async function startPasswordReset(request: Request, phone: string) {
  const session = await getSession(request);
  session.set("pendingResetPhone", phone);
  return redirect(RESET_PASSWORD_PATH, {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

export async function getPendingReset(
  request: Request,
): Promise<string | null> {
  const session = await getSession(request);
  return session.get("pendingResetPhone") ?? null;
}

export async function endPasswordReset(request: Request, to: string) {
  const session = await getSession(request);
  session.unset("pendingResetPhone");
  return redirect(to, {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

/* ------------------------------------------------------------------ read --- */

/** The signed-in user, or null — including when the session has gone idle. */
export async function getOptionalUser(
  request: Request,
): Promise<AuthUser | null> {
  const session = await getSession(request);
  if (isIdle(session)) return null;
  return session.get("user") ?? null;
}

export async function requireUser(request: Request): Promise<AuthUser> {
  const session = await getSession(request);
  const user = isIdle(session) ? null : session.get("user");
  if (!user) throw await loginRedirect(request, session);
  return user;
}

/**
 * Route protection lives here, in loaders — hiding a nav item is not access
 * control. Sends the user somewhere they can be rather than showing a 403.
 */
export async function requireRole(
  request: Request,
  allowed: Role[],
): Promise<AuthUser> {
  const user = await requireUser(request);
  if (!allowed.includes(user.role)) throw redirect(DEFAULT_LANDING);
  return user;
}

/** May you decide? Approvals, the books, the trash. */
export function requireOffice(request: Request): Promise<AuthUser> {
  return requireRole(request, ["admin", "manager"]);
}

/**
 * May you serve whoever is standing here? Money in and out, opening an
 * account, registering a customer. Anything not opened to the counter stays
 * office by default, so a screen added later is closed until somebody says
 * otherwise.
 */
export function requireCounter(request: Request): Promise<AuthUser> {
  return requireRole(request, ["admin", "manager", "teller"]);
}

export function requireAdmin(request: Request): Promise<AuthUser> {
  return requireRole(request, ["admin"]);
}

/* ------------------------------------------------------------------ call --- */

/** Send the user to the login page with a clean slate, remembering the page. */
async function loginRedirect(request: Request, session: Session<SessionData>) {
  const url = new URL(request.url);
  const params = new URLSearchParams({ redirectTo: returnTo(url) });
  return redirect(`${LOGIN_PATH}?${params}`, {
    headers: { "Set-Cookie": await storage.destroySession(session) },
  });
}

const isUnauthorized = (error: unknown) =>
  error instanceof ApiError && error.status === 401;

/** A 401 carrying one of these is a bad credential, not a stale token. */
const CREDENTIAL_401_CODES = new Set(["INVALID_CREDENTIALS", "INVALID_OTP"]);

const isExpiredAccessToken = (error: unknown) =>
  error instanceof ApiError &&
  error.status === 401 &&
  !CREDENTIAL_401_CODES.has(error.code);

const isRejectedRefresh = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);

/** In-flight and recently-completed renewals, keyed by the token they spent. */
const refreshesInFlight = new Map<
  string,
  { tokens: Promise<AuthTokens>; expiresAt: number }
>();

/**
 * The refresh mutex. One renewal per spent token; everyone else awaits it.
 * Without this, concurrent loaders each POST the same single-use token and the
 * second one revokes the session.
 */
function renewTokens(refreshToken: string): Promise<AuthTokens> {
  const now = Date.now();

  const existing = refreshesInFlight.get(refreshToken);
  if (existing && existing.expiresAt > now) return existing.tokens;

  // Small map, swept as we go — nothing else runs on a timer to clear it.
  for (const [key, entry] of refreshesInFlight) {
    if (entry.expiresAt <= now) refreshesInFlight.delete(key);
  }

  const tokens = authApi.refresh({ refreshToken }).then(({ tokens }) => tokens);
  tokens.catch(() => refreshesInFlight.delete(refreshToken));
  refreshesInFlight.set(refreshToken, {
    tokens,
    expiresAt: now + REFRESH_REPLAY_MS,
  });
  return tokens;
}

/** Copy a thrown response, adding a `Set-Cookie` it would otherwise lose. */
function withCookie(response: Response, cookie: string) {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export interface AuthSessionHandle {
  /** Replace the stored user. The commit is `withAuth`'s to make. */
  setUser: (user: AuthUser) => void;
  /** True when the stored role is stale enough to be worth re-reading. */
  roleCheckDue: boolean;
  /** Record that the role was just confirmed, so later calls can skip it. */
  markRoleChecked: () => void;
}

/**
 * Run an authenticated call. On an expired access token it renews once and
 * retries; anything the renewal cannot fix ends the session at the login page.
 * Return the `headers` it hands back from your loader, or the rotated tokens
 * are never stored.
 */
export async function withAuth<T>(
  request: Request,
  call: (accessToken: string, session: AuthSessionHandle) => Promise<T>,
): Promise<{ data: T; headers?: { "Set-Cookie": string } }> {
  const session = await getSession(request);
  if (isIdle(session)) throw await loginRedirect(request, session);

  const accessToken = session.get("accessToken");
  const refreshToken = session.get("refreshToken");
  if (!accessToken) throw await loginRedirect(request, session);

  const touched = touch(session);

  let userChanged = false;
  const roleCheckedAt = session.get("roleCheckedAt");
  const handle: AuthSessionHandle = {
    setUser(user) {
      session.set("user", user);
      userChanged = true;
    },
    roleCheckDue:
      typeof roleCheckedAt !== "number" ||
      Date.now() - roleCheckedAt > ROLE_CHECK_INTERVAL_MS,
    markRoleChecked() {
      session.set("roleCheckedAt", Date.now());
      userChanged = true;
    },
  };

  try {
    const result = await call(accessToken, handle);
    return userChanged || touched
      ? {
          data: result,
          headers: { "Set-Cookie": await storage.commitSession(session) },
        }
      : { data: result };
  } catch (error) {
    if (!isExpiredAccessToken(error)) throw error;
    if (!refreshToken) throw await loginRedirect(request, session);

    let tokens: AuthTokens;
    try {
      tokens = await renewTokens(refreshToken);
    } catch (refreshError) {
      // Rejected: expired, revoked, or spent beyond the replay window. Over.
      if (isRejectedRefresh(refreshError)) {
        throw await loginRedirect(request, session);
      }
      // Unreachable, not unauthorised. The session is fine; the network isn't.
      throw refreshError;
    }

    session.set("accessToken", tokens.accessToken);
    session.set("refreshToken", tokens.refreshToken);

    let result: T;
    try {
      result = await call(tokens.accessToken, handle);
    } catch (retryError) {
      if (isUnauthorized(retryError))
        throw await loginRedirect(request, session);
      // A redirect thrown inside the call still has to carry the new tokens.
      if (retryError instanceof Response) {
        throw withCookie(retryError, await storage.commitSession(session));
      }
      throw retryError;
    }

    return {
      data: result,
      headers: { "Set-Cookie": await storage.commitSession(session) },
    };
  }
}

/* ------------------------------------------------------------------- end --- */

export async function logout(
  request: Request,
  redirectTo: string = LOGIN_PATH,
) {
  const session = await getSession(request);
  const refreshToken = session.get("refreshToken");
  if (refreshToken) {
    refreshesInFlight.delete(refreshToken);
    try {
      await authApi.logout({ refreshToken });
    } catch {
      // Non-fatal — the local session is cleared either way.
    }
  }
  return redirect(redirectTo, {
    headers: { "Set-Cookie": await storage.destroySession(session) },
  });
}

/**
 * End the session because this account's role no longer matches the one it
 * signed in under. Their permissions changed underneath them, so the page
 * they are on and the tokens they hold both have to go.
 */
export function signOutForRoleChange(request: Request) {
  return logout(request, `${LOGIN_PATH}?reason=role-changed`);
}
