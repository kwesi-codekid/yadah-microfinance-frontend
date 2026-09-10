/**
 * The one place the staff form is turned into an API body. Creating (`POST`)
 * and editing (`PATCH`) post the same field names where they overlap, so they
 * share this parser rather than drifting apart field by field.
 *
 * Client-safe: it touches `FormData` and nothing else.
 */

import { ROLES, type Role } from "~/lib/auth";
import type { CreateStaffInput, Staff, UpdateStaffInput } from "~/lib/staff";

/**
 * Built from the one list of roles rather than a second copy of it. A copy
 * here once went stale, and because an unrecognised role used to fall back to
 * "collector", picking the new role saved the old one without a word.
 */
const KNOWN_ROLES = new Set<Role>(ROLES);

function asRole(value?: string): Role | undefined {
  return value && KNOWN_ROLES.has(value as Role) ? (value as Role) : undefined;
}

/**
 * Every field the form submits, as one object. Blank fields become `undefined`
 * so they are omitted from the body — the API rejects empty strings against its
 * `minLength` rules, and there is no documented way to clear an optional field.
 *
 * Nothing is upper-cased here, unlike the customer form: a staff name is a
 * person's own name on their own account, and the username must be lower-case
 * or the API refuses it.
 */
export function parseStaffForm(form: FormData): CreateStaffInput {
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };

  return {
    name: get("name") ?? "",
    username: get("username")?.toLowerCase() ?? "",
    phone: get("phone") ?? "",
    // Left empty when it is not a role we know, the way the text fields above
    // are: `missingRequired` then refuses the form instead of quietly saving
    // somebody as something they were not chosen to be.
    role: asRole(get("role")) as Role,
    password: get("password") ?? "",
    email: get("email"),
  };
}

/** The five fields `POST /users` insists on, in the order the form shows them. */
export function missingRequired(input: CreateStaffInput): boolean {
  return (
    !input.name ||
    !input.username ||
    !input.phone ||
    !input.role ||
    !input.password
  );
}

/**
 * The `PATCH` body for an edit: only what actually changed. Resending an
 * unchanged phone would have the API check it for uniqueness against every
 * *other* account, and resending an unchanged role would revoke every one of
 * that user's sessions for nothing. Returns an empty object when nothing moved.
 */
export function diffStaff(current: Staff, next: CreateStaffInput): UpdateStaffInput {
  const patch: UpdateStaffInput = {};

  if (next.name && next.name !== current.name) patch.name = next.name;
  if (next.phone && next.phone !== current.phone) patch.phone = next.phone;
  if (next.email && next.email !== current.email) patch.email = next.email;
  if (next.role && next.role !== current.role) patch.role = next.role;

  return patch;
}

/** True when the patch would move this user off the role they hold now. */
export function changesRole(patch: UpdateStaffInput): boolean {
  return patch.role !== undefined;
}
