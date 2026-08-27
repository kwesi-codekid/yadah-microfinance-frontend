import * as React from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
  SearchIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";
import { formatCount } from "~/lib/format";

/**
 * The list view, as every list screen in the app draws it.
 *
 * One shape for all of them — filter tabs that carry their own counts, a search
 * box, a checkbox column that adds up to an export, and a page footer that says
 * how much of the list you are actually looking at. Staff work down
 * these tables all day; learning the chrome once is the point.
 *
 * Paging works either way round. Hand it every row and it pages them itself;
 * hand it `paging` and `rows` is one page of API results, the footer reads
 * `meta.pagination`, and moving between pages is the caller's request to make.
 */

export type Column<T> = {
  /** Stable key, and the header's `scope="col"` id for narrow screens. */
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Applied to the header cell and every body cell in the column. */
  className?: string;
  /** Numbers sit right so the digits line up down the column. */
  align?: "start" | "end";
};

export type TableTab = {
  value: string;
  /** A node, not a string: some lists key their tabs by colour as well as name. */
  label: React.ReactNode;
  count: number;
};

export type Selection = {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Shown in the selection strip — an export, usually. */
  actions?: React.ReactNode;
};

/** Server-side paging: the caller owns the page and fetches it. */
export type Paging = {
  page: number;
  pageSize: number;
  /** `meta.pagination.total` — the whole result set, not this page. */
  total: number;
  onPageChange: (page: number) => void;
};

/**
 * Filter tabs and a search box, in that order.
 *
 * Lifted out of `DataTable` because not every list is a table — some collections
 * are people and read as cards — and both have to draw the same strip.
 *
 * The tabs are optional. A list with nothing to filter on — screens the API
 * pages whole — passes none and gets the search box alone, rather than a strip
 * holding one permanently-pressed button.
 */
