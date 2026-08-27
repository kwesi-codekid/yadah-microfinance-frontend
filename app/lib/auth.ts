/**
 * Auth types shared by the server and the browser. Nothing in here may import
 * a `.server` module — it is bundled into the client.
 */

/** The three roles the API defines. "Office" is admin + manager. */
export type Role = "admin" | "manager" | "collector";

export const ROLES: Role[] = ["admin", "manager", "collector"];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  manager: "Manager",
  collector: "Collector",
};

/** The API's `PublicUser` schema. */
export interface AuthUser {
  id: string;
  name: string;
  username: string;
  phone: string;
  email?: string;
  role: Role;
}

/** The API's `AuthTokens` schema. */
export interface AuthTokens {
  /** JWT, ~15 minute lifetime. Sent as `Authorization: Bearer`. */
  accessToken: string;
  /** Opaque and single-use — rotated on every refresh. */
  refreshToken: string;
}

/** True when this user may register and edit records, not just collect. */
export function isOffice(user: Pick<AuthUser, "role"> | null): boolean {
  return user?.role === "admin" || user?.role === "manager";
}

/** Initials for the avatar fallback — two letters at most. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
