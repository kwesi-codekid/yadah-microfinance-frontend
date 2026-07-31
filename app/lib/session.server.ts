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

/**
 * How long a session survives with no activity.
 *
 * This — not token expiry — is what signs a user out. Access tokens last ~15
 * minutes and are renewed underneath the user for as long as they keep working
 * (see `withAuth`); the only thing that ends a session is going quiet for this
 * long. Change this one number to make the app more or less patient.
 */
const IDLE_TIMEOUT_SECONDS = 60 * 60 * 2; // 2 hours

/**
 * How stale `lastActiveAt` is allowed to get before a request rewrites it.
 *
 * Sliding the window on literally every request would put a `Set-Cookie` on
 * every response, and two loaders answering the same navigation would each
 * write back the tokens they read — the one that renewed nothing overwriting
 * the one that did. Touching it every few minutes keeps a two-hour window
 * comfortably alive while leaving most responses to carry no cookie at all.
 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How long a spent refresh token keeps resolving to what it was traded for.
 *
 * Refresh tokens are single-use, and more than one request can arrive holding
 * the same one: loaders for a navigation run in parallel, and an action plus
 * the loaders revalidating after it all read the *same* inbound cookie. Without
 * this, the first to renew wins and every other one is told its token is spent
 * — which looks exactly like an expired session and signed the user out
 * mid-work. Here they all get the same new pair instead.
 *
 * Process-local and short-lived by design: it is a coalescing window, not a
 * token store. Across a restart or a second instance the worst case is the old
 * behaviour, one renewal losing a race.
 */
const REFRESH_REPLAY_MS = 2 * 60 * 1000;

/**
 * Where a user carrying `mustChangePassword` is held until they replace it.
 * Named here because two things have to agree on it: the guard that redirects
 * to it, and the route that must not redirect to itself.
 */
export const CHANGE_PASSWORD_PATH = "/change-password";

/** Where the OTP code is entered, once a code has been requested. */
export const VERIFY_OTP_PATH = "/login/verify";

type SessionData = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  /**
   * The number a login OTP was just sent to, held between `/login` and
   * `/login/verify`.
   *
   * In the cookie rather than the URL on purpose. A phone number in a query
   * string ends up in browser history, `Referer` headers and access logs, and
   * it would let anyone open the verify page against a number they picked —
   * turning it into a free oracle for guessing codes. Here it is signed,
   * httpOnly, and can only have been put there by a request this app served.
   */
  pendingOtpPhone: string;
  /** Where that sign-in was headed before the OTP interrupted it. */
  pendingOtpRedirectTo: string;
  /**
   * Epoch ms of the last request this session made, to within
   * `TOUCH_INTERVAL_MS`. The idle timeout is measured from here.
   *
   * Kept server-side-authoritative rather than left to the cookie's `Max-Age`:
   * expiry the browser enforces is expiry the client can decline to enforce, by
   * simply continuing to send a cookie it was told to drop. The `Max-Age` below
   * is the courtesy copy; this is the one that decides.
   */
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

/**
 * Has this session been quiet for longer than we allow?
 *
 * A session with no `lastActiveAt` was minted before the field existed; it is
 * treated as active and stamped on its next request rather than being cut off
 * mid-use for having been issued too early.
 */
function isIdle(session: Session<SessionData>): boolean {
  const lastActiveAt = session.get("lastActiveAt");
  if (typeof lastActiveAt !== "number") return false;
  return Date.now() - lastActiveAt > IDLE_TIMEOUT_SECONDS * 1000;
}

/**
 * Mark the session used. Returns whether anything changed — the caller only
 * needs to commit if it did.
 */
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

/**
 * Persist a fresh authenticated session and redirect. Use after a successful
 * login / OTP verification.
 *
 * A user whose password an admin has reset lands on `/change-password` instead
 * of wherever they were headed, with that destination carried in `?redirectTo`
 * so they arrive there once they're done. They would be sent straight back by
 * `requireUser` anyway; going there directly saves the bounce.
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
  session.set("lastActiveAt", Date.now());
  const destination = user.mustChangePassword
    ? `${CHANGE_PASSWORD_PATH}?${new URLSearchParams({ redirectTo })}`
    : redirectTo;
  return redirect(destination, {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

/**
 * Remember which number a code was sent to and move to the verify step.
 *
 * Called after `POST /auth/otp/request` succeeds. The pending number is the
 * only thing that makes `/login/verify` reachable, so requesting a code is the
 * one way in — there is no verify page to land on cold.
 */
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

/**
 * Drop the pending number and go back to `/login` — "use a different number".
 *
 * Cleared rather than left to expire so the verify page stops being reachable
 * the moment its number is abandoned. A successful sign-in needs no equivalent:
 * `createUserSession` mints a fresh cookie, and this value doesn't survive it.
 */
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

/**
 * Require an authenticated user or redirect to /login, preserving the
 * originally requested URL in `?redirectTo`.
 *
 * Also the gate on `mustChangePassword`. An admin who resets a staff password
 * knows that password, so a session running on it is a credential two people
 * hold; the API flags it and expects the frontend to force the change. Enforced
 * here rather than in a layout because every authenticated route already calls
 * this, so there is no page that can be reached around it — including the ones
 * that would otherwise let someone work all day on the reset password.
 *
 * `/change-password` is the one exemption, or the guard would redirect to
 * itself. `/logout` never calls this, so signing out stays available.
 *
 * Also where an idle session ends. The cookie is destroyed on the way out
 * rather than left to lapse, so the next request arrives clean instead of
 * carrying credentials this app has already stopped honouring.
 */
