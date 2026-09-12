import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { BackLink, Page } from "~/components/page";
import { Button } from "~/components/ui/button";
import { DataTable, type Column } from "~/components/ui/data-table";

/**
 * The frame the four holdings tables share: susu, savings, loans and hire
 * purchase, one product per page.
 *
 * They differ where it matters — a susu cycle is quoted on its daily amount
 * and its progress, a loan on what is left to pay — so each page supplies its
 * own columns. What they have in common is everything around the columns: the
 * way back to the customer, the paging, the empty state, and a way to start a
 * new one. That lives here rather than being written out four times.
 */
export function HoldingsPage<T>({
  customer,
  title,
  noun,
  columns,
  rows,
  rowKey,
  page,
  pageSize,
  total,
  loading,
  emptyTitle,
  emptyBody,
  emptyIcon,
  openTo,
  openLabel,
}: {
  customer: { id: string; fullName: string; status: string };
  /** What this page is a table of — "Susu cycles". */
  title: string;
  noun: { one: string; many: string };
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  page: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  emptyTitle: string;
  emptyBody: string;
  emptyIcon: ReactNode;
  /** Where a new one is opened. Omitted where the counter cannot start one. */
  openTo?: string;
  openLabel?: string;
}) {
  const navigate = useNavigate();
  // Deactivated customers are readable but not workable — the API refuses the
  // write either way, so the button that starts one is not drawn.
  const inactive = customer.status === "inactive";

  return (
    <Page className="max-w-none">
      <BackLink to={`/customers/${customer.id}`} className="mb-4">
        {customer.fullName}
      </BackLink>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-xl font-semibold tracking-tight">{title}</h2>
        {openTo && openLabel && !inactive && (
          <Button asChild size="sm">
            <Link to={openTo}>{openLabel}</Link>
          </Button>
        )}
      </div>

      {inactive && (
        <p className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          This customer is deactivated. Their {noun.many} are listed for
          reference but cannot be worked on until they are reactivated.
        </p>
      )}

      <DataTable<T>
        columns={columns}
        rows={rows}
        rowKey={rowKey}
        noun={noun}
        loading={loading}
        paging={{
          page,
          pageSize,
          total,
          // The page lives in the URL, so a row opened and closed comes back
          // to the page it was on.
          onPageChange: (next) =>
            navigate(next > 1 ? `?page=${String(next)}` : "", { replace: true }),
        }}
        empty={
          <div className="py-12 text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              {emptyIcon}
            </div>
            <p className="font-medium">{emptyTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">{emptyBody}</p>
          </div>
        }
      />
    </Page>
  );
}

/** The page number in the URL, floored at 1. */
export function pageFrom(url: URL): number {
  return Math.max(1, Number(url.searchParams.get("page")) || 1);
}

/** One page of holdings is small; the table is a way in, not a report. */
export const HOLDINGS_PAGE_SIZE = 10;
