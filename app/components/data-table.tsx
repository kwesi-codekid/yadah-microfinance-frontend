import { ListBox, Pagination, Select, Skeleton, Table } from "@heroui/react";
import { FolderOpen } from "lucide-react";
import { Children, useEffect, useState, type ReactNode } from "react";

/**
 * Generic table built on HeroUI v3's `Table` (react-aria). Callers pass the
 * column labels and the rows as children (`<Table.Row>` / `<Table.Cell>`, which
 * are re-exported here for convenience). Loading renders skeleton rows; an empty
 * collection renders `emptyContent`. Custom pagination/footer goes in
 * `bottomContent` (v3 has no drop-in paginated table).
 */
export { Table } from "@heroui/react";

interface EmptyContent {
  icon?: ReactNode;
  title: string;
  subtext?: string;
  button?: ReactNode;
}

interface DataTableProps {
  columns: string[];
  children: ReactNode;
  isLoading?: boolean;
  ariaLabel?: string;
  /** Tailwind max-height for the scroll area. */
  heightClass?: string;
  /**
   * Extra classes on the table's own wrapper.
   *
   * For fitting the table into a layout — `flex-auto` inside a flex column
   * lets it grow into the height it is given, which is how two tables in one
   * grid row end up the same height.
   */
  className?: string;
  emptyContent?: EmptyContent;
  bottomContent?: ReactNode;
  /**
   * Enable built-in pagination: pass **all** rows as children and the table owns
   * the page + page-size state and slices them itself (page-size selector left,
   * pager right). Leave off for a plain, non-paginated table.
   */
  paginated?: boolean;
  /** Rows-per-page options; the first is the default. */
  pageSizeOptions?: number[];
  /** Change this (e.g. the search term or active tab) to reset back to page 1. */
  resetKey?: string | number;
  /**
   * Controlled (server-side) pagination — the caller fetches each page and passes
   * only that page's rows as children, plus `pageCount`. Takes precedence over
   * `paginated`. With `onPageSizeChange`, the page-size selector is shown too.
   */
  page?: number;
  pageCount?: number;
  onPageChange?: (page: number) => void;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
}

