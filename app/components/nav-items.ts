import {
  LayoutDashboard,
  Users,
  PiggyBank,
  Wallet,
  HandCoins,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { type AuthUser, type Role } from "~/lib/auth-client";

/**
 * The app's primary destinations, shared by the desktop rail (`sidebar.tsx`)
 * and the mobile tab bar (`mobile-nav.tsx`) so the two can't drift apart.
 * Order matters: the tab bar keeps the first few and pushes the rest behind
 * its "More" sheet.
 */

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Roles allowed to see this item; omit for "everyone". */
  roles?: Role[];
  soon?: boolean;
};

export const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true },
  // Every role: the API scopes collectors to their own assigned customers.
  { to: "/customers", label: "Customers", icon: Users },
  // Collect sits above the ledgers on purpose: it is the one destination a
  // collector needs all day, and the tab bar keeps the first few items.
  {
    to: "/collections",
    label: "Collect",
    icon: HandCoins,
    roles: ["collector", "manager", "admin"],
  },
  { to: "/susu", label: "Susu", icon: PiggyBank },
  { to: "/savings", label: "Savings", icon: Wallet, soon: true },
  {
    to: "/staff",
    label: "Staff",
    icon: UserCog,
    roles: ["admin", "manager"],
  },
];

/**
 * The items this user can actually reach, in declaration order.
 *
 * `soon` entries stay in `NAV` as the running to-do list of sections still to
 * build, but neither nav renders them — a dead link advertises a feature that
 * isn't there. Clearing the flag is all it takes to bring one back.
 */
export function visibleNavItems(user: AuthUser | null): NavItem[] {
  return NAV.filter(
    (item) =>
      !item.soon &&
      (!item.roles || (user != null && item.roles.includes(user.role))),
  );
}
