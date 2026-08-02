import { useCallback, useEffect, useState, type ReactNode } from "react";
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
  ChevronRight,
  Coins,
  CornerDownRight,
  Filter,
  LoaderCircle,
  Search,
} from "lucide-react";
import type { Route } from "./+types/susu";
import { SusuStatusPill } from "~/components/account-status";
import { DataTable, Table } from "~/components/data-table";
import { FIELD, FilterSelect } from "~/components/form-fields";
import { TextInput } from "~/components/inputs";
import * as susuApi from "~/lib/api/susu";
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
  cyclePercent,
  isSusuAccountStatus,
  SUSU_ACCOUNT_STATUS_LABELS,
  SUSU_ACCOUNT_STATUSES,
  type SusuAccount,
  type SusuAccountStatus,
} from "~/lib/susu-client";
import { requireUser, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Susu · YADAH Dynamic Enterprise" }];
}

const FILTERS_ID = "susu-filters";

/** A whole-book scan reads further than the per-customer one; see `truncated`. */
const SCAN_MAX_PAGES = 10;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  ...SUSU_ACCOUNT_STATUSES.map((status) => ({
    value: status,
    label: SUSU_ACCOUNT_STATUS_LABELS[status],
  })),
  { value: "all", label: "All accounts" },
];

/** The line under a saver's name — where their cycle stands, in words. */
function cycleBlurb(account: SusuAccount): string {
  if (account.status === "active") {
    const left = Math.max(0, account.cycleTarget - account.depositsCount);
    return left === 0
      ? "Target reached — ready to close."
      : `${left} more deposit${left === 1 ? "" : "s"} to finish the cycle.`;
  }
  if (account.payoutAmount !== undefined) {
    return `Paid out ${formatGhs(account.payoutAmount)} after commission.`;
  }
  return account.closedAt
    ? `Closed on ${formatDate(account.closedAt)}.`
    : "No longer collecting.";
}

/** Every account one saver holds on this page; `primary` stands for the rest. */
interface SaverGroup {
  key: string;
  primary: SusuAccount;
  rest: SusuAccount[];
}

/** Which account speaks for a saver: a running cycle, else the newest. */
const STATUS_RANK: Record<SusuAccountStatus, number> = {
  active: 0,
  completed: 1,
  closed: 2,
};

function groupBySaver(accounts: SusuAccount[]): SaverGroup[] {
  const buckets = new Map<string, SusuAccount[]>();
  for (const account of accounts) {
    const key = account.customerId || account.id;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(account);
    else buckets.set(key, [account]);
  }

  return Array.from(buckets, ([key, list]) => {
    const sorted = [...list].sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
        b.openedAt.localeCompare(a.openedAt),
    );
    return { key, primary: sorted[0], rest: sorted.slice(1) };
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);

  const url = new URL(request.url);
  const sp = url.searchParams;
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  // Clamped to the API's own bound (1–100); see the note in customers.tsx.
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") || "20") || 20));
  const typed = typedDigits(sp.get("accountNumber"), "susu");

  const statusParam = sp.get("status");
  const selected =
    isSusuAccountStatus(statusParam) || statusParam === "all"
      ? statusParam!
      : "active";
  const status =
    selected === "all" ? undefined : (selected as SusuAccountStatus);

  const { data: payload, headers } = await withAuth(request, async (token) => {
    // Digits narrow the list, so read several pages and match them here.
    if (typed) {
      const { items, truncated } = await scanAccounts(
        (p) =>
          susuApi.listSusuAccounts(token, { page: p, limit: SCAN_LIMIT, status }),
        SCAN_MAX_PAGES,
      );
      return { result: pageOf(matchNumber(items, typed), page, limit), truncated };
    }
    const result = await susuApi.listSusuAccounts(token, { page, limit, status });
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
      filters: { page, limit, status: selected, accountNumber: typed },
    },
    { headers },
  );
}

const CELL = "px-4 py-3 align-top";

/** One account line. `saver` fills the first column; nested lines sit under it. */
function AccountRow({
  account,
  saver,
  nested,
}: {
  account: SusuAccount;
  saver: ReactNode;
  nested?: boolean;
}) {
  return (
    <Table.Row
      id={account.id}
      className={nested ? "bg-surface-tertiary/40" : undefined}
    >
      <Table.Cell className={`${CELL} font-medium text-foreground`}>
        {saver}
      </Table.Cell>
      <Table.Cell className={`${CELL} tabular-nums text-muted`}>
        {account.accountNumber}
      </Table.Cell>
      <Table.Cell className={CELL}>
        <SusuStatusPill status={account.status} />
      </Table.Cell>
      <Table.Cell className={`${CELL} tabular-nums text-muted`}>
        {account.depositsCount} of {account.cycleTarget}
        <span className="mt-1.5 block h-1 w-20 overflow-hidden rounded-full bg-border">
          <span
            className="block h-full rounded-full bg-success"
            style={{ width: `${cyclePercent(account)}%` }}
          />
        </span>
      </Table.Cell>
      <Table.Cell className={`${CELL} tabular-nums text-muted`}>
        {formatGhs(account.dailyAmount, { symbol: null })}
      </Table.Cell>
      <Table.Cell className={`${CELL} tabular-nums text-muted`}>
        {formatGhs(account.totalDeposited, { symbol: null })}
      </Table.Cell>
      <Table.Cell className={`${CELL} text-muted`}>
        {formatDate(account.openedAt)}
      </Table.Cell>
    </Table.Row>
  );
}

