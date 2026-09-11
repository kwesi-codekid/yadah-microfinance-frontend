import {
  ArrowLeftRightIcon,
  BanknoteArrowUpIcon,
  BookOpenTextIcon,
  ChartColumnIcon,
  CoinsIcon,
  HandCoinsIcon,
  ScaleIcon,
  ShoppingCartIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  ReceiptIcon,
  ReceiptTextIcon,
  RepeatIcon,
  Trash2Icon,
  UserCogIcon,
  UsersIcon,
  WalletIcon,
  WarehouseIcon,
  type LucideIcon,
} from "lucide-react";

import type { AuthUser, Role } from "~/lib/auth";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** One line on what the module is for. Used on the dashboard tiles. */
  blurb: string;
  /** Match this path exactly, rather than as a section. */
  end?: boolean;
  /** Roles that may see this item; omit for everyone. */
  roles?: Role[];
  /**
   * Keep the module out of the sidebar without taking it out of the app. The
   * routes still work for anyone who knows the address, and the header still
   * knows what to call the page — this only stops the link being drawn.
   */
  hidden?: boolean;
};

/** Admin and manager: the roles that may decide. */
const OFFICE: Role[] = ["admin", "manager"];

/** The counter — the office plus the teller. Collector is field-only. */
const COUNTER: Role[] = ["admin", "manager", "teller"];

/**
 * The modules, in the order the business works through them: who you serve,
 * what they pay in, what they take out, and what is left to tidy up.
 *
 * `roles` here only decides what is *drawn*. Access is enforced in each
 * route's loader — hiding a link is not access control.
 */
export const NAV: NavItem[] = [
  // Every role: the office sees the branch, a collector sees their own day.
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboardIcon,
    blurb: "Today at a glance.",
    end: true,
  },
  {
    to: "/customers",
    label: "Customers",
    icon: UsersIcon,
    blurb: "Register, search and open accounts.",
  },
  // No `roles`: collectors work susu and record savings deposits too.
  {
    to: "/susu",
    label: "Susu",
    icon: CoinsIcon,
    blurb: "Cycles, collections and payouts.",
  },
  {
    to: "/savings",
    label: "Savings",
    icon: WalletIcon,
    blurb: "Deposits, withdrawals and statements.",
  },
  // Office only, because the ledger it draws — `GET /reports/transactions` —
  // is part of the office-only reports surface and has no per-collector scope.
  // A collector reconciles their own day on the susu summary instead, which is
  // scoped to them by the API and which they may read.
  {
    to: "/transactions",
    label: "Transactions",
    icon: ArrowLeftRightIcon,
    blurb: "Every movement of money, in one ledger.",
    roles: OFFICE,
  },
  // Office only, and atomic: it moves money between a customer's own accounts,
  // so it never appears in the cash totals the collectors reconcile against.
  {
    to: "/transfers",
    label: "Transfer",
    icon: RepeatIcon,
    blurb: "Move money between a customer's own accounts.",
    roles: OFFICE,
  },
  {
    to: "/loans",
    label: "Loans",
    icon: LandmarkIcon,
    blurb: "Applications, disbursement and repayments.",
    // The counter takes repayments; the decision panel inside is office-only.
    roles: COUNTER,
  },
  {
    to: "/hire-purchase",
    label: "Hire purchase",
    icon: ReceiptTextIcon,
    blurb: "Agreements, instalments and redemption.",
    // The counter takes instalments; signing and repossession are office-only.
    roles: COUNTER,
  },
  // The till itself, and the book it writes into — two items, because they are
  // two jobs. Someone at the counter wants the POS and nothing else; someone
  // asking what was sold last week wants the listing and never the basket.
  // Beside hire purchase because all three draw down the same shelf, and
  // separate from it because a sale is over in a minute and has no lifecycle.
  {
    to: "/pos",
    label: "POS",
    icon: ShoppingCartIcon,
    blurb: "Ring up a counter sale: stock out, money in.",
    roles: COUNTER,
  },
  {
    to: "/sales",
    label: "Sales",
    icon: ReceiptIcon,
    blurb: "Every sale rung up, with its receipt.",
    roles: COUNTER,
  },
  // Its own section: the shelf is stocked whether or not anything is signed
  // for. The counter keeps it — whoever sells off it stocks it.
  {
    to: "/inventory",
    label: "Inventory",
    icon: WarehouseIcon,
    blurb: "Stock on the shelf and what is reserved.",
    roles: COUNTER,
  },
  // No `roles`: this is the one place a collector and the office each hold
  // half. The collector declares their day, the office counts it, and the API
  // scopes each side to what it may see.
  {
    to: "/reconciliation",
    label: "Cash handover",
    icon: ScaleIcon,
    blurb: "Declare a day's cash, count it, record the gap.",
  },
  // Office only: the customer asks from the portal, the office says yes or no,
  // and Paystack carries the money. A failed transfer here is an account
  // already debited — the one queue in the app that must not go unwatched.
  {
    to: "/payout-requests",
    label: "Payout requests",
    icon: BanknoteArrowUpIcon,
    blurb: "Withdrawals customers asked for, waiting on a decision.",
    roles: OFFICE,
  },
  // A hub, not a module: each report cuts across several of the books above,
  // which is why none of them lives on a module screen.
  {
    to: "/reports",
    label: "Reports",
    icon: ChartColumnIcon,
    blurb: "Collections, arrears and what the branch kept.",
    roles: OFFICE,
  },
  // What the business spends on itself. Its own module rather than a corner of
  // accounting, because the two are used by different people at different
  // times: the counter records an expense the moment the money leaves the
  // drawer, and the statements are read at month end by somebody else.
  {
    to: "/expenses",
    label: "Expenses",
    icon: HandCoinsIcon,
    blurb: "Petty cash and bills, from recorded to paid.",
    roles: COUNTER,
  },
  // The company's own books, as opposed to its customers': what it holds in
  // the drawer and the bank, what it owns, what the owner put in — and the
  // balance sheet and profit and loss built from all of it.
  {
    to: "/accounting",
    label: "Accounting",
    icon: BookOpenTextIcon,
    blurb: "Cash, assets, capital and the two statements.",
    roles: OFFICE,
    hidden: true,
  },
  {
    to: "/staff",
    label: "Staff",
    icon: UserCogIcon,
    blurb: "Accounts, roles and access.",
    roles: OFFICE,
  },
  // Where the lists send what was switched off, so it can be brought back.
  {
    to: "/trash",
    label: "Trash",
    icon: Trash2Icon,
    blurb: "Switched-off records, kept until restored.",
    roles: OFFICE,
  },
];

export function visibleNavItems(user: AuthUser | null): NavItem[] {
  return NAV.filter(
    (item) =>
      !item.hidden &&
      (!item.roles || (user != null && item.roles.includes(user.role))),
  );
}

/** Whether a path is inside an item, matching `NavLink`'s `end` semantics. */
export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/** The item a pathname belongs to — used for the header title. */
export function navItemFor(pathname: string): NavItem | undefined {
  return NAV.find((item) => isNavItemActive(pathname, item));
}
