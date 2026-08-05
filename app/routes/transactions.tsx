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
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Receipt,
  Search,
} from "lucide-react";
import type { Route } from "./+types/transactions";
import { DataTable, Table } from "~/components/data-table";
import { FIELD } from "~/components/form-fields";
import { TextInput } from "~/components/inputs";
import { PageHeader } from "~/components/page-header";
import { TabLink, TabList } from "~/components/tabs";
import * as usersApi from "~/lib/api/users";
import { formatDate } from "~/lib/format";
import { formatGhs } from "~/lib/money";
import {
  isTxnProduct,
  totalsOf,
  TXN_DIRECTIONS,
  TXN_KIND_LABELS,
  TXN_PRODUCT_LABELS,
  type TxnKind,
  type TxnProduct,
} from "~/lib/transactions-client";
import { loadBookTransactions } from "~/lib/transactions.server";
import { isOffice, requireUser, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Transactions · YADAH Dynamic Enterprise" }];
}

/** Accounts read per product, per page. Each one costs a statement call. */
const ACCOUNT_WINDOW = [10, 20, 50];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const office = isOffice(user);

  const url = new URL(request.url);
  const sp = url.searchParams;
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  const limit = Math.min(
    50,
    Math.max(1, Number(sp.get("limit") || "10") || 10),
  );
  // Fuzzy server-side: a name, a phone, or the first digits of a number.
  const search = sp.get("search")?.trim().slice(0, 100) || undefined;

  const { data: payload, headers } = await withAuth(request, async (token) => {
    const [book, staff] = await Promise.all([
      loadBookTransactions(token, { page, limit, search, office }),
      // Only to name who recorded each line, and only office roles may ask.
      office ? usersApi.listUsers(token, { limit: 100 }) : null,
    ]);

    const staffNames: Record<string, string> = {};
    for (const member of staff?.items ?? []) staffNames[member.id] = member.name;

    return { book, staffNames };
  });

  const { book, staffNames } = payload;

  if (page > book.pageCount) {
    url.searchParams.set("page", String(book.pageCount));
    throw redirect(url.pathname + url.search, { headers });
  }

  return data(
    {
      ...book,
      staffNames,
      canManage: office,
      filters: { page, limit, search: search ?? "" },
    },
    { headers },
  );
}

