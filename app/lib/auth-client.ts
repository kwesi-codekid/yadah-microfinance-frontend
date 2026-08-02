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
  mustChangePassword: boolean;
}

/** The `AuthTokens` schema. */
export interface AuthTokens {
  /** JWT, ~15 min lifetime. Sent as `Authorization: Bearer`. */
  accessToken: string;
  /** Opaque, single-use — rotated on every refresh. */
  refreshToken: string;
}
