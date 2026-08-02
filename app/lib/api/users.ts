import type { AuthUser, Role } from "~/lib/auth-client";
import { apiFetch } from "~/lib/api/client";

export interface UserListResult {
  items: AuthUser[];
  page: number;
  limit: number;
  total: number;
}

export interface ListUsersParams {
  page?: number;
  limit?: number;
  role?: Role;
  status?: "active" | "disabled";
  search?: string;
}

/** GET /users */
export function listUsers(
  accessToken: string,
  params: ListUsersParams = {},
): Promise<UserListResult> {
  const q = new URLSearchParams();
  if (params.page) q.set("page", String(params.page));
  if (params.limit) q.set("limit", String(params.limit));
  if (params.role) q.set("role", params.role);
  if (params.status) q.set("status", params.status);
  if (params.search) q.set("search", params.search);
  const qs = q.toString();
  return apiFetch<UserListResult>(`/users${qs ? `?${qs}` : ""}`, { accessToken });
}

/** GET /users/{id} */
export function getUser(
  accessToken: string,
  id: string,
): Promise<{ user: AuthUser }> {
  return apiFetch(`/users/${id}`, { accessToken });
}

export interface CreateUserInput {
  name: string;
  username: string;
  phone: string;
  email?: string;
  role: Role;
  password: string;
}

/** POST /users (admin only) */
export function createUser(
  accessToken: string,
  input: CreateUserInput,
): Promise<{ user: AuthUser }> {
  return apiFetch("/users", { method: "POST", json: input, accessToken });
}

export interface UpdateUserInput {
  name?: string;
  phone?: string;
  email?: string;
  role?: Role;
}

/** PATCH /users/{id} (admin only) */
export function updateUser(
  accessToken: string,
  id: string,
  input: UpdateUserInput,
): Promise<{ user: AuthUser }> {
  return apiFetch(`/users/${id}`, { method: "PATCH", json: input, accessToken });
}

/** POST /users/{id}/reset-password (admin only) */
export function resetUserPassword(
  accessToken: string,
  id: string,
  input: { newPassword: string; mustChangePassword?: boolean },
): Promise<unknown> {
  return apiFetch(`/users/${id}/reset-password`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/** POST /users/{id}/disable (admin only) */
export function disableUser(
  accessToken: string,
  id: string,
): Promise<{ user: AuthUser }> {
  return apiFetch(`/users/${id}/disable`, { method: "POST", accessToken });
}

/** POST /users/{id}/enable (admin only) */
export function enableUser(
  accessToken: string,
  id: string,
): Promise<{ user: AuthUser }> {
  return apiFetch(`/users/${id}/enable`, { method: "POST", accessToken });
}