export default function Transactions({ loaderData }: Route.ComponentProps) {
  const {
    rows,
    accountsRead,
    totalAccounts,
    pageCount,
    staffNames,
    canManage,
    filters,
  } = loaderData;
  const navigation = useNavigation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(filters.search);

  const productParam = searchParams.get("product");
  const product = isTxnProduct(productParam) ? productParam : null;

  const visible = product ? rows.filter((row) => row.product === product) : rows;
  const totals = totalsOf(visible);

  // Only offer a tab for a product this window actually turned something up on.
  const products = PRODUCT_ORDER.filter((entry) =>
    rows.some((row) => row.product === entry),
  );

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
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { preventScrollReset: true });
  }

  function tabTo(next: TxnProduct | null) {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("product", next);
    else params.delete("product");
    return `?${params}`;
  }

  const firstAccount = (filters.page - 1) * filters.limit + 1;

  return (
    <div className="mx-auto w-full px-6 py-8">
      <PageHeader
        title="Transactions"
        subtitle={
          canManage
            ? "Every payment in the book — susu, savings, loans and hire purchase."
            : "Every susu and savings payment in the book."
        }
      />

      {/* Scoped, and said so: these count the rows below, not the whole book. */}
      <p className="mb-2 text-xs text-muted">
        Totals for the {visible.length} transaction
        {visible.length === 1 ? "" : "s"} shown
        {filters.search ? ` matching “${filters.search}”` : ""}.
      </p>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Total label="Paid in" value={totals.in} tone="in" />
        <Total label="Paid out" value={totals.out} tone="out" />
        <Total label="Net" value={totals.net} tone="net" />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {products.length > 1 && (
            <div className="overflow-x-auto">
              <TabList label="Filter by product">
                <TabLink
                  to={tabTo(null)}
                  selected={product === null}
                  controls="transactions-table"
                >
                  All
                </TabLink>
                {products.map((entry) => (
                  <TabLink
                    key={entry}
                    to={tabTo(entry)}
                    selected={product === entry}
                    controls="transactions-table"
                  >
                    {TXN_PRODUCT_LABELS[entry]}
                  </TabLink>
                ))}
              </TabList>
            </div>
          )}

          {/* A real GET form, so search still works with JavaScript off. */}
          <Form
            method="get"
            onSubmit={(event) => {
              event.preventDefault();
              commitSearch(search);
            }}
          >
            <div className="relative w-full min-w-56 sm:w-72">
              <TextInput
                name="search"
                aria-label="Search transactions by customer"
                value={search}
                onChange={setSearch}
                inputProps={{
                  placeholder: "Customer name, phone or account number",
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
          </Form>
        </div>

        <AccountWindow
          first={firstAccount}
          read={accountsRead}
          total={totalAccounts}
          page={filters.page}
          pageCount={pageCount}
          limit={filters.limit}
          onPage={(next) => setParam({ page: String(next) })}
          onLimit={(next) => setParam({ limit: String(next), page: "1" })}
        />
      </div>

      <DataTable
        id="transactions-table"
        columns={
          canManage
            ? ["Date", "Type", "Customer", "Account", "Amount", "Fee", "Recorded by"]
            : ["Date", "Type", "Customer", "Account", "Amount", "Fee"]
        }
        ariaLabel="Transaction history"
        isLoading={navigation.state === "loading" && !searching}
        paginated
        pageSizeOptions={[10, 25, 50]}
        resetKey={`${filters.page}:${filters.search}:${product ?? "all"}`}
        summary={`${visible.length} transaction${visible.length === 1 ? "" : "s"} in this window`}
        emptyContent={{
          icon: <Receipt size={20} />,
          title: "Nothing recorded here",
          subtext: filters.search
            ? `No payments on accounts matching “${filters.search}”.`
            : product
              ? `No ${TXN_PRODUCT_LABELS[product].toLowerCase()} payments on these accounts.`
              : "These accounts have no payments yet. Try the next window.",
        }}
      >
        {visible.map((row) => (
          <Table.Row key={row.id} id={row.id}>
            <Table.Cell className="px-4 py-2 text-muted">
              {formatDate(row.at)}
            </Table.Cell>
            <Table.Cell className="px-4 py-2">
              <KindBadge kind={row.kind} />
            </Table.Cell>
            <Table.Cell className="px-4 py-2 font-medium text-foreground">
              <span className="block truncate">{row.customerName}</span>
            </Table.Cell>
            <Table.Cell className="px-4 py-2">
              <Link
                to={row.to}
                className="text-muted hover:text-success hover:underline"
              >
                {row.accountLabel}
              </Link>
              {row.detail && (
                <span className="ml-1.5 text-xs text-muted">· {row.detail}</span>
              )}
            </Table.Cell>
            <Table.Cell
              className={`px-4 py-2 font-medium tabular-nums ${
                TXN_DIRECTIONS[row.kind] === "in"
                  ? "text-success"
                  : "text-foreground"
              }`}
            >
              {TXN_DIRECTIONS[row.kind] === "in" ? "+" : "−"}
              {formatGhs(row.amount, { symbol: null })}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {row.fee ? formatGhs(row.fee, { symbol: null }) : "—"}
            </Table.Cell>
            {canManage && (
              <Table.Cell className="px-4 py-2 text-muted">
                {row.recordedById
                  ? (staffNames[row.recordedById] ?? "Unknown")
                  : "—"}
              </Table.Cell>
            )}
          </Table.Row>
        ))}
      </DataTable>
    </div>
  );
}

const PRODUCT_ORDER: TxnProduct[] = ["susu", "savings", "loan", "hire-purchase"];

/** Which slice of the account book this page read, and how to move it. */
function AccountWindow({
  first,
  read,
  total,
  page,
  pageCount,
  limit,
  onPage,
  onLimit,
}: {
  first: number;
  read: number;
  total: number;
  page: number;
  pageCount: number;
  limit: number;
  onPage: (page: number) => void;
  onLimit: (limit: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span aria-live="polite">
        {total === 0
          ? "No accounts match"
          : `Accounts ${first}–${first + read - 1} of ${total}`}
      </span>

      <select
        aria-label="Accounts read per product"
        value={limit}
        onChange={(event) => onLimit(Number(event.target.value))}
        className="min-h-8 rounded-md border-2 border-border bg-field px-2 text-xs text-foreground"
      >
        {ACCOUNT_WINDOW.map((size) => (
          <option key={size} value={size}>
            {size} per product
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous accounts"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className={ARROW}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="tabular-nums">
          {page} / {pageCount}
        </span>
        <button
          type="button"
          aria-label="Next accounts"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          className={ARROW}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

const ARROW =
  "flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-tertiary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent";

/** Money in and money out, told apart by more than a minus sign. */
function KindBadge({ kind }: { kind: TxnKind }) {
  const inbound = TXN_DIRECTIONS[kind] === "in";
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
        inbound
          ? "bg-success/15 text-success"
          : "bg-brand/15 text-brand-dark dark:text-brand-light"
      }`}
    >
      {inbound ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}
      {TXN_KIND_LABELS[kind]}
    </span>
  );
}

function Total({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "in" | "out" | "net";
}) {
  const colour =
    tone === "in"
      ? "text-success"
      : tone === "out"
        ? "text-brand-dark dark:text-brand-light"
        : "text-foreground";

  return (
    <div className="rounded-lg border-2 border-border bg-surface p-4 dark:bg-canvas">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className={`mt-1 font-sen text-xl font-semibold tabular-nums ${colour}`}>
        {formatGhs(value)}
      </p>
    </div>
  );
}
