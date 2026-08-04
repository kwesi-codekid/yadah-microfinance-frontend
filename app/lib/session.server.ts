import { createCookieSessionStorage, redirect, type Session } from "react-router";
import type { AuthTokens, AuthUser } from "~/lib/auth-client";
import * as authApi from "~/lib/api/auth";
import { ApiError } from "~/lib/api/client";
import { env } from "~/lib/env.server";

const IDLE_TIMEOUT_SECONDS = 60 * 60 * 2; // 2 hours

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const REFRESH_REPLAY_MS = 2 * 60 * 1000;

export const CHANGE_PASSWORD_PATH = "/change-password";

/** Where the OTP code is entered, once a code has been requested. */
export const VERIFY_OTP_PATH = "/login/verify";

/** What single fetch appends when the client asks a route for data only. */
const DATA_SUFFIX = ".data";

/** Long enough for any real path; short enough that nesting can't reach 431. */
const MAX_REDIRECT_LENGTH = 512;

/**
 * The page a request belongs to. Single fetch asks for `/x.data`, which is the
 * same route as `/x` — comparing the raw pathname against a known path misses,
 * and a guard that redirects on the miss loops until the URL is too large.
 */
function pagePath(url: URL): string {
  if (!url.pathname.endsWith(DATA_SUFFIX)) return url.pathname;
  const base = url.pathname.slice(0, -DATA_SUFFIX.length);
  // `/_root.data` is the root route asking for itself.
  return base === "/_root" || base === "" ? "/" : base;
}

/**
 * Only same-origin, absolute-path page redirects — never a single-fetch URL,
 * and never one long enough to have been built by a loop.
 */
export function safeRedirect(
  value: FormDataEntryValue | string | null,
  fallback = "/dashboard",
): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.length > MAX_REDIRECT_LENGTH) return fallback;
  // A `.data` path is React Router's own resource URL, not somewhere to land.
  if (value.split("?")[0].endsWith(DATA_SUFFIX)) return fallback;
  return value;
}

/** Where to send someone back to: the page they wanted, not its data URL. */
function returnTo(url: URL): string {
  const search = new URLSearchParams(url.search);
  // Single fetch's own parameter is not part of the destination.
  search.delete("_routes");
  const qs = search.toString();
  return safeRedirect(`${pagePath(url)}${qs ? `?${qs}` : ""}`);
}

type SessionData = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  pendingOtpPhone: string;
  /** Where that sign-in was headed before the OTP interrupted it. */
  pendingOtpRedirectTo: string;
  lastActiveAt: number;
};

const storage = createCookieSessionStorage<SessionData>({
  cookie: {
    name: "__yadah_session",
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    secrets: [env.sessionSecret],
    // Re-set on every commit, so the cookie's own lifetime slides with use.
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
  const destination = user.mustChangePassword
    ? `${CHANGE_PASSWORD_PATH}?${new URLSearchParams({ redirectTo })}`
    : redirectTo;
  return redirect(destination, {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

export async function startOtpVerification(
  request: Request,
  { phone, redirectTo }: { phone: string; redirectTo: string },
) {
  const session = await getSession(request);
  session.set("pendingOtpPhone", phone);
  session.set("pendingOtpRedirectTo", redirectTo);
  return redirect(VERIFY_OTP_PATH, {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

/** The number awaiting a code, or null when no request is in flight. */
export async function getPendingOtp(
  request: Request,
): Promise<{ phone: string; redirectTo: string } | null> {
  const session = await getSession(request);
  const phone = session.get("pendingOtpPhone");
  if (!phone) return null;
  return { phone, redirectTo: session.get("pendingOtpRedirectTo") ?? "/dashboard" };
}

export async function cancelOtpVerification(request: Request) {
  const session = await getSession(request);
  session.unset("pendingOtpPhone");
  session.unset("pendingOtpRedirectTo");
  return redirect("/login", {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

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

  const url = new URL(request.url);
  if (user.mustChangePassword && pagePath(url) !== CHANGE_PASSWORD_PATH) {
    const params = new URLSearchParams({ redirectTo: returnTo(url) });
    throw redirect(`${CHANGE_PASSWORD_PATH}?${params}`);
  }

  return user;
}

export async function requireOffice(request: Request): Promise<AuthUser> {
  const user = await requireUser(request);
  if (user.role !== "admin" && user.role !== "manager") {
    throw redirect("/dashboard");
  }
  return user;
}

/** True when this user may register and edit records (admin or manager). */
export function isOffice(user: AuthUser): boolean {
  return user.role === "admin" || user.role === "manager";
}

/** Send the user to /login with a clean slate, remembering where they were. */
async function loginRedirect(request: Request, session: Session<SessionData>) {
  const url = new URL(request.url);
  const params = new URLSearchParams({ redirectTo: returnTo(url) });
  return redirect(`/login?${params}`, {
    headers: { "Set-Cookie": await storage.destroySession(session) },
  });
}

const isUnauthorized = (error: unknown) =>
  error instanceof ApiError && error.status === 401;

const CREDENTIAL_401_CODES = new Set(["INVALID_CREDENTIALS", "INVALID_OTP"]);

const isExpiredAccessToken = (error: unknown) =>
  error instanceof ApiError &&
  error.status === 401 &&
  !CREDENTIAL_401_CODES.has(error.code);

const isRejectedRefresh = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);

/** In-flight and recently-completed renewals, keyed by the token spent. */
const refreshesInFlight = new Map<
  string,
  { tokens: Promise<AuthTokens>; expiresAt: number }
>();

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
}

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
  const handle: AuthSessionHandle = {
    setUser(user) {
      session.set("user", user);
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
      if (isUnauthorized(retryError)) throw await loginRedirect(request, session);
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

export async function logout(request: Request) {
  const session = await getSession(request);
  const refreshToken = session.get("refreshToken");
  if (refreshToken) {
    refreshesInFlight.delete(refreshToken);
    try {
      await authApi.logout({ refreshToken });
    } catch {
      // Non-fatal — we still clear the local session below.
    }
  }
  return redirect("/login", {
    headers: { "Set-Cookie": await storage.destroySession(session) },
  });
}
