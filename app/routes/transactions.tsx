import {
  ArrowDownLeftIcon,
  ArrowLeftRightIcon,
  ArrowUpRightIcon,
  LayersIcon,
  UserIcon,
} from "lucide-react";
import { data, Link, useNavigation, useSubmit } from "react-router";

import { getCustomer } from "~/api/customers";
import { listTransactions } from "~/api/reports";
import {
  DayRangeChip,
  DayRangeFilter,
  ExportMenu,
  FilterBar,
  FilterChip,
  ListingCard,
  ListingFooter,
  ListingToolbar,
  StatusTabs,
  Th,
} from "~/components/listing";
import { Page, PageHeader } from "~/components/page";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  formatAccraDateTime,
  formatAmount,
  formatCount,
  formatPesewas,
} from "~/lib/format";
import {
  MODULES,
  MODULE_DOT,
  MODULE_LABELS,
  TXN_TYPE_LABELS,
  netCash,
  refPath,
  type Direction,
  type TransactionTotals,
  type TxnModule,
  type UnifiedTransaction,
} from "~/lib/reports";
import { requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/transactions";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Transactions · Yadah Dynamic Enterprise" }];
}

const PAGE_SIZE = 25;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Filters {
  module: TxnModule | "";
  customerId: string;
  from: string;
  to: string;
}

function readFilters(url: URL): Filters {
  const moduleParam = url.searchParams.get("module") as TxnModule | null;
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : "";
  };
  return {
    module: moduleParam && MODULES.includes(moduleParam) ? moduleParam : "",
    customerId: url.searchParams.get("customerId")?.trim() ?? "",
    from: day("from"),
    to: day("to"),
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.module) p.set("module", f.module);
  if (f.customerId) p.set("customerId", f.customerId);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (page > 1) p.set("page", String(page));
  return p;
}

function hrefFor(f: Filters, page = 1): string {
  const s = queryFor(f, page).toString();
  return s ? `/transactions?${s}` : "/transactions";
}

/**
 * `GET /reports/transactions` — every money event in the business as one list.
 *
 * Office only. The whole `/reports` surface is, which is why the rail hides
 * this module from collectors: a collector's own day is reconciled on the susu
 * summary, which is scoped to them and which they may read.
 *
 * The range defaults to the last 30 Accra days on the API's side, and the
 * response says which days it settled on — that is what the chip echoes, so
 * nobody has to guess what "no filter" covered.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const [feed, customer] = await Promise.all([
      listTransactions(token, {
        page,
        limit: PAGE_SIZE,
        module: filters.module || undefined,
        customerId: filters.customerId || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
      }),
      // Only to name the chip. A filter that reads `customerId=8f3c…` tells
      // nobody whose ledger they are looking at.
      filters.customerId
        ? getCustomer(token, filters.customerId)
            .then((r) => r.customer)
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    return { feed, customer };
  });

  const { feed } = result;

  return data(
    {
      filters,
      page,
      /** The days the API actually covered, filter or no filter. */
      range: { from: feed.from, to: feed.to },
      customerName: result.customer?.fullName ?? null,
      total: feed.total,
      totals: feed.totals,
      rows: feed.items.map(toRow),
    },
    { headers },
  );
}

/* -------------------------------------------------------------------- rows --- */

interface Row {
  id: string;
  module: TxnModule;
  what: string;
  direction: Direction;
  amount: number;
  fee: number;
  detail: string | null;
  customerId: string;
  customerName: string;
  where: string;
  wherePath: string | null;
  recordedBy: string;
  at: string;
}

function toRow(t: UnifiedTransaction): Row {
  return {
    id: t.id,
    module: t.module,
    what: TXN_TYPE_LABELS[t.type] ?? t.type,
    direction: t.direction,
    amount: t.amount,
    fee: t.fee,
    detail: t.detail,
    customerId: t.customerId,
    customerName: t.customerName,
    where: t.ref.accountNumber ? `#${t.ref.accountNumber}` : MODULE_LABELS[t.module],
    wherePath: refPath(t),
    // `System` is the API's own word for the automated debt-recovery moves.
    recordedBy: t.recordedByName ?? "System",
    at: formatAccraDateTime(t.createdAt),
  };
}

