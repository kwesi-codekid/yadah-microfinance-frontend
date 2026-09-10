/**
 * Staff types and display constants shared by the server and the browser.
 * Nothing here may import a `.server` module or the API client — it is bundled
 * into the client. The fetch functions live in `~/api/users`.
 *
 * The role vocabulary itself lives in `~/lib/auth`, because the signed-in user
 * carries it too; this module is only about managing other people's accounts.
 */

import type { AuthUser, Role } from "~/lib/auth";

/**
 * A staff account, as `GET /users` returns it. The API's `PublicUser` is the
 * same shape the session carries, so it is reused rather than restated.
 */
export type Staff = AuthUser;

/**
 * Disabled is the API's word for a switched-off account, and it is not the
 * customers' `inactive` — a disabled staffer loses every session immediately,
 * where an inactive customer merely cannot be edited.
 */
export type StaffStatus = "active" | "disabled";

/**
 * `PublicUser` carries no status, so a row's own state cannot be read off it.
 * The listing resolves it from the disabled set instead — and says so, rather
 * than guessing, when that set is too large to have been read whole.
 */
export type ResolvedStatus = StaffStatus | "unknown";

/**
 * What the listing and the detail page hand back from a disable, an enable or
 * a password reset. Shared so the dialog that fires them can be typed against
 * it without importing a route module.
 */
export interface StaffActionResult {
  ok: boolean;
  message: string;
}

export const STAFF_STATUS_LABELS: Record<StaffStatus, string> = {
  active: "Active",
  disabled: "Disabled",
};

/** What each role may do, in one line — shown beside the role picker. */
export const ROLE_BLURBS: Record<Role, string> = {
  admin: "Everything, plus staff accounts and the worker reports.",
  manager: "The whole office: customers, accounts, loans, reports.",
  teller: "The counter: money in and out, and opening accounts. Decides nothing.",
  collector: "The field: susu rounds and savings deposits only.",
};

/** Usernames are lower-case, and the API rejects anything else outright. */
export const USERNAME_RE = /^[a-z0-9._-]+$/;
export const USERNAME_HINT =
  "Lower-case letters, digits, dot, dash and underscore. 3–30 characters.";

/** The API's own floor. Stated here so the form and the reset dialog agree. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** Null when the username suits the API, otherwise the message to show. */
export function checkUsername(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length < 3) return "Usernames are at least 3 characters.";
  if (v.length > 30) return "Usernames are at most 30 characters.";
  if (!USERNAME_RE.test(v)) return USERNAME_HINT;
  return null;
}

/** Null when the password suits the API, otherwise the message to show. */
export function checkPassword(value: string): string | null {
  if (!value) return null;
  if (value.length < PASSWORD_MIN) {
    return `Passwords are at least ${PASSWORD_MIN} characters.`;
  }
  if (value.length > PASSWORD_MAX) {
    return `Passwords are at most ${PASSWORD_MAX} characters.`;
  }
  return null;
}

/** The body of POST /users. Optionals are omitted when blank. */
export interface CreateStaffInput {
  name: string;
  username: string;
  phone: string;
  role: Role;
  password: string;
  email?: string;
}

/**
 * The body of PATCH /users/{id}. The username is deliberately absent: the API
 * has no way to change one, and the password has an endpoint of its own.
 */
export interface UpdateStaffInput {
  name?: string;
  phone?: string;
  email?: string;
  role?: Role;
}

/**
 * A password an admin can read down a phone line: no look-alike characters, and
 * long enough to clear the API's floor with room to spare. It is set once and
 * handed over, so it has to survive being spoken aloud.
 */
export function suggestPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}
