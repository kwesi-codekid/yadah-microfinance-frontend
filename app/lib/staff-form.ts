/**
 * The one place the staff form is turned into an API body. Creating (`POST`)
 * and editing (`PATCH`) post the same field names where they overlap, so they
 * share this parser rather than drifting apart field by field.
 *
 * Client-safe: it touches `FormData` and nothing else.
 */

import type { Role } from "~/lib/auth";
import type { CreateStaffInput, Staff, UpdateStaffInput } from "~/lib/staff";

const ROLES = new Set<Role>(["admin", "manager", "collector"]);

function asRole(value?: string): Role | undefined {
  return value && ROLES.has(value as Role) ? (value as Role) : undefined;
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
    role: asRole(get("role")) ?? ("collector" as Role),
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
