import type { AuthTokens, AuthUser } from "~/lib/auth-client";
import { apiFetch } from "~/lib/api/client";

/**
 * Auth endpoint wrappers, one per operation in the `Auth` tag of the spec.
 * Each returns the parsed success body; failures throw `ApiError`.
 */

interface Session {
  user: AuthUser;
  tokens: AuthTokens;
}

/** POST /auth/login */
export function login(input: {
  username: string;
  password: string;
}): Promise<Session> {
  return apiFetch<Session>("/auth/login", { method: "POST", json: input });
}

/** POST /auth/otp/request */
export function requestOtp(input: {
  phone: string;
}): Promise<{ message: string }> {
  return apiFetch("/auth/otp/request", { method: "POST", json: input });
}

/** POST /auth/otp/verify */
export function verifyOtp(input: {
  phone: string;
  code: string;
}): Promise<Session> {
  return apiFetch<Session>("/auth/otp/verify", { method: "POST", json: input });
}

/** POST /auth/refresh — rotates the refresh token. */
export function refresh(input: {
  refreshToken: string;
}): Promise<{ tokens: AuthTokens }> {
  return apiFetch("/auth/refresh", { method: "POST", json: input });
}

/** POST /auth/logout — revokes the refresh session. Returns 204. */
export function logout(input: { refreshToken: string }): Promise<void> {
  return apiFetch("/auth/logout", { method: "POST", json: input });
}

/** GET /auth/me — current authenticated user. */
export function me(accessToken: string): Promise<{ user: AuthUser }> {
  return apiFetch("/auth/me", { accessToken });
}

/**
 * POST /auth/password/change — change your own password. Returns 204.
 *
 * Clears `mustChangePassword`, and revokes every *other* session: the one
 * making the change survives, so the caller is not signing themselves out.
 *
 * 401 `INVALID_CREDENTIALS` means the current password was wrong — not that the
 * access token expired, which is the other thing a 401 means on a Bearer
 * endpoint. Anything retrying a 401 by refreshing the token has to tell the two
 * apart by `code`, or a typo logs the user out.
 */
export function changePassword(
  accessToken: string,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  return apiFetch("/auth/password/change", {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * POST /auth/password/forgot — request a reset OTP by phone.
 *
 * Answers 200 whether or not the number belongs to anyone: an endpoint that
 * said "no such user" would confirm which numbers are registered. Shares the
 * login OTP's cooldown, so 429 `OTP_COOLDOWN` is the one failure to expect.
 */
export function forgotPassword(input: {
  phone: string;
}): Promise<{ message: string }> {
  return apiFetch("/auth/password/forgot", { method: "POST", json: input });
}

/**
 * POST /auth/password/reset — set a new password with the OTP. Returns 204.
 *
 * Revokes *all* sessions, this one included — unlike `changePassword`, there is
 * no signed-in session to preserve. The user signs in again with the new
 * password. 401 `INVALID_OTP` for a wrong, expired, or already-spent code.
 */
export function resetPassword(input: {
  phone: string;
  code: string;
  newPassword: string;
}): Promise<void> {
  return apiFetch("/auth/password/reset", { method: "POST", json: input });
}