export default function Transactions({ loaderData }: Route.ComponentProps) {
  const { filters, page, range, customerName, total, totals, rows } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();

  const busy =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/transactions";

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), {
      replace: true,
      preventScrollReset: true,
    });

  const narrowed = Boolean(filters.module || filters.customerId);

  return (
    <Page className="max-w-none">
      <PageHeader
        title="Transactions"
        description="Every movement of money, across every module, newest first."
      />

      <TotalsBand totals={totals} />

      <ListingCard>
        <ListingToolbar
          tabs={
            <StatusTabs
              tabs={[
                { key: "", label: "All modules" },
                ...MODULES.map((m) => ({ key: m, label: MODULE_LABELS[m] })),
              ]}
              active={filters.module}
              hrefFor={(key) => hrefFor({ ...filters, module: key as TxnModule | "" })}
            />
          }
        >
          <DayRangeFilter
            from={filters.from}
            to={filters.to}
            title="Recorded"
            apply={(next) => apply(next)}
          />
          <ExportMenu
            path="/transactions/export"
            query={(() => {
              const p = queryFor(filters);
              p.delete("page");
              return p.toString();
            })()}
            total={total}
            noun="transaction"
          />
        </ListingToolbar>

        {/* The range is always stated, filter or not: the API silently defaults
            to the last 30 days, and a total with no period beside it is a
            figure nobody can check. */}
        <FilterBar total={total} noun="transaction" plural="transactions">
          <DayRangeChip
            from={range.from}
            to={range.to}
            onDrop={() => apply({ from: "", to: "" })}
          />
          {filters.module && (
            <FilterChip
              onDrop={() => apply({ module: "" })}
              label={
                <>
                  <span
                    aria-hidden
                    className={cn("size-2 rounded-full", MODULE_DOT[filters.module])}
                  />
                  {MODULE_LABELS[filters.module]}
                </>
              }
            />
          )}
          {filters.customerId && (
            <FilterChip
              onDrop={() => apply({ customerId: "" })}
              label={
                <>
                  <UserIcon className="size-3" />
                  {customerName ?? "One customer"}
                </>
              }
            />
          )}
        </FilterBar>

        {rows.length === 0 ? (
          <LedgerEmpty narrowed={narrowed} filters={filters} />
        ) : (
          <div className={cn("transition-opacity", busy && "opacity-60")}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th className="w-1">Module</Th>
                  <Th>What</Th>
                  <Th>Customer</Th>
                  <Th className="hidden lg:table-cell">Recorded by</Th>
                  <Th className="hidden md:table-cell">When</Th>
                  <Th className="text-right">Amount</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <LedgerRow key={`${row.module}-${row.id}`} row={row} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <ListingFooter
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          hrefFor={(p) => hrefFor(filters, p)}
        />
      </ListingCard>
    </Page>
  );
}

/* ------------------------------------------------------------------ totals --- */

/**
 * What the range came to. Three cash figures side by side, and the internal
 * moves set apart from them behind a rule — because a transfer leg is in this
 * list but was never in the drawer, and a figure that sits in the same row as
 * cash will be added to cash by whoever reads it.
 */
function TotalsBand({ totals }: { totals: TransactionTotals }) {
  const net = netCash(totals);

  return (
    <div className="mb-4 grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Cash in"
        amount={totals.in.amount}
        count={totals.in.count}
        tone="in"
      />
      <Stat
        label="Cash out"
        amount={totals.out.amount}
        count={totals.out.count}
        tone="out"
      />
      <div className="flex flex-col justify-center">
        <p className="eyebrow text-muted-foreground">Net</p>
        <p
          className={cn(
            "tabular mt-1 text-2xl font-bold tracking-tight",
            net > 0 && "text-cash-in",
            net < 0 && "text-cash-out",
          )}
        >
          {net > 0 ? "+" : net < 0 ? "−" : ""}
          {formatPesewas(Math.abs(net))}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          In less out. Fees collected: {formatPesewas(totals.feesCollected)}
        </p>
      </div>

      {/* Deliberately quieter than the three beside it, and behind a rule on
          wide screens: it belongs to the same range, not to the same sum. */}
      <div className="flex flex-col justify-center border-border lg:border-l lg:pl-4">
        <p className="eyebrow inline-flex items-center gap-1.5 text-muted-foreground">
          <ArrowLeftRightIcon className="size-3.5 text-internal" />
          Internal moves
        </p>
        <p className="tabular mt-1 text-2xl font-bold tracking-tight text-muted-foreground">
          {formatPesewas(totals.internal.amount)}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatCount(totals.internal.count)}{" "}
          {totals.internal.count === 1 ? "leg" : "legs"} between a customer&rsquo;s
          own accounts. Not cash — excluded above.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  amount,
  count,
  tone,
}: {
  label: string;
  amount: number;
  count: number;
  tone: "in" | "out";
}) {
  const Icon = tone === "in" ? ArrowDownLeftIcon : ArrowUpRightIcon;
  return (
    <div className="flex flex-col justify-center">
      <p className="eyebrow inline-flex items-center gap-1.5 text-muted-foreground">
        <Icon className={cn("size-3.5", tone === "in" ? "text-cash-in" : "text-cash-out")} />
        {label}
      </p>
      <p
        className={cn(
          "tabular mt-1 text-2xl font-bold tracking-tight",
          tone === "in" ? "text-cash-in" : "text-cash-out",
        )}
      >
        {formatPesewas(amount)}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {formatCount(count)} {count === 1 ? "movement" : "movements"}
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------- row --- */

/**
 * One money event. The module is a coloured bar down the left edge rather than
 * a column of words — five modules interleaved read as one undifferentiated
 * list otherwise — and the direction is carried by the sign and the colour on
 * the amount, which is the only thing anyone scans a ledger for.
 *
 * An internal row is drawn deliberately flat: no sign, no colour on the figure,
 * and the word `internal` where the sign would be. It is in the list because it
 * happened; it is not in the totals because no cash moved.
 */
function LedgerRow({ row }: { row: Row }) {
  const internal = row.direction === "internal";

  return (
    <TableRow className={cn("group", internal && "bg-internal-subtle/40")}>
      <TableCell className="w-1 p-0">
        <span
          aria-hidden
          className={cn("block h-full min-h-12 w-1", MODULE_DOT[row.module])}
        />
        <span className="sr-only">{MODULE_LABELS[row.module]}</span>
      </TableCell>

      <TableCell className="px-4 py-3">
        <p className="font-medium text-foreground">{row.what}</p>
        <p className="truncate text-xs text-muted-foreground">
          {row.wherePath ? (
            <Link
              to={row.wherePath}
              className="tabular underline-offset-4 hover:text-foreground hover:underline"
            >
              {row.where}
            </Link>
          ) : (
            <span className="tabular">{row.where}</span>
          )}
          {row.detail ? ` · ${row.detail}` : ""}
        </p>
      </TableCell>

      <TableCell className="px-4 py-3">
        <Link
          to={`/customers/${row.customerId}`}
          className="block truncate text-foreground underline-offset-4 hover:underline"
        >
          {row.customerName}
        </Link>
      </TableCell>

      <TableCell className="hidden px-4 py-3 text-sm text-muted-foreground lg:table-cell">
        {row.recordedBy}
      </TableCell>

      <TableCell className="hidden px-4 py-3 text-sm whitespace-nowrap text-muted-foreground md:table-cell">
        {row.at}
      </TableCell>

      <TableCell className="px-4 py-3 text-right whitespace-nowrap">
        <span
          className={cn(
            "tabular font-semibold",
            internal && "font-normal text-muted-foreground",
            !internal && row.direction === "in" && "text-cash-in",
            !internal && row.direction === "out" && "text-cash-out",
          )}
        >
          {internal ? "" : row.direction === "in" ? "+" : "−"}
          {formatAmount(row.amount)}
        </span>
        {internal ? (
          <p className="text-[0.6875rem] tracking-wide text-internal uppercase">
            Internal
          </p>
        ) : row.fee > 0 ? (
          <p className="tabular text-xs text-muted-foreground">
            fee {formatAmount(row.fee)}
          </p>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function LedgerEmpty({
  narrowed,
  filters,
}: {
  narrowed: boolean;
  filters: Filters;
}) {
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayersIcon className="size-6" />
        </EmptyMedia>
        <EmptyTitle>{narrowed ? "No matches" : "Nothing in this period"}</EmptyTitle>
        <EmptyDescription>
          {narrowed
            ? "No money moved that way in the days shown. Widen the range or clear a filter."
            : "No deposit, withdrawal, repayment or transfer was recorded in these days."}
        </EmptyDescription>
      </EmptyHeader>
      {narrowed ? (
        <Link
          to={hrefFor({ ...filters, module: "", customerId: "" })}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Clear filters
        </Link>
      ) : null}
    </Empty>
  );
}
