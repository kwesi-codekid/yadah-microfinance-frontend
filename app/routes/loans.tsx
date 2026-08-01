import { useCallback, useEffect, useState } from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useNavigation,
  useNavigationType,
  useSearchParams,
} from "react-router";
import {
  Filter,
  HandCoins,
  LoaderCircle,
  Search,
  Settings2,
} from "lucide-react";
import type { Route } from "./+types/loans";
import { DataTable, Table } from "~/components/data-table";
import { TextInput } from "~/components/inputs";
import { FIELD, FilterSelect } from "~/components/form-fields";
import { LoanStatusPill } from "~/components/loan-status";
import * as loansApi from "~/lib/api/loans";
import { formatDate } from "~/lib/format";
import {
  isLoanStatus,
  LOAN_STATUS_LABELS,
  LOAN_STATUSES,
  repaidPercent,
  type LoanStatus,
} from "~/lib/loan-client";
import { formatGhs } from "~/lib/money";
import { requireOffice, withAuth } from "~/lib/session.server";

/**
 * The loan book, and the approval queue inside it.
 *
 * This is the one cross-customer ledger in the app, and it exists where the
 * susu equivalent was deliberately deleted. The difference is in the API: `GET
 * /susu/accounts` has no `search` and returns no customer name, so a
 * cross-customer list of accounts was a page you could not find anything in.
 * `GET /loans` has both — and more to the point, a **pending application has to
 * be found by whoever approves it**, who has no reason to have opened the
 * customer's record first. A queue nobody can see is a queue nobody works.
 *
 * One customer's loans still hang off the customer, at
 * [customer-loans.tsx](app/routes/customer-loans.tsx), which is where an
 * application is made.
 */

export function meta(_: Route.MetaArgs) {
  return [{ title: "Loans · YADAH Dynamic Enterprise" }];
}

const FILTERS_ID = "loan-filters";

/** Statuses worth surfacing as a filter, in the order the office works them. */
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All loans" },
  ...LOAN_STATUSES.map((status) => ({
    value: status,
    label: LOAN_STATUS_LABELS[status],
  })),
];

export async function loader({ request }: Route.LoaderArgs) {
  // Every loan endpoint is office-only — the API's `Loans` tag says so outright.
  // Unlike susu and savings there is no half of this a collector takes part in.
  await requireOffice(request);

  const url = new URL(request.url);
  const sp = url.searchParams;
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  // Clamped to the API's own bound (1–100); see the note in customers.tsx.
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") || "20") || 20));
  const search = sp.get("search")?.trim() || undefined;
  const customerId = sp.get("customerId")?.trim() || undefined;
  // A hand-edited status that isn't one falls back to "all" rather than being
  // sent to be rejected.
  const statusParam = sp.get("status");
  const status: LoanStatus | undefined = isLoanStatus(statusParam)
    ? statusParam
    : undefined;

  const { data: result, headers } = await withAuth(request, (token) =>
    loansApi.listLoans(token, { page, limit, status, search, customerId }),
  );

  // A page past the end lands on the last real one; see the note in
  // customers.tsx. Commonest cause here is clearing a status filter while deep
  // in the book.
  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));
  if (page > pageCount) {
    url.searchParams.set("page", String(pageCount));
    throw redirect(url.pathname + url.search, { headers });
  }

  return data(
    {
      result,
      filters: {
        page,
        limit,
        status: status ?? "",
        search: search ?? "",
        customerId: customerId ?? "",
      },
    },
    { headers },
  );
}