export const DataTable = ({
  columns,
  children,
  isLoading,
  ariaLabel = "Data table",
  heightClass = "max-h-[60vh]",
  className = "",
  emptyContent,
  bottomContent,
  paginated,
  pageSizeOptions = [10, 25, 50],
  resetKey,
  page: pageProp,
  pageCount: pageCountProp,
  onPageChange,
  pageSize: pageSizeProp,
  onPageSizeChange,
}: DataTableProps) => {
  // Controlled (server) mode: the caller owns page/size and fetches each page.
  const controlled = pageProp !== undefined && onPageChange !== undefined;

  /**
   * Whether the table owns a scroll area at all.
   *
   * `max-h-none` is how a caller says "this page already scrolls, don't put a
   * second scroller inside it" — the dashboard does exactly that for both of
   * its record tables. It has to change the box's flex behaviour too, not just
   * the max-height; see the comment on the bordered box below.
   */
  const capped = heightClass !== "max-h-none";

  const [internalPage, setInternalPage] = useState(1);
  const [internalSize, setInternalSize] = useState(pageSizeOptions[0] ?? 10);
  useEffect(() => {
    if (!controlled) setInternalPage(1);
  }, [resetKey, internalSize, controlled]);

  let visibleRows: ReactNode = children;
  let curPage = 1;
  let curSize = pageSizeOptions[0] ?? 10;
  let pageCount = 1;
  let showFooter = false;
  let showSizeSelect = false;
  let handlePage: (n: number) => void = setInternalPage;
  let handleSize: (n: number) => void = setInternalSize;

  if (controlled) {
    curPage = pageProp as number;
    curSize = pageSizeProp ?? curSize;
    pageCount = Math.max(1, pageCountProp ?? 1);
    handlePage = onPageChange as (n: number) => void;
    handleSize = onPageSizeChange ?? (() => {});
    showSizeSelect = !!onPageSizeChange;
    showFooter = true; // server already returned this page; always show the pager

    /**
     * Safety net for a server that ignored `limit`.
     *
     * Controlled mode means "the caller fetched exactly this page", so
     * normally there is nothing to slice — and when the server behaves, this
     * branch never runs. But an endpoint that quietly returns the whole
     * collection makes the pager a decoration: every page renders every row,
     * and the numbers underneath look like they do nothing.
     *
     * More rows than a page holds can only mean the server sent the lot, so
     * they are sliced by the selected page here. It costs the download either
     * way — this is a display fix, not a bandwidth one — and the real repair
     * is on the API. Left in as a floor rather than a fix, because a list that
     * silently shows page 1 forever is worse than one that pages a
     * fully-downloaded set.
     */
    const allRows = Children.toArray(children);
    if (allRows.length > curSize) {
      visibleRows = allRows.slice((curPage - 1) * curSize, curPage * curSize);
      // The caller's `pageCount` came from the server's `total`; if that was
      // honest the two agree, and if it wasn't, the rows in hand are the
      // better source.
      pageCount = Math.max(pageCount, Math.ceil(allRows.length / curSize));
    }
  } else if (paginated) {
    // Client mode: slice the children ourselves.
    const allRows = Children.toArray(children);
    pageCount = Math.max(1, Math.ceil(allRows.length / internalSize));
    curPage = Math.min(internalPage, pageCount);
    curSize = internalSize;
    visibleRows = allRows.slice((curPage - 1) * curSize, curPage * curSize);
    showSizeSelect = true;
    showFooter = allRows.length > 0;
  }

  return (
    <div className={`flex min-w-0 flex-col gap-4 ${className}`}>
      {/* The bordered box holds only the scrollable table; the pager sits
          outside it, spaced by the wrapper's `gap-4`.

          `grow shrink-0` when the height is uncapped, and not `flex-auto`.
          Both grow into spare height — which is how two tables in one grid row
          end up the same height — but `flex-auto` can still *shrink*: this box
          carries `overflow-hidden`, and an overflow other than `visible`
          resolves a flex item's automatic minimum size to 0 rather than to its
          content. So the row could be squeezed under its own rows, and the
          scroll area inside (`overflow-auto`) would answer with a vertical
          scrollbar of its own — a scroller inside a page that already scrolls,
          two bars, and a wheel that stops the page dead over the rows.
          `shrink-0` is what actually floors it at the content height.

          With a cap (`max-h-[60vh]`) the inner scroller is the point, so the
          box is left free to take the height it is given. */}
      <div
        /* `dark:bg-canvas` on all three layers: the box, the scrollport and
           the table itself. In the light theme a white table on the grey
           canvas is the panel/page split the layout is built on; in the dark
           one the canvas is near-black already, and lifting the table to
           `--surface` leaves a grey slab floating on the page beside cards
           that don't. The `border-2` holds the edge either way. */
        className={`w-full overflow-hidden rounded-lg border-2 border-border bg-surface dark:bg-canvas ${
          capped ? "flex-auto" : "shrink-0 grow"
        }`}
      >
        <Table variant="secondary" className="w-full shadow-none">
          <Table.ScrollContainer
            /* Uncapped means the caller owns the scrolling, so this must not be
               able to become a scrollport at all — `overflow-auto` here grows a
               bar the moment anything constrains the box, which is the exact
               thing `max-h-none` is passed to prevent. HeroUI's own
               `.table__scroll-container` sets `overflow-x-auto`; Tailwind's
               utilities layer out-ranks its components layer, so this wins. */
            className={`${heightClass} bg-surface dark:bg-canvas ${
              capped ? "overflow-auto" : "overflow-visible"
            }`}
          >
            {/* HeroUI sets `text-sm` and a bottom border on `.table__cell`
                itself, so both have to be out-ranked here — a descendant
                selector on the container does that for every caller's cells at
                once. No rule between rows: the header keeps its own divider
                (a `th`, untouched by these), and rows read as a list. */}
            <Table.Content
              aria-label={ariaLabel}
              className="w-full bg-surface [&_td]:border-b-0 [&_td]:text-xs dark:bg-canvas"
            >
              <Table.Header>
                {columns.map((column, index) => (
                  <Table.Column
                    key={column}
                    id={column}
                    isRowHeader={index === 0}
                    /* Sticky only when the table owns a scroll area. Sticky
                       resolves against the nearest scrollport, so with
                       `max-h-none` there isn't one and `top-0` would pin the
                       header to the *page* instead — the header detaches from
                       its own rows and rides over whatever is above it. */
                    className={`rounded-none border-b border-border bg-surface-secondary px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-foreground ${
                      capped ? "sticky top-0 z-10" : ""
                    }`}
                  >
                    {column}
                  </Table.Column>
                ))}
              </Table.Header>
              <Table.Body renderEmptyState={() => <EmptyState content={emptyContent} />}>
                {isLoading
                  ? Array.from({ length: 6 }).map((_, row) => (
                      <Table.Row key={`sk-${row}`} id={`sk-${row}`}>
                        {columns.map((column) => (
                          <Table.Cell key={column} className="px-4 py-2">
                            {/* Matches a real row's line-height, so the table
                                doesn't resize when the data lands. */}
                            <Skeleton className="h-5 w-full rounded-lg" />
                          </Table.Cell>
                        ))}
                      </Table.Row>
                    ))
                  : visibleRows}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>

      </div>

      {showFooter ? (
        /* Pinned to the foot of the scrollport rather than sitting wherever
           the table happens to end. `sticky` only engages once the row would
           scroll out of view, so a short table's pager stays exactly where it
           was — this costs nothing until it is needed, and past that point the
           page controls are reachable without scrolling back down to them.
           `bg-canvas` matches the `<main>` it scrolls inside, so rows pass
           behind it rather than through it.

           The mobile offset clears the floating tab bar in `mobile-nav.tsx`,
           which is `fixed` at `max(0.75rem, safe-area)` and 3.5rem tall — the
           expression is that sum plus a gap. From `lg` the rail takes over and
           the bar is gone, so the pager sits on the true bottom edge. */
        <div className="sticky bottom-[calc(4rem+max(0.75rem,env(safe-area-inset-bottom)))] z-10 flex items-center justify-between gap-4 border-t-2 border-border bg-canvas py-2 lg:bottom-0">
          {showSizeSelect ? (
            <PageSizeSelect value={curSize} options={pageSizeOptions} onChange={handleSize} />
          ) : (
            <span />
          )}
          <TablePagination page={curPage} pageCount={pageCount} onPageChange={handlePage} />
        </div>
      ) : null}
      {bottomContent}
    </div>
  );
};

