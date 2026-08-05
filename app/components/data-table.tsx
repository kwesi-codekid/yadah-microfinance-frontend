import { ListBox, Pagination, Select, Skeleton, Table } from "@heroui/react";
import { FolderOpen } from "lucide-react";
import { Children, useEffect, useState, type ReactNode } from "react";

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
  /** For an `aria-controls` pointed at the table, e.g. from a tab bar. */
  id?: string;
  isLoading?: boolean;
  ariaLabel?: string;
  /** Tailwind max-height for the scroll area. */
  heightClass?: string;
  className?: string;
  emptyContent?: EmptyContent;
  bottomContent?: ReactNode;
  paginated?: boolean;
  /** Rows-per-page options; the first is the default. */
  pageSizeOptions?: number[];
  /** Change this (e.g. the search term or active tab) to reset back to page 1. */
  resetKey?: string | number;
  page?: number;
  pageCount?: number;
  onPageChange?: (page: number) => void;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  /** Row count blurb ("Showing 1–20 of 25"), sat beside the rows-per-page select. */
  summary?: ReactNode;
}

export const DataTable = ({
  columns,
  children,
  id,
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
  summary,
}: DataTableProps) => {
  // Controlled (server) mode: the caller owns page/size and fetches each page.
  const controlled = pageProp !== undefined && onPageChange !== undefined;

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

    const allRows = Children.toArray(children);
    if (allRows.length > curSize) {
      visibleRows = allRows.slice((curPage - 1) * curSize, curPage * curSize);
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
    <div id={id} className={`flex min-w-0 flex-col gap-4 ${className}`}>
      <div
        className={`w-full overflow-hidden rounded-lg border-2 border-black/10 bg-surface shadow-none dark:bg-canvas ${
          capped ? "flex-auto" : "shrink-0 grow"
        }`}
      >
        <Table variant="secondary" className="w-full shadow-none">
          <Table.ScrollContainer
            className={`${heightClass} bg-surface dark:bg-canvas ${
              capped ? "overflow-auto" : "overflow-visible"
            }`}
          >
            <Table.Content
              aria-label={ariaLabel}
              // The `[&_td]` rules outrank a cell's own padding classes, so these
              // are what every table actually uses — tightened for small screens.
              className="w-full bg-surface [&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2.5 [&_td]:text-xs sm:[&_td]:px-4 sm:[&_td]:py-3.5 [&_tr:last-child>td]:border-b-0 dark:bg-canvas"
            >
              <Table.Header>
                {columns.map((column, index) => (
                  <Table.Column
                    key={column}
                    id={column}
                    isRowHeader={index === 0}
                    className={`rounded-none border-b border-r border-border bg-surface-tertiary px-3 py-2 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-foreground last:border-r-0 sm:px-4 sm:py-3 sm:text-[0.75rem] ${
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
                          <Table.Cell key={column}>
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

        {showFooter ? (
          // Inside the card, under the rows — sticking it to the viewport made it
          // ride over the table on mobile. One flex row: the pager holds the end.
          <div className="flex items-center justify-between gap-2 border-t border-border bg-surface px-3 py-2 dark:bg-canvas">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              {showSizeSelect ? (
                <PageSizeSelect value={curSize} options={pageSizeOptions} onChange={handleSize} />
              ) : null}
              {summary ? (
                <span
                  aria-live="polite"
                  className="min-w-0 truncate text-[0.6875rem] text-muted sm:text-xs"
                >
                  {summary}
                </span>
              ) : null}
            </div>
            <div className="shrink-0">
              <TablePagination page={curPage} pageCount={pageCount} onPageChange={handlePage} />
            </div>
          </div>
        ) : null}
      </div>

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
    <Select
      aria-label="Rows per page"
      selectedKey={String(value)}
      onSelectionChange={(key) => onChange(Number(key))}
      className="text-left"
    >
      {/* pe-7 keeps the value clear of the absolutely-positioned chevron; w-19 fits three digits. */}
      <Select.Trigger className="flex min-h-7 w-16 items-center justify-between gap-1 rounded-md border border-field-border bg-field ps-2 pe-6 text-xs text-foreground shadow-none transition hover:border-accent/50 sm:min-h-8 sm:w-19 sm:gap-2 sm:ps-2.5 sm:pe-7 sm:text-sm">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="min-w-[--trigger-width] rounded-md border border-border p-1">
        <ListBox>
          {options.map((o) => (
            <ListBox.Item
              key={o}
              id={String(o)}
              className="rounded shadow-none px-3 py-1.5 text-sm"
            >
              {o}
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

// Smaller on a phone, where these are the largest controls on the screen.
const CELL_BASE =
  "size-7 min-w-7 rounded-full text-xs shadow-none sm:size-8 sm:min-w-8 sm:text-sm";

/** A page number, or the ellipsis: unpainted until pointed at. */
const PAGE_CELL = `${CELL_BASE} border-0 bg-transparent text-foreground hover:bg-surface-tertiary`;

const ARROW_CELL = `${CELL_BASE} border-0 bg-transparent text-muted hover:bg-surface-tertiary hover:text-foreground disabled:opacity-40 data-[disabled]:opacity-40`;

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

        {/* Nine cells don't fit a phone; it gets the count instead. */}
        <Pagination.Item className="sm:hidden">
          <span className="flex h-7 items-center px-2 text-xs tabular-nums text-muted">
            {page} / {pageCount}
          </span>
        </Pagination.Item>

        {getPages(page, pageCount).map((p, i) =>
          p === "ellipsis" ? (
            <Pagination.Item key={`ellipsis-${i}`} className="hidden sm:block">
              <Pagination.Ellipsis className={PAGE_CELL} />
            </Pagination.Item>
          ) : (
            <Pagination.Item key={p} className="hidden sm:block">
              <Pagination.Link
                isActive={p === page}
                onPress={() => onPageChange(p)}
                className={
                  p === page
                    ? // Off `CELL_BASE`, not `PAGE_CELL` — the active fill has
                      `${CELL_BASE} z-10 border-0 bg-accent font-semibold text-accent-foreground hover:bg-accent`
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
