/**
 * Client-safe auth types, mirroring the API's `components.schemas`.
 * Safe to import from browser components (no server-only code here).
 *
 * Source of truth: GET https://yadah-backend-staging.adamusgh.com/api/v1/openapi.json
 */

/** Office roles as defined by the API. */
export type Role = "admin" | "manager" | "collector";

export const ROLES: Role[] = ["admin", "manager", "collector"];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  manager: "Manager",
  collector: "Collector",
};

/** The `PublicUser` schema — what the API returns for a user. */
export interface AuthUser {
  id: string;
  name: string;
  username: string;
  phone: string;
  email?: string;
  role: Role;
  /**
   * Set by an admin's password reset, cleared by `POST /auth/password/change`.
   * While it is true the app holds the user on `/change-password` and lets them
   * nowhere else — a reset password is one an administrator knows, so a session
   * running on it is a shared credential until the owner replaces it.
   *
   * Required by the schema, so every user the API returns carries it. A session
   * cookie minted before this field existed will not, which reads as `false`
   * and simply means the holder is asked at their next sign-in instead.
   */
  mustChangePassword: boolean;
}

/** The `AuthTokens` schema. */
export interface AuthTokens {
  /** JWT, ~15 min lifetime. Sent as `Authorization: Bearer`. */
  accessToken: string;
  /** Opaque, single-use — rotated on every refresh. */
  refreshToken: string;
}
