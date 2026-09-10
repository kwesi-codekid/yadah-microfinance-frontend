/**
 * Auth types shared by the server and the browser. Nothing in here may import
 * a `.server` module — it is bundled into the client.
 */

/**
 * The four roles the API defines.
 *
 * Two questions get asked of a role, and they are not the same one. "Office"
 * is admin and manager: may you decide? "The counter" is those two plus the
 * teller: may you serve whoever is standing here? A teller is unscoped, like
 * the office, because anyone may walk up — and junior, like a collector,
 * because deciding is not their job.
 */
export type Role = "admin" | "manager" | "teller" | "collector";

export const ROLES: Role[] = ["admin", "manager", "teller", "collector"];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  manager: "Manager",
  teller: "Teller",
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

/**
 * True when this user may decide: approve a loan, sign a hire purchase, move
 * money between a customer's products, read the company's books, or take
 * something out of the listings.
 */
export function isOffice(user: Pick<AuthUser, "role"> | null): boolean {
  return user?.role === "admin" || user?.role === "manager";
}

/**
 * True when this user serves the counter: taking money in, paying it out,
 * opening an account, registering the person in front of them. Everyone but
 * the collector, who is scoped to their own round instead.
 */
export function isCounter(user: Pick<AuthUser, "role"> | null): boolean {
  return isOffice(user) || user?.role === "teller";
}

/** Initials for the avatar fallback — two letters at most. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
