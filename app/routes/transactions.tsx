import {
  ArrowDownLeftIcon,
  ArrowLeftRightIcon,
  ArrowRightLeftIcon,
  ArrowUpRightIcon,
  HourglassIcon,
  PrinterIcon,
  ScaleIcon,
  UserIcon,
  WalletIcon,
} from "lucide-react";
import { useState } from "react";
import { data, Link, useNavigation, useSubmit } from "react-router";

import { getCustomer } from "~/api/customers";
import { listTransactions } from "~/api/reports";
import { FilterRail, RailFrame, type RailItem } from "~/components/filter-rail";
import {
  ExportMenu,
  FilterChip,
  ModuleDot,
  PeriodFilter,
} from "~/components/listing";
import { Page } from "~/components/page";
import { Button } from "~/components/ui/button";
import { DataTable, type Column } from "~/components/ui/data-table";
import { DropdownMenuItem } from "~/components/ui/dropdown-menu";
import { channelLabel } from "~/lib/customers";
import {
  accraDay,
  accraDaysAgo,
  formatAccraDate,
  formatAccraDateTime,
  formatAmount,
  formatCount,
  formatDayRange,
  formatPesewas,
} from "~/lib/format";
import {
  MODULES,
  MODULE_LABELS,
  TXN_TYPE_LABELS,
  netCash,
  receiptPathFor,
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

/** What the layout header calls this page, and the line under it. */
export const handle = {
  title: "Transactions",
  description: "Every movement of money, across every module, newest first.",
};

/** Ten rows, as the customer's statement pages them. */
const PAGE_SIZE = 10;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Filters {
  module: TxnModule | "";
  customerId: string;
  from: string;
  to: string;
  /** Also show Paystack charges still in flight — never counted in the totals. */
  pending: boolean;
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
    pending: url.searchParams.get("pending") === "1",
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.module) p.set("module", f.module);
  if (f.customerId) p.set("customerId", f.customerId);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.pending) p.set("pending", "1");
  if (page > 1) p.set("page", String(page));
  return p;
}

/**
 * `GET /reports/transactions` — every money event in the business as one list.
 *
 * Office only. The whole `/reports` surface is, which is why the rail hides
 * this module from collectors: a collector's own day is reconciled on the susu
 * summary, which is scoped to them and which they may read.
 *
 * The API defaults to the last 30 Accra days when asked for no range. Naming
 * that default here rather than leaving it implicit is what lets the period
 * button, the totals and the export link all state the same days — a total
 * with no period beside it is a figure nobody can check.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  // The resolved range: what was picked, or the API's own default spelled out.
  const range = {
    from: filters.from || accraDaysAgo(29),
    to: filters.to || accraDay(),
  };

  const { data: result, headers } = await withAuth(request, async (token) => {
    const [feed, customer] = await Promise.all([
      listTransactions(token, {
        page,
        limit: PAGE_SIZE,
        module: filters.module || undefined,
        customerId: filters.customerId || undefined,
        from: range.from,
        to: range.to,
        // Off by default on the API's side, so it is only ever sent as "true".
        includePending: filters.pending ? "true" : undefined,
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
      /** The days on screen, filter or no filter. */
      range,
      /** Whether the range was picked rather than defaulted — what tints the
          button, and what decides whether Clear can be pressed. */
      explicit: Boolean(filters.from || filters.to),
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
  channel: string | null;
  customerId: string;
  customerName: string;
  /** The account number, or the module's name when the record has none. */
  where: string;
  wherePath: string | null;
  recordedBy: string;
  date: string;
  time: string;
  /** The Accra day this landed on — what the advice link searches. */
  day: string;
  /** The printable receipt, or null for a charge that has not landed. */
  receiptPath: string | null;
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
    channel: t.channel,
    customerId: t.customerId,
    customerName: t.customerName,
    where: t.ref.accountNumber ? `#${t.ref.accountNumber}` : MODULE_LABELS[t.module],
    wherePath: refPath(t),
    // `System` is the API's own word for the automated debt-recovery moves.
    recordedBy: t.recordedByName ?? "System",
    date: formatAccraDate(t.createdAt),
    // The full stamp reads `25 Aug 2026, 1:32 pm`; the date already has its
    // own line above, so only the clock time is kept here.
    time: formatAccraDateTime(t.createdAt).split(", ")[1] ?? "",
    day: accraDay(new Date(t.createdAt)),
    receiptPath: receiptPathFor(t),
  };
}

