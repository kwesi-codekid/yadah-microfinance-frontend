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
