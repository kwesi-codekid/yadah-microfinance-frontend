import {
  ChartColumn,
  Coins,
  HandCoins,
  LayoutDashboard,
  Package,
  PiggyBank,
  Receipt,
  Settings,
  Users,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { type AuthUser, type Role } from "~/lib/auth-client";

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
  { to: "/customers", label: "Customers", icon: Users },
  // No `roles`: collectors work susu and record savings deposits too.
  { to: "/susu", label: "Susu", icon: Coins },
  { to: "/savings", label: "Savings", icon: PiggyBank },
  // No `roles`: a collector sees the susu and savings lines, just not the rest.
  { to: "/transactions", label: "Transactions", icon: Receipt },
  // Office only: loans are theirs.
  { to: "/loans", label: "Loans", icon: HandCoins, roles: ["admin", "manager"] },
  {
    to: "/hire-purchase",
    label: "Hire purchase",
    icon: Package,
    roles: ["admin", "manager"],
  },
  {
    to: "/reports",
    label: "Reports",
    icon: ChartColumn,
    roles: ["admin", "manager"],
  },
  {
    to: "/staff",
    label: "Staff",
    icon: UserCog,
    roles: ["admin", "manager"],
  },
  // No `roles`: everyone has an account tab, even where the rest is hidden.
  { to: "/settings", label: "Settings", icon: Settings },
];

export function visibleNavItems(user: AuthUser | null): NavItem[] {
  return NAV.filter(
    (item) =>
      !item.soon &&
      (!item.roles || (user != null && item.roles.includes(user.role))),
  );
}

/**
 * Destinations kept in the phone bar. Four plus More is five slots — the most a
 * bottom bar fits at a 44px touch target, and what leaves room for labels.
 */
export const MOBILE_PRIMARY_COUNT = 4;

/** The phone bar's two halves. `overflow` is empty when everything fits. */
export function splitNavItems(user: AuthUser | null): {
  primary: NavItem[];
  overflow: NavItem[];
} {
  const items = visibleNavItems(user);
  // A fifth destination needs no More button to reach it.
  if (items.length <= MOBILE_PRIMARY_COUNT + 1) {
    return { primary: items, overflow: [] };
  }
  return {
    primary: items.slice(0, MOBILE_PRIMARY_COUNT),
    overflow: items.slice(MOBILE_PRIMARY_COUNT),
  };
}

/** Whether a path is inside an item, matching `NavLink`'s `end` semantics. */
export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
