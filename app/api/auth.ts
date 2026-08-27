import { apiFetch } from "~/api/client";
import type { AuthTokens, AuthUser } from "~/lib/auth";

/** The nine `/auth` endpoints. */

export interface AuthSession {
  user: AuthUser;
  tokens: AuthTokens;
}

/** POST /auth/login */
export function login(input: {
  username: string;
  password: string;
}): Promise<AuthSession> {
  return apiFetch("/auth/login", { method: "POST", json: input });
}

/**
 * POST /auth/otp/request — a 6-digit code by SMS. 5-minute expiry, 5 verify
 * attempts, 60s resend cooldown. The response is identical whether or not the
 * number is registered, so the UI must not imply the account exists.
 */
export function requestOtp(input: { phone: string }): Promise<{ message?: string }> {
  return apiFetch("/auth/otp/request", { method: "POST", json: input });
}

/** POST /auth/otp/verify */
export function verifyOtp(input: {
  phone: string;
  code: string;
}): Promise<AuthSession> {
  return apiFetch("/auth/otp/verify", { method: "POST", json: input });
}

/** POST /auth/refresh — spends the refresh token and issues a new pair. */
export function refresh(input: {
  refreshToken: string;
}): Promise<{ tokens: AuthTokens }> {
  return apiFetch("/auth/refresh", { method: "POST", json: input });
}

/** POST /auth/logout — revokes the refresh session. */
export function logout(input: { refreshToken: string }): Promise<void> {
  return apiFetch("/auth/logout", { method: "POST", json: input });
}

/** GET /auth/me */
export function me(accessToken: string): Promise<{ user: AuthUser }> {
  return apiFetch("/auth/me", { accessToken });
}

/** POST /auth/password/change — revokes every *other* session. */
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

/** POST /auth/password/forgot — same non-disclosure rule as the login OTP. */
export function forgotPassword(input: { phone: string }): Promise<void> {
  return apiFetch("/auth/password/forgot", { method: "POST", json: input });
}

/** POST /auth/password/reset — spends the code and revokes *all* sessions. */
export function resetPassword(input: {
  phone: string;
  code: string;
  newPassword: string;
}): Promise<void> {
  return apiFetch("/auth/password/reset", { method: "POST", json: input });
}
