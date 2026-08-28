import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";

import { formatCount } from "~/lib/format";
import { cn } from "~/lib/utils";

/**
 * The rail down the left of a page, as the accounting module first drew it:
 * the ways of looking at a book, one under the other, with the one you are in
 * lit. Listings that used to carry a strip of status tabs over the table use
 * it instead, so from any view the others are one click away and the counts
 * stay in sight while you read.
 *
 * An item is either a place (`to`) or a choice (`onSelect`). Places are links
 * — the filter lives in the URL, survives a reload and can be sent to someone.
 * Choices are buttons, for pages that keep the view as client state. Which one
 * is lit is `active` when the caller knows it, otherwise the router says.
 *
 * Under `lg` there is no room for a column, so the same items become a strip
 * across the top that scrolls sideways — see `RailFrame`.
 */

export interface RailItem {
  key: string;
  label: ReactNode;
  icon?: LucideIcon;
  /** Omit where a count would be meaningless or too costly to fetch. */
  count?: number;
  to?: string;
  onSelect?: () => void;
  /** For `to` without `active`: only match this path exactly. */
  end?: boolean;
  disabled?: boolean;
}

export interface RailSection {
  label?: string;
  icon?: LucideIcon;
  items: RailItem[];
}

export function FilterRail({
  label,
  sections,
  active,
  horizontal = false,
}: {
  /** The `aria-label` — "Loans", "Filter customers by status". */
  label: string;
  sections: RailSection[];
  /** The lit item's key. Leave out to let `NavLink` decide from the URL. */
  active?: string;
  horizontal?: boolean;
}) {
  if (horizontal) {
    return (
      <nav aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {sections.flatMap((s) => s.items).map((item) => (
          <RailLink key={item.key} item={item} active={active} compact />
        ))}
      </nav>
    );
  }

  return (
    <nav aria-label={label} className="rounded-2xl bg-card p-2">
      {sections.map((section, i) => (
        <section
          key={section.label ?? i}
          className={cn("px-1 py-2", i > 0 && "mt-1 border-t border-border")}
        >
          {section.label ? (
            <h3 className="mb-1.5 flex items-center gap-2 px-2 pt-1 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              {section.icon ? <section.icon className="size-3.5" /> : null}
              {section.label}
            </h3>
          ) : null}
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.key}>
                <RailLink item={item} active={active} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function RailLink({
  item,
  active,
  compact = false,
}: {
  item: RailItem;
  active?: string;
  compact?: boolean;
}) {
  const classes = (lit: boolean) =>
    cn(
      "flex items-center gap-2 rounded-lg text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      compact ? "shrink-0 px-3 py-1.5 whitespace-nowrap" : "w-full px-2.5 py-2 text-left",
      lit
        ? "bg-primary font-medium text-primary-foreground"
        : "text-foreground/80 hover:bg-secondary hover:text-foreground",
      item.disabled && "pointer-events-none opacity-50",
    );

  const body = (lit: boolean) => (
    <>
      {item.icon ? <item.icon className="size-4 shrink-0 opacity-80" /> : null}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {/* A count of zero on a view you are not in means "not counted", not
          "empty" — only the open view's total is ever known for sure. */}
      {item.count !== undefined && (item.count > 0 || lit) ? (
        <span
          className={cn(
            "tabular rounded-full px-1.5 py-px text-xs font-semibold",
            lit ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {formatCount(item.count)}
        </span>
      ) : null}
    </>
  );

  if (item.to && active === undefined) {
    return (
      <NavLink
        to={item.to}
        end={item.end}
        prefetch="intent"
        aria-disabled={item.disabled || undefined}
        className={({ isActive }) => classes(isActive)}
      >
        {({ isActive }) => body(isActive)}
      </NavLink>
    );
  }

  const lit = active === item.key;

  if (item.to) {
    return (
      <Link
        to={item.to}
        prefetch="intent"
        preventScrollReset
        aria-current={lit ? "page" : undefined}
        aria-disabled={item.disabled || undefined}
        className={classes(lit)}
      >
        {body(lit)}
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={lit}
      disabled={item.disabled}
      onClick={item.onSelect}
      className={classes(lit)}
    >
      {body(lit)}
    </button>
  );
}

/**
 * The frame that seats a rail beside a page: a sticky column on the left at
 * `lg` and up, the same rail as a strip above the page below that. `rail` is
 * a `FilterRail` (or anything else that takes a `horizontal` flag); it is
 * rendered twice, once per breakpoint, and CSS decides which one shows.
 */
export function RailFrame({
  rail,
  children,
  className,
}: {
  rail: (props: { horizontal: boolean }) => ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start", className)}>
      <aside className="sticky top-0 hidden w-64 shrink-0 self-start py-6 pl-4 sm:pl-6 lg:block">
        {rail({ horizontal: false })}
      </aside>
      <div className="min-w-0 flex-1">
        <div className="px-4 pt-4 sm:px-6 lg:hidden">{rail({ horizontal: true })}</div>
        {children}
      </div>
    </div>
  );
}
