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
import { Filter, LoaderCircle, PiggyBank, Search } from "lucide-react";
import type { Route } from "./+types/savings";
import { SavingsStatusPill } from "~/components/account-status";
import { DataTable, Table } from "~/components/data-table";
import { FIELD, FilterSelect } from "~/components/form-fields";
import { TextInput } from "~/components/inputs";
import * as savingsApi from "~/lib/api/savings";
import {
  matchNumber,
  pageOf,
  scanAccounts,
  SCAN_LIMIT,
  typedDigits,
} from "~/lib/account-scan";
import { formatDate } from "~/lib/format";
import { formatGhs } from "~/lib/money";
import {
  isSavingsAccountStatus,
  SAVINGS_ACCOUNT_STATUS_LABELS,
  SAVINGS_ACCOUNT_STATUSES,
  type SavingsAccountStatus,
} from "~/lib/savings-client";
import { requireUser, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Savings · YADAH Dynamic Enterprise" }];
}

const FILTERS_ID = "savings-filters";

/** A whole-book scan reads further than the per-customer one; see `truncated`. */
const SCAN_MAX_PAGES = 10;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All accounts" },
  ...SAVINGS_ACCOUNT_STATUSES.map((status) => ({
    value: status,
    label: SAVINGS_ACCOUNT_STATUS_LABELS[status],
  })),
];

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);

  const url = new URL(request.url);
  const sp = url.searchParams;
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  // Clamped to the API's own bound (1–100); see the note in customers.tsx.
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") || "20") || 20));
  const typed = typedDigits(sp.get("accountNumber"), "savings");
  const statusParam = sp.get("status");
  const status: SavingsAccountStatus | undefined = isSavingsAccountStatus(
    statusParam,
  )
    ? statusParam
    : undefined;

  const { data: payload, headers } = await withAuth(request, async (token) => {
    // Digits narrow the list, so read several pages and match them here.
    if (typed) {
      const { items, truncated } = await scanAccounts(
        (p) =>
          savingsApi.listSavingsAccounts(token, {
            page: p,
            limit: SCAN_LIMIT,
            status,
          }),
        SCAN_MAX_PAGES,
      );
      return { result: pageOf(matchNumber(items, typed), page, limit), truncated };
    }
    const result = await savingsApi.listSavingsAccounts(token, {
      page,
      limit,
      status,
    });
    return { result, truncated: false };
  });

  const { result, truncated } = payload;

  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));
  if (page > pageCount) {
    url.searchParams.set("page", String(pageCount));
    throw redirect(url.pathname + url.search, { headers });
  }

  return data(
    {
      result,
      truncated,
      filters: {
        page,
        limit,
        status: status ?? "",
        accountNumber: typed,
      },
    },
    { headers },
  );
}

export default function Savings({ loaderData }: Route.ComponentProps) {
  const { result, truncated, filters } = loaderData;
  const navigation = useNavigation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const [number, setNumber] = useState(filters.accountNumber);
  const activeFilters = filters.status ? 1 : 0;
  const [filtersOpen, setFiltersOpen] = useState(activeFilters > 0);

  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));

  const pendingNumber =
    navigation.state === "loading" && navigation.location
      ? (new URLSearchParams(navigation.location.search).get("accountNumber") ??
        "")
      : null;
  const searching =
    pendingNumber !== null && pendingNumber !== filters.accountNumber;

  const commitNumber = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set("accountNumber", value);
          else next.delete("accountNumber");
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
    if (number === filters.accountNumber) return;
    const timer = setTimeout(() => commitNumber(number), 300);
    return () => clearTimeout(timer);
  }, [number, filters.accountNumber, commitNumber]);

  // Back/forward moves the URL out from under the field, so adopt it.
  useEffect(() => {
    if (navigationType === "POP") setNumber(filters.accountNumber);
  }, [navigationType, filters.accountNumber]);

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
            Savings
          </h1>
          <p className="mt-1 text-sm text-muted">
            Every savings account in the book, with what is held and what can be
            withdrawn.
          </p>
        </div>
        <Link
          to="/customers"
          className="flex min-h-8 items-center gap-1.5 rounded-md bg-success px-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <PiggyBank size={12} />
          Open an account
        </Link>
      </div>

      {/* A real GET form, so the filters still work with JavaScript off. */}
      <Form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          commitNumber(number);
        }}
      >
        <div className="flex w-full max-w-xs items-center gap-2">
          <div className="relative flex-1">
            <TextInput
              name="accountNumber"
              aria-label="Search by savings account number"
              value={number}
              onChange={(value) => setNumber(typedDigits(value, "savings"))}
              inputProps={{
                placeholder: "Account number",
                inputMode: "numeric",
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
          <FilterSelect
            name="status"
            label="Filter by status"
            value={filters.status}
            onChange={(value) => setParam({ status: value || null, page: null })}
            options={STATUS_OPTIONS}
          />
        </div>
      </Form>

      {truncated && (
        <p className="mb-3 rounded-lg border-2 border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          More accounts exist than this search reads, so a matching number may be
          missing. Type more digits to narrow it.
        </p>
      )}

      <DataTable
        columns={[
          "Customer",
          "Account",
          "Balance",
          "Available",
          "Status",
          "Opened",
        ]}
        ariaLabel="Savings accounts"
        isLoading={navigation.state === "loading" && !searching}
        page={result.page}
        pageCount={pageCount}
        onPageChange={(p) => setParam({ page: String(p) })}
        pageSize={result.limit}
        onPageSizeChange={(s) => setParam({ limit: String(s), page: "1" })}
        // Contains the loader's default of 20; see the note in customers.tsx.
        pageSizeOptions={[10, 20, 50, 100]}
        summary={
          searching
            ? "Searching…"
            : result.total === 0
              ? "No savings accounts"
              : `Showing ${(result.page - 1) * result.limit + 1}–${Math.min(
                  result.page * result.limit,
                  result.total,
                )} of ${result.total}`
        }
        emptyContent={{
          icon: <PiggyBank size={20} />,
          title: "No savings accounts found",
          subtext: filters.accountNumber
            ? `No account number contains “${filters.accountNumber}”.`
            : filters.status
              ? `No accounts are ${SAVINGS_ACCOUNT_STATUS_LABELS[
                  filters.status as SavingsAccountStatus
                ].toLowerCase()}.`
              : "Pick a customer to open the first one.",
          button:
            !filters.accountNumber && !filters.status ? (
              <Link
                to="/customers"
                className="flex min-h-9 items-center gap-1.5 rounded-md bg-success px-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                <PiggyBank size={14} />
                Open an account
              </Link>
            ) : undefined,
        }}
      >
        {result.items.map((account) => (
          <Table.Row key={account.id} id={account.id}>
            <Table.Cell className="px-4 py-2 font-medium text-foreground">
              <Link
                to={`/savings/${account.id}`}
                className="block truncate hover:text-success hover:underline"
              >
                {account.customerName ?? "Unnamed customer"}
              </Link>
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {account.accountNumber}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {formatGhs(account.balance, { symbol: null })}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {formatGhs(account.availableToWithdraw, { symbol: null })}
            </Table.Cell>
            <Table.Cell className="px-4 py-2">
              <SavingsStatusPill status={account.status} />
            </Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">
              {formatDate(account.openedAt)}
            </Table.Cell>
          </Table.Row>
        ))}
      </DataTable>
    </div>
  );
}