export default function Susu({ loaderData }: Route.ComponentProps) {
  const { result, truncated, filters } = loaderData;
  const navigation = useNavigation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const [number, setNumber] = useState(filters.accountNumber);
  const activeFilters = filters.status === "active" ? 0 : 1;
  const [filtersOpen, setFiltersOpen] = useState(activeFilters > 0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));
  const groups = groupBySaver(result.items);

  function toggleSaver(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

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
            Susu
          </h1>
          <p className="mt-1 text-sm text-muted">
            Every susu cycle in the book, with what it takes daily and what it
            has collected.
          </p>
        </div>
        <Link
          to="/customers"
          className="flex min-h-8 items-center gap-1.5 rounded-md bg-success px-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <Coins size={12} />
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
              aria-label="Search by susu account number"
              value={number}
              onChange={(value) => setNumber(typedDigits(value, "susu"))}
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
            onChange={(value) => setParam({ status: value, page: null })}
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
          "Saver",
          "Account",
          "Status",
          "Cycle",
          "Daily",
          "Collected",
          "Opened",
        ]}
        ariaLabel="Susu accounts"
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
              ? "No susu accounts"
              : `Showing ${(result.page - 1) * result.limit + 1}–${Math.min(
                  result.page * result.limit,
                  result.total,
                )} of ${result.total}${
                  groups.length < result.items.length
                    ? ` · ${groups.length} savers`
                    : ""
                }`
        }
        emptyContent={{
          icon: <Coins size={20} />,
          title: "No susu accounts found",
          subtext: filters.accountNumber
            ? `No account number contains “${filters.accountNumber}”.`
            : filters.status === "all"
              ? "Pick a customer to open the first one."
              : `No cycles are ${SUSU_ACCOUNT_STATUS_LABELS[
                  filters.status as SusuAccountStatus
                ].toLowerCase()}. Switch the filter to see the rest.`,
          button:
            !filters.accountNumber && filters.status === "all" ? (
              <Link
                to="/customers"
                className="flex min-h-9 items-center gap-1.5 rounded-md bg-success px-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                <Coins size={14} />
                Open an account
              </Link>
            ) : undefined,
        }}
      >
        {groups.flatMap((group) => {
          const open = expanded.has(group.key);
          const rows = [
            <AccountRow
              key={group.primary.id}
              account={group.primary}
              saver={
                <>
                  <span className="flex items-start gap-1.5">
                    {group.rest.length > 0 && (
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={`${open ? "Hide" : "Show"} ${group.rest.length} more account${
                          group.rest.length === 1 ? "" : "s"
                        } for ${group.primary.customerName ?? "this saver"}`}
                        onClick={() => toggleSaver(group.key)}
                        className="-ml-1 mt-px flex size-5 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-surface-tertiary hover:text-foreground"
                      >
                        <ChevronRight
                          size={14}
                          className={`transition-transform ${open ? "rotate-90" : ""}`}
                        />
                      </button>
                    )}
                    <Link
                      to={`/susu/${group.primary.id}`}
                      className="min-w-0 truncate hover:text-success hover:underline"
                    >
                      {group.primary.customerName ?? "Unnamed customer"}
                    </Link>
                    {group.rest.length > 0 && (
                      <span className="shrink-0 rounded-full bg-surface-tertiary px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted">
                        {group.rest.length + 1} accounts
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[0.8125rem] font-normal text-navy dark:text-navy-light">
                    {cycleBlurb(group.primary)}
                  </span>
                </>
              }
            />,
          ];

          if (open) {
            for (const account of group.rest) {
              rows.push(
                <AccountRow
                  key={account.id}
                  account={account}
                  nested
                  saver={
                    <span className="flex items-start gap-1.5 pl-5">
                      <CornerDownRight
                        size={13}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-muted"
                      />
                      <Link
                        to={`/susu/${account.id}`}
                        className="min-w-0 text-[0.8125rem] font-normal text-navy hover:text-success hover:underline dark:text-navy-light"
                      >
                        {cycleBlurb(account)}
                      </Link>
                    </span>
                  }
                />,
              );
            }
          }

          return rows;
        })}
      </DataTable>
    </div>
  );
}
