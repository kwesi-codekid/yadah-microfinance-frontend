import { apiFetch, apiFetchRaw } from "~/api/client";
import type { Role } from "~/lib/auth";
import type { CreateStaffInput, Staff, StaffStatus, UpdateStaffInput } from "~/lib/staff";

/**
 * The `/users` endpoints — staff accounts. This module imports the API client,
 * so it is server-only: call it from loaders and actions. Types and display
 * constants live in the client-safe `~/lib/staff`.
 *
 * Reading is office (admin and manager); every write is admin only, and the API
 * answers a manager with `403 FORBIDDEN`. There is no delete: an account that
 * should stop working is disabled, which keeps its name on old records.
 */

/** `json` is the default; `csv` and `xlsx` come back as a binary download. */
export type ExportFormat = "csv" | "xlsx";

export interface StaffListParams {
  page?: number;
  limit?: number;
  role?: Role;
  status?: StaffStatus;
  /** Fuzzy across name, username and phone. */
  search?: string;
  /** Inclusive Accra day, `YYYY-MM-DD`, on when the account was added. */
  from?: string;
  to?: string;
}

export interface StaffListResult {
  items: Staff[];
  page: number;
  limit: number;
  total: number;
}

function queryOf(params: StaffListParams, format?: ExportFormat): string {
  const q = new URLSearchParams();
  if (params.page && params.page > 1) q.set("page", String(params.page));
  if (params.limit) q.set("limit", String(params.limit));
  if (params.role) q.set("role", params.role);
  if (params.status) q.set("status", params.status);
  if (params.search) q.set("search", params.search);
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (format) q.set("format", format);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** GET /users — paginated staff (admin, manager). */
export function listUsers(
  accessToken: string,
  params: StaffListParams = {},
): Promise<StaffListResult> {
  return apiFetch(`/users${queryOf(params)}`, { accessToken });
}

/**
 * GET /users?format=csv|xlsx — the same listing as a spreadsheet. Pagination is
 * ignored and the API caps the download at 10,000 rows, so the page/limit of
 * the on-screen listing are deliberately not forwarded.
 */
export function exportUsers(
  accessToken: string,
  params: Omit<StaffListParams, "page" | "limit">,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/users${queryOf(params, format)}`, { accessToken });
}

/** GET /users/{id} (admin, manager). */
export function getUser(
  accessToken: string,
  id: string,
): Promise<{ user: Staff }> {
  return apiFetch(`/users/${id}`, { accessToken });
}

/**
 * POST /users — create a staff account (admin). The admin sets the first
 * password and passes it on offline; the staffer changes it themselves via
 * `/auth/password/change`. Rejected with `USERNAME_TAKEN` or `PHONE_TAKEN`.
 */
export function createUser(
  accessToken: string,
  input: CreateStaffInput,
): Promise<{ user: Staff }> {
  return apiFetch("/users", { method: "POST", json: input, accessToken });
}

/**
 * PATCH /users/{id} — profile or role (admin). A role change revokes every one
 * of that user's refresh sessions, and their access token dies within fifteen
 * minutes. An admin changing their *own* role is refused with
 * `CANNOT_MODIFY_SELF`.
 */
export function updateUser(
  accessToken: string,
  id: string,
  input: UpdateStaffInput,
): Promise<{ user: Staff }> {
  return apiFetch(`/users/${id}`, { method: "PATCH", json: input, accessToken });
}

/**
 * POST /users/{id}/reset-password — set a new one and revoke every session
 * (admin). Answers `204`, so there is nothing to read back.
 */
export function resetUserPassword(
  accessToken: string,
  id: string,
  newPassword: string,
): Promise<void> {
  return apiFetch(`/users/${id}/reset-password`, {
    method: "POST",
    json: { newPassword },
    accessToken,
  });
}

/**
 * POST /users/{id}/disable — revokes every refresh session at once (admin).
 * Idempotent. An admin disabling themselves is refused with `CANNOT_MODIFY_SELF`.
 */
export function disableUser(
  accessToken: string,
  id: string,
): Promise<{ user: Staff }> {
  return apiFetch(`/users/${id}/disable`, { method: "POST", accessToken });
}

/** POST /users/{id}/enable — reverse of disable (admin). */
export function enableUser(
  accessToken: string,
  id: string,
): Promise<{ user: Staff }> {
  return apiFetch(`/users/${id}/enable`, { method: "POST", accessToken });
}
