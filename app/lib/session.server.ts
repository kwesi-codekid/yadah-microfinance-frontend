import { createCookieSessionStorage, redirect, type Session } from "react-router";
import type { AuthTokens, AuthUser } from "~/lib/auth-client";
import * as authApi from "~/lib/api/auth";
import { ApiError } from "~/lib/api/client";
import { env } from "~/lib/env.server";

/**
 * Server-side session: an httpOnly, signed cookie holding the authenticated
 * user and their tokens. Tokens never reach client JavaScript — loaders and
 * actions read them here and attach the Bearer token when calling the API.
 */

const THIRTY_DAYS = 60 * 60 * 24 * 30;

type SessionData = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
};

const storage = createCookieSessionStorage<SessionData>({
  cookie: {
    name: "__yadah_session",
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    secrets: [env.sessionSecret],
    maxAge: THIRTY_DAYS,
  },
});

function getSession(request: Request) {
  return storage.getSession(request.headers.get("Cookie"));
}

/**
 * Persist a fresh authenticated session and redirect. Use after a successful
 * login / OTP verification.
 */
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
  return redirect(redirectTo, {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

/** The signed-in user, or null. */
export async function getOptionalUser(
  request: Request,
): Promise<AuthUser | null> {
  const session = await getSession(request);
  return session.get("user") ?? null;
}

/**
 * Require an authenticated user or redirect to /login, preserving the
 * originally requested URL in `?redirectTo`.
 */
export async function requireUser(request: Request): Promise<AuthUser> {
  const user = await getOptionalUser(request);
  if (!user) {
    const url = new URL(request.url);
    const redirectTo = url.pathname + url.search;
    const params = new URLSearchParams({ redirectTo });
    throw redirect(`/login?${params}`);
  }
  return user;
}

/**
 * Require an office role — admin or manager. Collectors are field staff: they
 * can read what they're assigned but can't register or edit records.
 *
 * A signed-in user who simply lacks the role is bounced to the dashboard rather
 * than to /login: they are authenticated, so a login form would be a dead end.
 */
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
  const params = new URLSearchParams({
    redirectTo: url.pathname + url.search,
  });
  return redirect(`/login?${params}`, {
    headers: { "Set-Cookie": await storage.destroySession(session) },
  });
}

const isUnauthorized = (error: unknown) =>
  error instanceof ApiError && error.status === 401;

/**
 * Run an authenticated API call, renewing the access token if it has expired.
 *
 * Access tokens last ~15 minutes while the session cookie lasts 30 days, so
 * without this every loader would start throwing 401s a quarter-hour after
 * sign-in. On a 401 we spend the refresh token, retry once, and hand back a
 * `Set-Cookie` alongside the result; if the refresh itself is rejected the
 * session is genuinely over and the user goes to /login.
 *
 * Callers must forward the returned `headers` on their response:
 *
 *     const { data: result, headers } = await withAuth(request, (token) =>
 *       usersApi.listUsers(token, query),
 *     );
 *     return data({ result }, { headers });
 *
 * Dropping them loses the rotated refresh token — the API issues single-use
 * refresh tokens, so the one in the old cookie is already revoked and the next
 * renewal would fail. For the same reason `call` may run twice: only ever pass
 * a request the API rejected outright, never one that may have partly applied.
 */
export async function withAuth<T>(
  request: Request,
  call: (accessToken: string) => Promise<T>,
): Promise<{ data: T; headers?: { "Set-Cookie": string } }> {
  const session = await getSession(request);
  const accessToken = session.get("accessToken");
  const refreshToken = session.get("refreshToken");

  if (!accessToken) throw await loginRedirect(request, session);

  try {
    return { data: await call(accessToken) };
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
    if (!refreshToken) throw await loginRedirect(request, session);

    let tokens: AuthTokens;
    try {
      ({ tokens } = await authApi.refresh({ refreshToken }));
    } catch {
      // Refresh token expired, revoked, or already spent — start over.
      throw await loginRedirect(request, session);
    }

    session.set("accessToken", tokens.accessToken);
    session.set("refreshToken", tokens.refreshToken);

    // A 401 on a token minted seconds ago isn't an expiry — the account was
    // disabled or its access pulled. Nothing left to renew.
    let result: T;
    try {
      result = await call(tokens.accessToken);
    } catch (retryError) {
      if (isUnauthorized(retryError)) throw await loginRedirect(request, session);
      throw retryError;
    }

    return {
      data: result,
      headers: { "Set-Cookie": await storage.commitSession(session) },
    };
  }
}

/**
 * Best-effort logout: revoke the refresh session server-side, then destroy the
 * cookie and redirect to /login. A failed API revoke still clears the cookie.
 */
export async function logout(request: Request) {
  const session = await getSession(request);
  const refreshToken = session.get("refreshToken");
  if (refreshToken) {
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