export default function Loans({ loaderData }: Route.ComponentProps) {
  const { result, filters } = loaderData;
  const navigation = useNavigation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(filters.search);
  const activeFilters = filters.status ? 1 : 0;
  const [filtersOpen, setFiltersOpen] = useState(activeFilters > 0);

  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));

  const pendingSearch =
    navigation.state === "loading" && navigation.location
      ? (new URLSearchParams(navigation.location.search).get("search") ?? "")
      : null;
  const searching = pendingSearch !== null && pendingSearch !== filters.search;

  const commitSearch = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set("search", value);
          else next.delete("search");
          next.delete("page");
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setSearchParams],
  );

  // Live search: one request per pause in typing, not per keystroke.
  useEffect(() => {
    if (search === filters.search) return;
    const timer = setTimeout(() => commitSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search, filters.search, commitSearch]);

  // Back/forward moves the URL out from under the field, so adopt it.
  useEffect(() => {
    if (navigationType === "POP") setSearch(filters.search);
  }, [navigationType, filters.search]);

  function setParam(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next);
  }

  return (
    <div className="mx-auto w-full px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Loans
          </h1>
          <p className="mt-1 text-sm text-muted">
            An application is recorded against a customer, with their saving
            history in front of it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* This goes to the customer directory rather than to a form,
              because there is no application without a customer — the
              eligibility summary is half the page and it is keyed on one. The
              label says "Start" rather than "New" for exactly that reason: the
              next screen is a choice, not the form. */}
          <Link
            to="/customers"
            className="flex min-h-8 items-center gap-1.5 rounded-md bg-success px-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <HandCoins size={12} />
            Start an application
          </Link>
          <Link
            to="/loans/config"
            className="flex min-h-8 items-center gap-1.5 rounded-md border-2 border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-secondary"
          >
            <Settings2 size={12} />
            Loan settings
          </Link>
        </div>
      </div>

      {/* A real GET form, so the filters still work with JavaScript off. */}
      <Form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          commitSearch(search);
        }}
      >
        <div className="flex w-full max-w-xs items-center gap-2">
          <div className="relative flex-1">
            <TextInput
              name="search"
              aria-label="Search loans"
              value={search}
              onChange={setSearch}
              inputProps={{
                placeholder: "Customer name or phone",
                autoComplete: "off",
                className: `${FIELD} py-1 pl-8`,
              }}
            />
            {searching ? (
              <LoaderCircle
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-2.5 my-auto animate-spin text-success"
              />
            ) : (
              <Search
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-2.5 my-auto text-success"
              />
            )}
          </div>

          <button
            type="button"
            aria-label={
              activeFilters ? `Filters (${activeFilters} applied)` : "Filters"
            }
            aria-expanded={filtersOpen}
            aria-controls={FILTERS_ID}
            onClick={() => setFiltersOpen((prev) => !prev)}
            className="relative flex size-9 shrink-0 items-center justify-center rounded-md border-2 border-border bg-field text-muted transition-colors hover:text-foreground sm:hidden"
          >
            <Filter size={16} />
            {activeFilters > 0 && (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 size-2.5 rounded-full bg-success ring-2 ring-surface"
              />
            )}
          </button>
        </div>

        <div
          id={FILTERS_ID}
          className={`${filtersOpen ? "flex" : "hidden"} w-full flex-wrap items-end gap-3 sm:flex sm:w-auto`}
        >
          {/* Unlike customers, `status` here is genuinely optional on the API,
              so "all" is a real value and the default — the book is the point,
              and the queue is one click into it. */}
          <FilterSelect
            name="status"
            label="Filter by status"
            value={filters.status}
            onChange={(value) => setParam({ status: value || null, page: null })}
            options={STATUS_OPTIONS}
          />
        </div>

        {/* One customer's book, when arrived at from their record. Shown as a
            clearable chip rather than a dropdown: the id means nothing on
            screen, so there is nothing to *choose* here, only something to
            drop. */}
        {filters.customerId && (
          <button
            type="button"
            onClick={() => setParam({ customerId: null, page: null })}
            className="flex min-h-8 items-center gap-1.5 rounded-full border-2 border-border px-3 text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            One customer only · clear
          </button>
        )}

      </Form>

      {/* Same range line as the customer directory — a pager with nothing
          stating the range is a pager you have to trust. */}
      <p aria-live="polite" className="mb-2 text-xs text-muted">
        {searching
          ? "Searching…"
          : result.total === 0
            ? "No loans"
            : `Showing ${(result.page - 1) * result.limit + 1}–${Math.min(
                result.page * result.limit,
                result.total,
              )} of ${result.total}`}
      </p>

      <DataTable
        columns={[
          "Customer",
          "Principal",
          "Term",
          "Status",
          "Repaid",
          "Applied",
        ]}
        ariaLabel="Loan book"
        isLoading={navigation.state === "loading" && !searching}
        page={result.page}
        pageCount={pageCount}
        onPageChange={(p) => setParam({ page: String(p) })}
        pageSize={result.limit}
        onPageSizeChange={(s) => setParam({ limit: String(s), page: "1" })}
        // Contains the loader's default of 20; see the note in customers.tsx.
        pageSizeOptions={[10, 20, 50, 100]}
        emptyContent={{
          icon: <HandCoins size={20} />,
          title: "No loans found",
          subtext: filters.search
            ? `Nothing matches “${filters.search}”.`
            : filters.status
              ? `No loans are ${LOAN_STATUS_LABELS[filters.status as LoanStatus].toLowerCase()}.`
              : "Pick a customer to record the first one.",
          // An empty book is the one screen where the way in matters most, so
          // it gets the button rather than only the sentence.
          button:
            !filters.search && !filters.status ? (
              <Link
                to="/customers"
                className="flex min-h-9 items-center gap-1.5 rounded-md bg-success px-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                <HandCoins size={14} />
                Start an application
              </Link>
            ) : undefined,
        }}
      >
        {result.items.map((loan) => (
          <Table.Row key={loan.id} id={loan.id}>
            <Table.Cell className="px-4 py-2 font-medium text-foreground">
              <Link
                to={`/loans/${loan.id}`}
                className="block truncate hover:text-success hover:underline"
              >
                {/* `customerName` is joined onto list rows but not onto the
                    detail response, so this is the one place it comes free. */}
                {loan.customerName ?? "Unnamed customer"}
              </Link>
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {formatGhs(loan.principal, { symbol: null })}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">
              {loan.durationMonths} mo · {loan.ratePercent}%
            </Table.Cell>
            <Table.Cell className="px-4 py-2">
              <LoanStatusPill loan={loan} />
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {/* Two figures, not a percentage: "₵400 of ₵1,100" is what gets
                  read down a phone, and the bar underneath is the glance. */}
              {loan.status === "pending" || loan.status === "rejected" ? (
                "—"
              ) : (
                <span className="block">
                  {formatGhs(loan.totalRepaid, { symbol: null })} of{" "}
                  {formatGhs(loan.totalDue, { symbol: null })}
                  <span className="mt-1 block h-1 w-24 overflow-hidden rounded-full bg-border">
                    <span
                      className="block h-full rounded-full bg-success"
                      style={{ width: `${repaidPercent(loan)}%` }}
                    />
                  </span>
                </span>
              )}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">
              {formatDate(loan.appliedAt)}
            </Table.Cell>
          </Table.Row>
        ))}
      </DataTable>
    </div>
  );
}

