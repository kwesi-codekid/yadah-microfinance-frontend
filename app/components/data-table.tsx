import { Pagination, Skeleton, Table } from "@heroui/react";
import { ChevronDown, FolderOpen } from "lucide-react";
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
    <div className="flex flex-col gap-4">
      {/* The bordered box holds only the scrollable table; the pager sits
          outside it, spaced by the wrapper's `gap-4`. */}
      <div className="w-full overflow-hidden  rounded-lg border-2 border-border bg-surface ">
        <Table variant="secondary" className="w-full shadow-none">
          <Table.ScrollContainer className={`${heightClass} overflow-auto bg-surface`}>
            {/* HeroUI sets `text-sm` and a bottom border on `.table__cell`
                itself, so both have to be out-ranked here — a descendant
                selector on the container does that for every caller's cells at
                once. No rule between rows: the header keeps its own divider
                (a `th`, untouched by these), and rows read as a list. */}
            <Table.Content
              aria-label={ariaLabel}
              className="w-full bg-surface [&_td]:border-b-0 [&_td]:text-xs"
            >
              <Table.Header>
                {columns.map((column, index) => (
                  <Table.Column
                    key={column}
                    id={column}
                    isRowHeader={index === 0}
                    className="sticky top-0 z-10 rounded-none border-b border-border bg-surface-secondary px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-foreground"
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
        <div className="flex items-center justify-between gap-4">
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
    <div className="relative">
      <select
        aria-label="Rows per page"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="appearance-none rounded-lg border border-field-border bg-field py-1.5 pl-3 pr-9 text-sm text-foreground outline-none transition hover:border-accent/50 focus:border-accent"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
      />
    </div>
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
      <Pagination.Content>
        <Pagination.Item>
          <Pagination.Previous
            isDisabled={page <= 1}
            onPress={() => onPageChange(page - 1)}
          >
            <Pagination.PreviousIcon />
          </Pagination.Previous>
        </Pagination.Item>

        {getPages(page, pageCount).map((p, i) =>
          p === "ellipsis" ? (
            <Pagination.Item key={`ellipsis-${i}`}>
              <Pagination.Ellipsis />
            </Pagination.Item>
          ) : (
            <Pagination.Item key={p}>
              <Pagination.Link
                isActive={p === page}
                onPress={() => onPageChange(p)}
                className={
                  p === page
                    ? "bg-success/30 font-semibold text-success hover:bg-success hover:text-white"
                    : undefined
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
          >
            <Pagination.NextIcon />
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
    </Pagination>
  );
}

function EmptyState({ content }: { content?: EmptyContent }) {
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
