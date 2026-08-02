import {
  Coins,
  HandCoins,
  LayoutDashboard,
  PiggyBank,
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
  { to: "/loans", label: "Loans", icon: HandCoins, roles: ["admin", "manager"] },
  {
    to: "/staff",
    label: "Staff",
    icon: UserCog,
    roles: ["admin", "manager"],
  },
];

export function visibleNavItems(user: AuthUser | null): NavItem[] {
  return NAV.filter(
    (item) =>
      !item.soon &&
      (!item.roles || (user != null && item.roles.includes(user.role))),
  );
}