/** Everything that would identify a row when someone types into the search box. */
function haystack(row: Row): string {
  return [
    row.what,
    MODULE_LABELS[row.module],
    row.customerName,
    row.detail,
    row.channel,
    channelLabel(row.channel),
    row.where,
    row.recordedBy,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * The business-wide ledger, drawn the way a customer's statement is drawn.
 *
 * The two screens answer the same question at two scales — what moved, in what
 * order, through which product — so they share one table rather than each
 * inventing its own. The module rail narrows it, the search box picks through what
 * is on screen, and every row carries the same ⋯ menu.
 *
 * Paging is the API's here, not the table's: the ledger is unbounded, so a page
 * is a request. The search is therefore local to the page in hand, and the note
 * under the table says so rather than letting a miss be read as an absence.
 */
export default function Transactions({ loaderData }: Route.ComponentProps) {
  const { filters, page, range, explicit, customerName, total, totals, rows } =
    loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();

  const [search, setSearch] = useState("");

  const busy =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/transactions";

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), {
      replace: true,
      preventScrollReset: true,
    });

  const goToPage = (next: number) =>
    submit(queryFor(filters, next), { replace: true, preventScrollReset: true });

  // Only the open view's total is ever known — the API counts what it was asked
  // for. A closed view carries no count rather than a misleading zero.
  const items: RailItem[] = [
    {
      key: "all",
      label: "All modules",
      count: filters.module ? 0 : total,
      onSelect: () => apply({ module: "" }),
    },
    ...MODULES.map((m) => ({
      key: m,
      label: (
        <span className="inline-flex items-center gap-1.5">
          <ModuleDot module={m} />
          {MODULE_LABELS[m]}
        </span>
      ),
      count: filters.module === m ? total : 0,
      onSelect: () => apply({ module: m }),
    })),
  ];

  const query = search.trim().toLowerCase();
  const visible = query ? rows.filter((row) => haystack(row).includes(query)) : rows;

  const columns: Column<Row>[] = [
    {
      key: "date",
      header: "Date",
      className: "whitespace-nowrap text-muted-foreground",
      cell: (row) => (
        <>
          <p>{row.date}</p>
          <p className="text-xs">{row.time}</p>
        </>
      ),
    },
    { key: "entry", header: "Entry", cell: (row) => <Entry row={row} /> },
    {
      key: "customer",
      header: "Customer",
      cell: (row) => (
        <Link
          to={`/customers/${row.customerId}`}
          className="block truncate text-foreground underline-offset-4 hover:underline"
        >
          {row.customerName}
        </Link>
      ),
    },
    {
      key: "channel",
      header: "Channel",
      className: "hidden text-muted-foreground lg:table-cell",
      cell: (row) => channelLabel(row.channel) ?? "—",
    },
    {
      key: "account",
      header: "Account",
      className: "tabular hidden text-muted-foreground md:table-cell",
      // The account number is also the way into the record it belongs to. A
      // transfer has no page of its own, so it stays plain text.
      cell: (row) =>
        row.wherePath ? (
          <Link
            to={row.wherePath}
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            {row.where}
          </Link>
        ) : (
          row.where
        ),
    },
    {
      key: "by",
      header: "Recorded by",
      className: "hidden text-muted-foreground lg:table-cell",
      cell: (row) => row.recordedBy,
    },
    {
      key: "amount",
      header: "Amount · GH₵",
      align: "end",
      cell: (row) => <Amount row={row} />,
    },
    {
      key: "commission",
      header: "Commission",
      align: "end",
      className: "tabular hidden md:table-cell",
      // What the branch took on this entry — the flat savings withdrawal and
      // transfer charge. Gold, which the theme reserves for money the company
      // earns. A dash means this entry carried no charge, not that it is unknown.
      cell: (row) =>
        row.fee > 0 ? (
          <span className="font-medium text-revenue-foreground">
            {formatAmount(row.fee)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  const narrowed = Boolean(
    filters.module || filters.customerId || filters.pending,
  );

  return (
    <RailFrame
      rail={({ horizontal }) => (
        <FilterRail
          label="Filter transactions by module"
          sections={[{ label: "Module", items }]}
          active={filters.module || "all"}
          horizontal={horizontal}
        />
      )}
    >
    <Page className="max-w-none">
      <TotalsBand totals={totals} range={range} />

      {/* The one filter the toolbar has no control of its own for: a customer
          is picked elsewhere and arrives in the URL, so a chip is how it says
          so and how it is let go. */}
      {filters.customerId && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FilterChip
            onDrop={() => apply({ customerId: "" })}
            label={
              <>
                <UserIcon className="size-3" />
                {customerName ?? "One customer"}
              </>
            }
          />
        </div>
      )}

      <DataTable
        actions={
          <>
            {/* Mobile-money charges Paystack has not settled yet. They are rows
                of money that has not moved, so the API leaves them out unless
                asked, and the totals leave them out either way. */}
            <Button
              variant="outline"
              size="sm"
              aria-pressed={filters.pending}
              onClick={() => apply({ pending: !filters.pending })}
              className={cn(filters.pending && "border-primary/50 text-primary")}
            >
              <HourglassIcon />
              Include pending
            </Button>
            <PeriodFilter
              from={range.from}
              to={range.to}
              active={explicit}
              title="Recorded"
              apply={(next) => apply(next)}
            />
            {/* The export carries the resolved range, so the file covers the
                days on screen rather than re-defaulting on the API's side. */}
            <ExportMenu
              path="/transactions/export"
              query={queryFor({ ...filters, ...range }).toString()}
              total={total}
              noun="transaction"
            />
          </>
        }
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search this page"
        searchLabel="Search the transactions on this page"
        columns={columns}
        rows={visible}
        rowKey={(row) => `${row.module}-${row.id}`}
        // A search is a local narrowing of the page in hand, so the footer
        // counts the matches; without one the footer is the API's own paging.
        paging={
          query
            ? undefined
            : { page, pageSize: PAGE_SIZE, total, onPageChange: goToPage }
        }
        loading={busy}
        rowActions={(row) => (
          <>
            <DropdownMenuItem asChild>
              <Link to={`/customers/${row.customerId}`}>
                <UserIcon />
                Open the customer
              </Link>
            </DropdownMenuItem>
            {/* Disabled rather than absent on a transfer: it is the same menu on
                every row, and an item that comes and goes reads as a bug. */}
            {row.wherePath ? (
              <DropdownMenuItem asChild>
                <Link to={row.wherePath}>
                  <WalletIcon />
                  Open the {MODULE_LABELS[row.module].toLowerCase()} record
                </Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>
                <WalletIcon />
                No record to open
              </DropdownMenuItem>
            )}
            {/* The advice page finds its entry by re-reading the customer's
                statement, so it is handed this row's own day to look in. */}
            <DropdownMenuItem asChild>
              <a
                href={`/customers/${row.customerId}/advice/${row.id}?from=${row.day}&to=${row.day}`}
                target="_blank"
                rel="noreferrer"
              >
                <PrinterIcon />
                Print advice
              </a>
            </DropdownMenuItem>
            {/* A resource route answering with bytes — a plain anchor, so the
                router does not try to navigate to it. Disabled rather than
                absent on a charge that has not landed, for the reason above. */}
            {row.receiptPath ? (
              <DropdownMenuItem asChild>
                <a href={row.receiptPath} target="_blank" rel="noreferrer">
                  <PrinterIcon />
                  Print receipt
                </a>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>
                <PrinterIcon />
                No receipt yet
              </DropdownMenuItem>
            )}
          </>
        )}
        noun={{ one: "transaction", many: "transactions" }}
        pageSize={PAGE_SIZE}
        empty={
          query
            ? "Nothing on this page matches that. Clear the search to see the page again."
            : narrowed
              ? "No money moved that way in the days shown. Widen the range, or choose All modules."
              : "No deposit, withdrawal, repayment or transfer was recorded in these days."
        }
      />

      {/* A dash carries a meaning in this table, and it is not "missing data".
          The search's reach is stated for the same reason: a miss here is not
          an absence from the ledger. */}
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <div className="flex gap-1.5">
          <dt className="tabular">—</dt>
          <dd>
            under <span className="font-medium">Commission</span>: no charge was
            taken on that entry
          </dd>
        </div>
        {rows.length > 0 && (
          <div>
            Search reads only the {formatCount(rows.length)}{" "}
            {rows.length === 1 ? "transaction" : "transactions"} on this page.
            Narrow the dates or the module to look further back.
          </div>
        )}
      </dl>
    </Page>
    </RailFrame>
  );
}

/* ------------------------------------------------------------------ totals --- */

/**
 * What the range came to, as the four KPI cards the dashboard opens with — the
 * same borderless tile, the same icon square in the corner, the same weight on
 * the figure — because these answer the dashboard's question over a period the
 * reader chose, and two ways of drawing one headline number is one too many.
 *
 * The squares are tinted with the money tokens rather than the dashboard's
 * avatar tints: in this app sky means arriving and coral means leaving
 * everywhere else on the screen, and a KPI card is no place to break that.
 *
 * Internal moves are the fourth card and are drawn grey on purpose. A transfer
 * leg is in the list below but was never in the drawer, and a figure sitting in
 * cash's colours will be added to cash by whoever reads it.
 */
function TotalsBand({
  totals,
  range,
}: {
  totals: TransactionTotals;
  range: { from: string; to: string };
}) {
  const net = netCash(totals);
  const period = formatDayRange(range.from, range.to);

  return (
    <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat
        label="Cash in"
        value={formatPesewas(totals.in.amount)}
        note={`${formatCount(totals.in.count)} ${totals.in.count === 1 ? "movement" : "movements"} · ${period}`}
        icon={ArrowDownLeftIcon}
        tone="in"
      />
      <Stat
        label="Cash out"
        value={formatPesewas(totals.out.amount)}
        note={`${formatCount(totals.out.count)} ${totals.out.count === 1 ? "movement" : "movements"} · ${period}`}
        icon={ArrowUpRightIcon}
        tone="out"
      />
      <Stat
        label="Net"
        value={`${net > 0 ? "+" : net < 0 ? "−" : ""}${formatPesewas(Math.abs(net))}`}
        note={`In less out. Fees collected: ${formatPesewas(totals.feesCollected)}`}
        icon={ScaleIcon}
        tone={net > 0 ? "in" : net < 0 ? "out" : "internal"}
      />
      <Stat
        label="Internal moves"
        value={formatPesewas(totals.internal.amount)}
        note={`${formatCount(totals.internal.count)} ${totals.internal.count === 1 ? "leg" : "legs"} between a customer's own accounts. Not cash — kept out of the three beside it.`}
        icon={ArrowLeftRightIcon}
        tone="internal"
      />
    </div>
  );
}

/** The dashboard's KPI tile, with the ledger's own colours in the square. */
function Stat({
  label,
  value,
  note,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof ArrowDownLeftIcon;
  tone: "in" | "out" | "internal";
}) {
  return (
    <div className="relative rounded-2xl bg-card p-4">
      <span
        aria-hidden
        className={cn(
          "absolute top-3.5 right-3.5 rounded-lg p-2",
          tone === "in" && "bg-cash-in-subtle",
          tone === "out" && "bg-cash-out-subtle",
          tone === "internal" && "bg-internal-subtle",
        )}
      >
        <Icon
          className={cn(
            "size-4",
            tone === "in" && "text-cash-in",
            tone === "out" && "text-cash-out",
            tone === "internal" && "text-internal",
          )}
        />
      </span>
      {/* Keyed so a change of period re-enters the number instead of snapping,
          exactly as the dashboard's own cards do. */}
      <p
        key={value}
        className={cn(
          "tabular animate-in fade-in slide-in-from-bottom-1 pr-10 text-[22px] font-bold tracking-tight duration-300 motion-reduce:animate-none",
          tone === "in" && "text-cash-in",
          tone === "out" && "text-cash-out",
          tone === "internal" && "text-muted-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs font-medium">{label}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}

/* ------------------------------------------------------------------- cells --- */

/**
 * What happened, in one cell: the module as a coloured dot, the direction as an
 * arrow, and under it the module and whatever the API said about the entry.
 * Five modules interleaved read as one undifferentiated list without the dot.
 */
function Entry({ row }: { row: Row }) {
  const Icon =
    row.direction === "in"
      ? ArrowDownLeftIcon
      : row.direction === "out"
        ? ArrowUpRightIcon
        : ArrowRightLeftIcon;

  // `detail` sometimes repeats the module or the channel — a cash repayment
  // reports both as "cash" — and "Loans · cash · cash" reads as a bug.
  const channel = channelLabel(row.channel);
  const base = [...new Set([MODULE_LABELS[row.module], row.detail])]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex items-start gap-2.5">
      <ModuleDot module={row.module} className="mt-1.5" />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              row.direction === "in" && "text-cash-in",
              row.direction === "out" && "text-cash-out",
              row.direction === "internal" && "text-internal",
            )}
          />
          {row.what}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {base}
          {/* The channel has its own column from `lg` up; narrower than that it
              rides here rather than dropping off the screen. */}
          {channel && <span className="lg:hidden"> · {channel}</span>}
          {/* Same for the account, which has a column from `md` up. */}
          <span className="tabular md:hidden"> · {row.where}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * The figure, and the sign that is the only thing anyone scans a ledger for.
 *
 * An internal row is drawn deliberately flat: no sign, no colour, and the word
 * `internal` under it. It is in the list because it happened; it is not in the
 * totals because no cash moved.
 */
function Amount({ row }: { row: Row }) {
  const internal = row.direction === "internal";

  return (
    <>
      <p
        className={cn(
          "tabular font-medium",
          row.direction === "in" && "text-cash-in",
          row.direction === "out" && "text-cash-out",
          internal && "text-muted-foreground",
        )}
      >
        {row.direction === "out" ? "−" : row.direction === "in" ? "+" : ""}
        {formatAmount(row.amount)}
      </p>
      {internal ? (
        <p className="text-[0.6875rem] tracking-wide text-internal uppercase">
          Internal
        </p>
      ) : row.fee > 0 ? (
        // The charge has its own column from `md` up; below that there is no
        // room for one, so it rides under the amount instead of disappearing.
        <p className="tabular text-xs text-revenue-foreground md:hidden">
          commission {formatAmount(row.fee)}
        </p>
      ) : null}
    </>
  );
}
