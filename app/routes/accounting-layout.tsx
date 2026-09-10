import {
  BookOpenIcon,
  FileTextIcon,
  LandmarkIcon,
  PackageIcon,
  PiggyBankIcon,
  ReceiptIcon,
  ScaleIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react";
import { Outlet } from "react-router";

import { FilterRail, RailFrame, type RailSection } from "~/components/filter-rail";

/**
 * The frame every accounting page sits in: the books down the left, the page
 * itself on the right. The rail is what turns six sibling routes into one
 * module — from any book, every other book is one click away, and the one you
 * are in is lit.
 *
 * It carries no `handle` of its own so the app header keeps reading the
 * child's title, and no loader so switching books costs only the book's own
 * query.
 */
export default function AccountingLayout() {
  return (
    <RailFrame
      rail={({ horizontal }) => (
        <FilterRail label="Accounting" sections={SECTIONS} horizontal={horizontal} />
      )}
    >
      <Outlet />
    </RailFrame>
  );
}

/* ------------------------------------------------------------------- nav --- */

const SECTIONS: RailSection[] = [
  {
    label: "Overview",
    icon: WalletIcon,
    items: [
      // Only the front page must match exactly; `/accounting/expenses/new` is still Expenses.
      { key: "cash", to: "/accounting", label: "Cash position", icon: LandmarkIcon, end: true },
    ],
  },
  {
    label: "Books",
    icon: BookOpenIcon,
    items: [
      { key: "expenses", to: "/accounting/expenses", label: "Expenses", icon: ReceiptIcon },
      { key: "assets", to: "/accounting/assets", label: "Fixed assets", icon: PackageIcon },
      { key: "capital", to: "/accounting/capital", label: "Capital", icon: PiggyBankIcon },
    ],
  },
  {
    label: "Statements",
    icon: FileTextIcon,
    items: [
      { key: "balance-sheet", to: "/accounting/balance-sheet", label: "Balance sheet", icon: ScaleIcon },
      { key: "profit-loss", to: "/accounting/profit-loss", label: "Profit and loss", icon: TrendingUpIcon },
    ],
  },
];