export function RegisterToolbar({
  tabs,
  activeTab,
  onTabChange,
  tabsLabel,
  search,
  onSearchChange,
  searchPlaceholder,
  searchLabel,
  searchSlot,
  actions,
}: {
  tabs?: TableTab[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  tabsLabel?: string;
  /** Omit along with `onSearchChange` when passing `searchSlot` instead. */
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchLabel?: string;
  /**
   * A search box of the caller's own, in place of the built-in one.
   *
   * The box above sifts rows already in hand, which is right when the whole
   * list is loaded. A list the API searches server-side needs the term in the
   * URL, a debounce, and a form that still works without JavaScript — that is
   * `SearchBox` in `~/components/listing`, and this is where it goes so that
   * the strip looks the same either way.
   */
  searchSlot?: React.ReactNode;
  /** Sits after the search box — a date range, an export menu. */
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {/* Buttons rather than a tablist: there is no tabpanel to own, and a
          tablist promises arrow-key navigation this doesn't implement. */}
      {tabs && tabs.length > 0 ? (
        <div
          role="group"
          aria-label={tabsLabel}
          className="inline-flex w-fit flex-wrap items-center gap-1 rounded-lg bg-muted/60 p-1"
        >
          {tabs.map((tab) => {
          const isActive = tab.value === activeTab;

          return (
            <button
              key={tab.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onTabChange?.(tab.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
              {/* A count of zero on a closed tab means "not counted", not
                  "empty" — only the open tab's total is ever known. */}
              {tab.count > 0 || isActive ? (
                <span
                  className={cn(
                    "count rounded-full px-1.5 py-px text-xs font-semibold",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {formatCount(tab.count)}
                </span>
              ) : null}
            </button>
          );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {searchSlot ??
          (search !== undefined ? (
            <div className="relative w-full sm:w-72">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={search}
                onChange={(event) => onSearchChange?.(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchLabel}
                className="pl-9"
              />
            </div>
          ) : null)}
        {actions}
      </div>
    </div>
  );
}

export function DataTable<T>({
  tabs,
  activeTab,
  onTabChange,
  tabsLabel,
  search,
  onSearchChange,
  searchPlaceholder,
  searchLabel,
  searchSlot,
  actions,
  columns,
  rows,
  rowKey,
  noun,
  pageSize = 10,
  paging,
  loading,
  error,
  selection,
  rowActions,
  empty,
}: {
  /** Omit on a list with nothing to filter — the toolbar is then search alone. */
  tabs?: TableTab[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  tabsLabel?: string;
  /** Omit along with `onSearchChange` when passing `searchSlot` instead. */
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchLabel?: string;
  /** A search box of the caller's own — see `RegisterToolbar`. */
  searchSlot?: React.ReactNode;
  /** Sits after the search box — a date range, an export menu. */
  actions?: React.ReactNode;
  columns: Array<Column<T>>;
  /** One page of results when `paging` is given, otherwise every row. */
  rows: T[];
  rowKey: (row: T) => string;
  /** How to name a row in the footer, e.g. `{ one: "member", many: "members" }`. */
  noun: { one: string; many: string };
  /** Ignored when `paging` is given — the API's `limit` decides the page size. */
  pageSize?: number;
  paging?: Paging;
  /** Dims the rows while a page is in flight. */
  loading?: boolean;
  /** Replaces the table body when the request failed. */
  error?: React.ReactNode;
  selection?: Selection;
  /** Menu items for the row's ⋯ button. Omit the column entirely by not passing. */
  rowActions?: (row: T) => React.ReactNode;
  empty: React.ReactNode;
}) {
  const [localPage, setLocalPage] = React.useState(1);

  // A filter change can leave you past the end of a shorter list. Reset rather
  // than showing an empty page with rows sitting behind it.
  const filterKey = `${activeTab ?? ""} ${search ?? ""}`;
  const lastFilter = React.useRef(filterKey);
  // The server-paged case is the caller's to reset, since it also has to refetch.
  if (!paging && lastFilter.current !== filterKey) {
    lastFilter.current = filterKey;
    if (localPage !== 1) setLocalPage(1);
  }

  const size = paging?.pageSize ?? pageSize;
  const total = paging?.total ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(paging?.page ?? localPage, pageCount);
  const start = (current - 1) * size;

  // Server-paged rows are already the page; local ones still need slicing.
  const visible = paging ? rows : rows.slice(start, start + size);
  const setPage = paging ? paging.onPageChange : setLocalPage;

  const visibleKeys = visible.map(rowKey);
  const selectedOnPage = selection
    ? visibleKeys.filter((key) => selection.selected.has(key))
    : [];
  const allOnPage =
    visibleKeys.length > 0 && selectedOnPage.length === visibleKeys.length;

  function toggleAllOnPage(checked: boolean) {
    if (!selection) return;

    const next = new Set(selection.selected);
    for (const key of visibleKeys) {
      if (checked) next.add(key);
      else next.delete(key);
    }
    selection.onChange(next);
  }

  function toggleRow(key: string, checked: boolean) {
    if (!selection) return;

    const next = new Set(selection.selected);
    if (checked) next.add(key);
    else next.delete(key);
    selection.onChange(next);
  }

  const selectedCount = selection?.selected.size ?? 0;

  return (
    <div className="space-y-3">
      {/* The dashboard's card: a soft-cornered plate of `bg-card` with no rule
          around it, so a page of these reads as one surface rather than a
          stack of boxed-off panels. The rules inside still divide it. */}
      <div className="overflow-hidden rounded-2xl bg-card">
        {/* Inside the card, as a strip: the filters belong to the list they
            narrow, not to the page above it. */}
        <div className="border-b border-border p-3">
          <RegisterToolbar
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={onTabChange}
            tabsLabel={tabsLabel}
            search={search}
            onSearchChange={onSearchChange}
            searchPlaceholder={searchPlaceholder}
            searchLabel={searchLabel}
            searchSlot={searchSlot}
            actions={actions}
          />
        </div>

        {selection && selectedCount > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-accent/40 px-4 py-2 text-sm">
            <span className="font-medium">
              <span className="count">{formatCount(selectedCount)}</span>{" "}
              {selectedCount === 1 ? noun.one : noun.many} selected
            </span>
            {selection.actions}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => selection.onChange(new Set())}
            >
              Clear
            </Button>
          </div>
        ) : null}

        {error ? (
          <div className="px-4 py-14 text-center text-sm text-destructive">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-14 text-center text-sm text-muted-foreground">
            {loading ? "Loading…" : empty}
          </div>
        ) : (
          <>
            <div
              className={cn(
                "overflow-x-auto transition-opacity",
                loading && "pointer-events-none opacity-60"
              )}
              aria-busy={loading || undefined}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {selection ? (
                      <th scope="col" className="w-10 pl-4">
                        <Checkbox
                          checked={
                            allOnPage
                              ? true
                              : selectedOnPage.length > 0
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={(state) => toggleAllOnPage(state === true)}
                          aria-label={`Select the ${noun.many} on this page`}
                          className="before:absolute before:h-0.5 before:w-2 before:rounded-full before:bg-current before:opacity-0 data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:before:opacity-100 [&[data-state=indeterminate]_svg]:hidden"
                        />
                      </th>
                    ) : null}

                    {columns.map((column) => (
                      <th
                        key={column.key}
                        scope="col"
                        className={cn(
                          "eyebrow px-4 py-2.5 text-muted-foreground",
                          column.align === "end" && "text-right",
                          column.className
                        )}
                      >
                        {column.header}
                      </th>
                    ))}

                    {rowActions ? (
                      <th scope="col" className="eyebrow px-4 py-2.5 text-right text-muted-foreground">
                        <span className="sr-only sm:not-sr-only">Actions</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>

                <tbody>
                  {visible.map((row) => {
                    const key = rowKey(row);
                    const isSelected = selection?.selected.has(key) ?? false;

                    return (
                      <tr
                        key={key}
                        data-selected={isSelected || undefined}
                        className="border-b border-border last:border-0 hover:bg-muted/40 data-selected:bg-accent/30"
                      >
                        {selection ? (
                          <td className="pl-4">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(state) =>
                                toggleRow(key, state === true)
                              }
                              aria-label={`Select this ${noun.one}`}
                            />
                          </td>
                        ) : null}

                        {columns.map((column) => (
                          <td
                            key={column.key}
                            className={cn(
                              "px-4 py-3",
                              column.align === "end" && "text-right",
                              column.className
                            )}
                          >
                            {column.cell(row)}
                          </td>
                        ))}

                        {rowActions ? (
                          <td className="px-4 py-3 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="Actions"
                                  className="text-muted-foreground"
                                >
                                  <MoreHorizontalIcon />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                {rowActions(row)}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Outside the scroll container: a wide table must not carry the
                pager off the right-hand edge with it. */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
              <p>
                Showing{" "}
                <span className="count">
                  {formatCount(start + 1)}–{formatCount(start + visible.length)}
                </span>{" "}
                of <span className="count">{formatCount(total)}</span>{" "}
                {total === 1 ? noun.one : noun.many}
              </p>

              {pageCount > 1 ? (
                <div className="flex items-center gap-2">
                  <span>
                    Page <span className="count">{current}</span> of{" "}
                    <span className="count">{pageCount}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label="Previous page"
                      disabled={loading || current === 1}
                      onClick={() => setPage(current - 1)}
                    >
                      <ChevronLeftIcon />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label="Next page"
                      disabled={loading || current === pageCount}
                      onClick={() => setPage(current + 1)}
                    >
                      <ChevronRightIcon />
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The disc that stands in for a person                                       */
/* -------------------------------------------------------------------------- */

/** Six tints, defined in `app.css`. */
const TINTS = 6;

/**
 * FNV-1a, so the same branch always draws the same colour — across sessions,
 * across screens, and on every user's machine.
 */
function tintOf(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % TINTS) + 1;
}

/**
 * Initials on a tinted disc.
 *
 * The tint is not decoration — it is hashed off whatever `tint` is handed, and
 * on these lists that is the **branch id**. Six branches in view means six
 * colours, and a user sees the list group itself without reading the
 * branch column. Hand it `null` and the disc goes muted, which is what an
 * unknown branch looks like.
 */
export function InitialsDisc({
  initials,
  tint,
  size = "sm",
  className,
}: {
  initials: string;
  /** The fact the colour encodes. `null` for "no branch". */
  tint?: string | null;
  size?: "sm" | "lg";
  className?: string;
}) {
  const index = tint ? tintOf(tint) : null;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold",
        size === "sm" ? "size-9 text-xs" : "size-12 text-base",
        index === null && "bg-muted text-muted-foreground",
        className
      )}
      style={
        index === null
          ? undefined
          : {
              background: `var(--tint-${index}-bg)`,
              color: `var(--tint-${index}-fg)`,
            }
      }
    >
      {initials}
    </span>
  );
}

/**
 * The identity cell: who the row is about, and the one line of context that
 * saves opening the record. Every list in the app leads with this.
 *
 * Two shapes, one component. Pass `code` and it draws the square tile a
 * record or a category is filed under; pass `tint` and it draws the round
 * tinted disc a *person* gets, because a person is not a filing code.
 */
export function RowIdentity({
  code,
  name,
  detail,
  tint,
  tone = "primary",
}: {
  code: string;
  name: React.ReactNode;
  detail?: React.ReactNode;
  /** Switches to the person disc, tinted by this seed. `null` for muted. */
  tint?: string | null;
  tone?: "primary" | "muted";
}) {
  return (
    <div className="flex items-center gap-3">
      {tint === undefined ? (
        <span
          aria-hidden="true"
          className={cn(
            "figures grid size-9 shrink-0 place-items-center rounded-md text-[0.625rem] font-medium",
            tone === "primary"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          )}
        >
          {code}
        </span>
      ) : (
        <InitialsDisc initials={code} tint={tint} />
      )}

      <div className="min-w-0">
        <div className="truncate font-medium">{name}</div>
        {detail ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A status pill. The dot is what users scan for down the column. */
export function StatusPill({
  tone,
  children,
}: {
  tone: "good" | "watch" | "bad" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "good" && "bg-primary/12 text-primary",
        tone === "watch" && "bg-warning/15 text-warning",
        tone === "bad" && "bg-destructive/12 text-destructive",
        tone === "neutral" && "bg-muted text-muted-foreground"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          tone === "good" && "bg-primary",
          tone === "watch" && "bg-warning",
          tone === "bad" && "bg-destructive",
          tone === "neutral" && "bg-muted-foreground/50"
        )}
      />
      {children}
    </span>
  );
}