/**
 * The footer controls on their own, for a paged collection that isn't a table
 * — the card grid on a customer's accounts. Same select and same pager the
 * table renders, so the two can't drift into looking like different apps.
 */
export function CollectionFooter({
  page,
  pageCount,
  onPageChange,
  pageSize,
  pageSizeOptions = [10, 25, 50],
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
}) {
  return (
    // Same pinning as the table's own footer above — a card grid pages the
    // same way a table does, and the two sit one route apart.
    <div className="sticky bottom-[calc(4rem+max(0.75rem,env(safe-area-inset-bottom)))] z-10 flex items-center justify-between gap-4 border-t-2 border-border bg-canvas py-2 lg:bottom-0">
      {pageSize !== undefined && onPageSizeChange ? (
        <PageSizeSelect
          value={pageSize}
          options={pageSizeOptions}
          onChange={onPageSizeChange}
        />
      ) : (
        <span />
      )}
      <TablePagination
        page={page}
        pageCount={pageCount}
        onPageChange={onPageChange}
      />
    </div>
  );
}

/** Rows-per-page selector (native select styled to the theme). */
function PageSizeSelect({
  value,
  options,
  onChange,
}: {
  value: number;
  options: number[];
  onChange: (size: number) => void;
}) {
  return (
    <Select
      // No visible label — the trigger reads "25 per page", which says what a
      // label would have. `aria-label` carries that for a screen reader, which
      // would otherwise meet an unnamed combobox.
      aria-label="Rows per page"
      // Controlled off the caller's number. react-aria keys are strings, so it
      // goes out as one and comes back parsed.
      selectedKey={String(value)}
      onSelectionChange={(key) => onChange(Number(key))}
      className="text-left"
    >
      {/* `rounded` and a 1px border, matching `CELL_BASE` on the pager beside
          it — the two are one control set, so they take their corner and their
          edge weight from the same place rather than each having its own.
          `min-h-8` is the pager cells' height and `min-w-32` holds the width
          steady between "10 per page" and "100 per page", so the pager doesn't
          shift sideways when the size changes. */}
      <Select.Trigger className="min-h-8 min-w-32 gap-2 rounded border border-field-border bg-field px-2.5 text-sm text-foreground shadow-none transition hover:border-accent/50">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      {/* The whole point of moving off `<select>`: a native one opens an
          OS-drawn menu that takes none of the app's colours, corners or
          spacing, and looks like a different program on every machine. This is
          a popover we own. Same recipe as `SelectField` in form-fields.tsx, so
          the two dropdowns in this app are one dropdown. */}
      <Select.Popover className="min-w-[--trigger-width]  rounded border-2 border-border p-1">
        <ListBox>
          {options.map((o) => (
            <ListBox.Item
              key={o}
              id={String(o)}
              className="rounded shadow-none px-3 py-1.5 text-sm"
            >
              {o} per page
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/** Page numbers to render, collapsing long ranges with ellipses. */
function getPages(current: number, total: number): (number | "ellipsis")[] {
  const pages: (number | "ellipsis")[] = [];
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || (p >= current - 1 && p <= current + 1)) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== "ellipsis") {
      pages.push("ellipsis");
    }
  }
  return pages;
}

/**
 * Square cells, not pills.
 *
 * A border on every cell so the run reads as a strip of keys rather than as
 * loose numbers — with a pill the fill *is* the shape, and dropping to a small
 * radius leaves an active cell with nothing holding its edge. `-ml-px` laps the
 * borders so neighbours share one line instead of drawing two.
 *
 * The fill is deliberately *not* in here. Three cells want three different
 * backgrounds, and two `bg-*` utilities in one class list is not an override —
 * both are `background-color`, so which wins is decided by their order in the
 * generated stylesheet, not by the order they were written. Composing off a
 * fill-less base is what makes the three predictable.
 */
const CELL_BASE = "rounded border border-border -ml-px first:ml-0 min-w-8 text-sm";

/** A page number, or the ellipsis: the lightest wash, so the run reads as one. */
const PAGE_CELL = `${CELL_BASE} bg-success/10`;

/**
 * Prev and next: the solid fill.
 *
 * They are the only two cells you aim for without reading — everything else in
 * the strip is a number you have to look at first — so they carry the deepest
 * background rather than the same wash as their neighbours.
 *
 * `text-success-foreground`, not `text-white`: the token flips to near-black in
 * the dark theme, where `--success` lightens to #34b160 and white-on-green
 * loses its contrast.
 *
 * Disabled is covered twice on purpose. `isDisabled` is react-aria's, and
 * depending on the element it renders it may surface as the `disabled`
 * attribute or as `data-disabled` — without both, a solid green Previous on
 * page 1 looks like a live button.
 */
const ARROW_CELL = `${CELL_BASE} border-success bg-success text-success-foreground hover:opacity-90 disabled:opacity-40 data-[disabled]:opacity-40`;

function TablePagination({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <Pagination size="sm">
      <Pagination.Content className="flex items-center">
        <Pagination.Item>
          <Pagination.Previous
            isDisabled={page <= 1}
            onPress={() => onPageChange(page - 1)}
            className={ARROW_CELL}
          >
            <Pagination.PreviousIcon />
          </Pagination.Previous>
        </Pagination.Item>

        {getPages(page, pageCount).map((p, i) =>
          p === "ellipsis" ? (
            <Pagination.Item key={`ellipsis-${i}`}>
              <Pagination.Ellipsis className={PAGE_CELL} />
            </Pagination.Item>
          ) : (
            <Pagination.Item key={p}>
              <Pagination.Link
                isActive={p === page}
                onPress={() => onPageChange(p)}
                className={
                  p === page
                    ? // Off `CELL_BASE`, not `PAGE_CELL` — the active tint has
                      // to be the only `bg-*` on the cell to be sure it lands.
                      // Its own border colour too, so the marker doesn't
                      // disappear into the neighbours' grey.
                      `${CELL_BASE} z-10 border-success bg-success/30 font-semibold text-success hover:bg-success hover:text-success-foreground`
                    : PAGE_CELL
                }
              >
                {p}
              </Pagination.Link>
            </Pagination.Item>
          ),
        )}

        <Pagination.Item>
          <Pagination.Next
            isDisabled={page >= pageCount}
            onPress={() => onPageChange(page + 1)}
            className={ARROW_CELL}
          >
            <Pagination.NextIcon />
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
    </Pagination>
  );
}

export function EmptyState({ content }: { content?: EmptyContent }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <div className="rounded-full bg-surface-tertiary p-6">
        {content?.icon ?? (
          <FolderOpen size={64} strokeWidth={1.5} className="text-accent" />
        )}
      </div>
      <h3 className="text-xl font-semibold text-foreground">
        {content?.title ?? "No record found"}
      </h3>
      {content?.subtext && <p className="text-xs text-muted">{content.subtext}</p>}
      {content?.button}
    </div>
  );
}
