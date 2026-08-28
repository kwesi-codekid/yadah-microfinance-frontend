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
  type LucideIcon,
} from "lucide-react";
import { NavLink, Outlet } from "react-router";

import { cn } from "~/lib/utils";

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
    <div className="flex items-start">
      <aside className="sticky top-0 hidden w-64 shrink-0 self-start py-6 pl-4 sm:pl-6 lg:block">
        <BooksNav />
      </aside>
      <div className="min-w-0 flex-1">
        {/* Under `lg` the rail becomes a strip above the page. */}
        <div className="px-4 pt-4 sm:px-6 lg:hidden">
          <BooksNav horizontal />
        </div>
        <Outlet />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- nav --- */

interface Book {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Only the front page must match exactly; `/accounting/expenses/new` is still Expenses. */
  end?: boolean;
}

interface Section {
  label: string;
  icon: LucideIcon;
  books: Book[];
}

const SECTIONS: Section[] = [
  {
    label: "Overview",
    icon: WalletIcon,
    books: [{ to: "/accounting", label: "Cash position", icon: LandmarkIcon, end: true }],
  },
  {
    label: "Books",
    icon: BookOpenIcon,
    books: [
      { to: "/accounting/expenses", label: "Expenses", icon: ReceiptIcon },
      { to: "/accounting/assets", label: "Fixed assets", icon: PackageIcon },
      { to: "/accounting/capital", label: "Capital", icon: PiggyBankIcon },
    ],
  },
  {
    label: "Statements",
    icon: FileTextIcon,
    books: [
      { to: "/accounting/balance-sheet", label: "Balance sheet", icon: ScaleIcon },
      { to: "/accounting/profit-loss", label: "Profit and loss", icon: TrendingUpIcon },
    ],
  },
];

function BooksNav({ horizontal = false }: { horizontal?: boolean }) {
  if (horizontal) {
    return (
      <nav aria-label="Accounting" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {SECTIONS.flatMap((s) => s.books).map((book) => (
          <BookLink key={book.to} book={book} compact />
        ))}
      </nav>
    );
  }

  return (
    <nav aria-label="Accounting" className="rounded-2xl bg-card p-2">
      {SECTIONS.map((section, i) => (
        <section
          key={section.label}
          className={cn("px-1 py-2", i > 0 && "mt-1 border-t border-border")}
        >
          <h3 className="mb-1.5 flex items-center gap-2 px-2 pt-1 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            <section.icon className="size-3.5" />
            {section.label}
          </h3>
          <ul className="space-y-0.5">
            {section.books.map((book) => (
              <li key={book.to}>
                <BookLink book={book} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function BookLink({ book, compact = false }: { book: Book; compact?: boolean }) {
  return (
    <NavLink
      to={book.to}
      end={book.end}
      prefetch="intent"
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-lg text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          compact ? "shrink-0 px-3 py-1.5 whitespace-nowrap" : "px-2.5 py-2",
          isActive
            ? "bg-primary font-medium text-primary-foreground"
            : "text-foreground/80 hover:bg-secondary hover:text-foreground",
        )
      }
    >
      <book.icon className="size-4 shrink-0 opacity-80" />
      {book.label}
    </NavLink>
  );
}