export async function requireUser(request: Request): Promise<AuthUser> {
  const session = await getSession(request);
  const user = isIdle(session) ? null : session.get("user");
  if (!user) throw await loginRedirect(request, session);

  const url = new URL(request.url);
  if (user.mustChangePassword && url.pathname !== CHANGE_PASSWORD_PATH) {
    const params = new URLSearchParams({
      redirectTo: url.pathname + url.search,
    });
    throw redirect(`${CHANGE_PASSWORD_PATH}?${params}`);
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
 * 401s that are the endpoint rejecting a *credential the user just typed*, not
 * the app presenting a stale access token.
 *
 * By status alone the two are identical, and renewing on the wrong one is what
 * turns a mistyped password into a sign-out: the refresh token is spent, the
 * call is retried, the password is still wrong, and the second 401 reads as a
 * dead session. These say plainly that nothing needs renewing.
 */
const CREDENTIAL_401_CODES = new Set(["INVALID_CREDENTIALS", "INVALID_OTP"]);

const isExpiredAccessToken = (error: unknown) =>
  error instanceof ApiError &&
  error.status === 401 &&
  !CREDENTIAL_401_CODES.has(error.code);

/**
 * A refresh that failed because the token itself is no good — expired, revoked,
 * or already spent by someone we can't account for. That, and only that, ends
 * the session.
 *
 * A refresh that failed because the API was briefly unreachable says nothing
 * about whether the user is still signed in, and signing them out over a dropped
 * connection is the sharpest version of the bug this whole file guards against.
 * `apiFetch` reports those as status 0 / `NETWORK_ERROR`, so they fall through
 * here and surface as an error page the user can retry from — with their
 * session intact.
 */
const isRejectedRefresh = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);

/** In-flight and recently-completed renewals, keyed by the token spent. */
const refreshesInFlight = new Map<
  string,
  { tokens: Promise<AuthTokens>; expiresAt: number }
>();

/**
 * Trade a refresh token for a new pair, giving every caller holding the same
 * token the same answer for `REFRESH_REPLAY_MS`.
 *
 * This is what makes the single-use rotation survive a request fan-out. It also
 * quietly repairs sessions whose rotation was lost — a response whose
 * `Set-Cookie` was overwritten by a sibling loader, or a call that threw after
 * its token had already been renewed — because the stale cookie they left
 * behind still maps to the pair that replaced it.
 *
 * Failures are evicted immediately: a rejected token must not be cached as a
 * verdict, or a single blip would keep answering for two minutes.
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

/**
 * The handle `withAuth` gives its callback for writing back to the session it
 * is already holding.
 *
 * It exists for exactly one case: an API call that changes the signed-in user's
 * own record, where the copy in the cookie is now stale. Committing that from
 * the outside would mean re-reading the cookie off the request — which still
 * carries the *pre-refresh* tokens — and writing it back over the rotated pair
 * `withAuth` just obtained, revoking the session at its next renewal. Same
 * session object, one commit, no lost rotation.
 */
export interface AuthSessionHandle {
  /** Replace the stored user. The commit is `withAuth`'s to make. */
  setUser: (user: AuthUser) => void;
}

/**
 * Run an authenticated API call, renewing the access token if it has expired.
 *
 * Access tokens last ~15 minutes; a session lasts until its holder goes quiet
 * for `IDLE_TIMEOUT_SECONDS`. Bridging those two is this function's whole job.
 * Someone working steadily should never see a login screen — their token is
 * traded for a fresh one underneath the request they made, and they stay on the
 * page. On a 401 we renew, retry once, and hand back a `Set-Cookie` alongside
 * the result.
 *
 * Only three things end a session here, and none of them is "a token expired":
 * the API rejecting the refresh token outright, a 401 on a token minted seconds
 * ago (the account was disabled), and the idle check above. A renewal that
 * failed because the network dropped leaves the session alone.
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
  call: (accessToken: string, session: AuthSessionHandle) => Promise<T>,
): Promise<{ data: T; headers?: { "Set-Cookie": string } }> {
  const session = await getSession(request);
  if (isIdle(session)) throw await loginRedirect(request, session);

  const accessToken = session.get("accessToken");
  const refreshToken = session.get("refreshToken");

  if (!accessToken) throw await loginRedirect(request, session);

  // This request is the activity the idle timeout is measured against. Throttled
  // to `TOUCH_INTERVAL_MS`, so most requests still answer with no cookie at all.
  const touched = touch(session);

  // Set when the callback rewrites the stored user, so a call that renewed no
  // token still gets its `Set-Cookie`. Callbacks that don't touch it — which is
  // all of them but the password change — cost nothing.
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

    // A 401 on a token minted seconds ago isn't an expiry — the account was
    // disabled or its access pulled. Nothing left to renew.
    let result: T;
    try {
      result = await call(tokens.accessToken, handle);
    } catch (retryError) {
      if (isUnauthorized(retryError)) throw await loginRedirect(request, session);
      // The rotation must not be lost: the token in the caller's cookie is
      // spent, and a session still carrying it is one failed renewal from a
      // sign-out. A thrown response can carry the new pair out; anything else
      // relies on `renewTokens` replaying it to the next request.
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

/**
 * Best-effort logout: revoke the refresh session server-side, then destroy the
 * cookie and redirect to /login. A failed API revoke still clears the cookie.
 */
export async function logout(request: Request) {
  const session = await getSession(request);
  const refreshToken = session.get("refreshToken");
  if (refreshToken) {
    // Forget any renewal this token is still standing in for, or a request that
    // raced the sign-out could be handed a live pair after the user asked to be
    // signed out.
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
