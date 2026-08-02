import type { AuthTokens, AuthUser } from "~/lib/auth-client";
import { apiFetch } from "~/lib/api/client";

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

export function forgotPassword(input: {
  phone: string;
}): Promise<{ message: string }> {
  return apiFetch("/auth/password/forgot", { method: "POST", json: input });
}

export function resetPassword(input: {
  phone: string;
  code: string;
  newPassword: string;
}): Promise<void> {
  return apiFetch("/auth/password/reset", { method: "POST", json: input });
}
