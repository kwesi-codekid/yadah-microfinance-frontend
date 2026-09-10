import {
  FileSignatureIcon,
  HandCoinsIcon,
  LandmarkIcon,
  PackageIcon,
  PiggyBankIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { Outlet } from "react-router";

import { FilterRail, RailFrame, type RailSection } from "~/components/filter-rail";

/**
 * The frame every book of the trash sits in, drawn the way the accounting
 * module draws its books: one rail down the left, the book on the right, the
 * one you are in lit. Each list in the app trashes into its own book here,
 * and this rail is what makes six sibling routes read as one place.
 *
 * No `handle` — the header keeps reading the child's title — and no loader,
 * so switching books costs only that book's query.
 */
export default function TrashLayout() {
  return (
    <RailFrame
      rail={({ horizontal }) => (
        <FilterRail label="Trash" sections={SECTIONS} horizontal={horizontal} />
      )}
    >
      <Outlet />
    </RailFrame>
  );
}

const SECTIONS: RailSection[] = [
  {
    label: "People",
    icon: UsersIcon,
    items: [{ key: "customers", to: "/trash", label: "Customers", icon: UsersIcon, end: true }],
  },
  {
    label: "Accounts",
    icon: PiggyBankIcon,
    items: [
      { key: "susu", to: "/trash/susu", label: "Susu accounts", icon: HandCoinsIcon },
      { key: "savings", to: "/trash/savings", label: "Savings accounts", icon: PiggyBankIcon },
      { key: "loans", to: "/trash/loans", label: "Loans", icon: LandmarkIcon },
    ],
  },
  {
    label: "Hire purchase",
    icon: Trash2Icon,
    items: [
      { key: "inventory", to: "/trash/inventory", label: "Inventory items", icon: PackageIcon },
      { key: "agreements", to: "/trash/agreements", label: "Agreements", icon: FileSignatureIcon },
    ],
  },
];
