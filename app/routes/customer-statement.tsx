import {
  ArrowDownLeftIcon,
  ArrowRightLeftIcon,
  ArrowUpRightIcon,
  DownloadIcon,
  FileTextIcon,
  PrinterIcon,
  ReceiptTextIcon,
} from "lucide-react";
import { useState } from "react";
import { data, useSubmit } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { getCustomerStatement } from "~/api/customers";
import {
  FilterMenu,
  type MenuChoice,
  ModuleDot,
  PeriodFilter,
} from "~/components/listing";
import { BackLink, Page } from "~/components/page";
import { TransactionAdvice } from "~/components/transaction-advice";
import { Button } from "~/components/ui/button";
import { DataTable, type Column } from "~/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  channelLabel,
  MODULE_LABELS,
  TX_TYPE_LABELS,
  type TxModule,
  type UnifiedTransaction,
} from "~/lib/customers";
import {
  accraDay,
  accraDaysAgo,
  formatAccraDate,
  formatAmount,
  formatCount,
  formatDayRange,
} from "~/lib/format";
import { RECORDED_BY_LABELS, receiptPathFor } from "~/lib/reports";
import { requireCounter, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/customer-statement";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.statement.customer.fullName ?? "Customer";
  return [{ title: `Statement · ${name} · Yadah Dynamic Enterprise` }];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 10;

/**
 * `GET /customers/:id/statement` — the customer's unified ledger for a range of
 * Accra days. Office only, which the API enforces and this re-checks.
 */
/** What the layout header calls this page. The rail calls it Transactions. */
export const handle = { title: "Transactions" };

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);
  const url = new URL(request.url);
  const day = (key: string, fallback: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : fallback;
  };
  // The API defaults to the last 30 days; naming the range here means the form
  // and the export link agree with what is on screen.
  const from = day("from", accraDaysAgo(29));
  const to = day("to", accraDay());

  const { data: statement, headers } = await withAuth(request, async (token) => {
    try {
      return await getCustomerStatement(token, params.id, { from, to });
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data(
    {
      statement,
      from,
      to,
      // Whether the range was chosen rather than defaulted — the filter marks
      // itself active only when someone actually set it.
      explicit: DAY_RE.test(url.searchParams.get("from") ?? "") ||
        DAY_RE.test(url.searchParams.get("to") ?? ""),
      id: params.id,
    },
    { headers },
  );
}

/** Everything that would identify a row when someone types into the search box. */
function haystack(tx: UnifiedTransaction): string {
  return [
    TX_TYPE_LABELS[tx.type] ?? tx.type,
    MODULE_LABELS[tx.module],
    tx.detail,
    tx.channel,
    channelLabel(tx.channel),
    tx.ref.accountNumber,
    tx.recordedByName,
    tx.recordedByKind,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Every movement in the period, in one table.
 *
 * Susu, savings, loans, hire purchase and transfers share a row shape, so they
 * share a table — reading a statement means following the money in date order,
 * and splitting it per product hides the day a payout became a repayment. The
 * module menu narrows it when that is what you want. Both the menu and the
 * search are local: the rows are already loaded, so neither should cost a
 * round trip.
 */
export default function CustomerStatementRoute({ loaderData }: Route.ComponentProps) {
  const { statement, from, to, explicit, id } = loaderData;
  const { customer, period, transactions, truncated } = statement;

  const [module, setModule] = useState("all");
  const [search, setSearch] = useState("");
  // The entry whose advice is open. The advice is the thing the customer is
  // handed, so it is reachable from the row it describes rather than from a
  // screen of its own.
  const [advice, setAdvice] = useState<UnifiedTransaction | null>(null);

  // The period is the only thing in this URL, so an empty pair is a clean slate
  // and the loader falls back to the API's own last-30-days.
  const submit = useSubmit();
  const applyPeriod = (next: { from: string; to: string }) => {
    const params = new URLSearchParams();
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    submit(params, { replace: true, preventScrollReset: true });
  };

  const adviceHref = (tx: UnifiedTransaction) =>
    `/customers/${id}/advice/${tx.id}?from=${period.from}&to=${period.to}`;

  const counts = transactions.reduce<Record<string, number>>((acc, tx) => {
    acc[tx.module] = (acc[tx.module] ?? 0) + 1;
    return acc;
  }, {});

  const items: MenuChoice[] = [
    {
      key: "all",
      label: "All entries",
      count: transactions.length,
      onSelect: () => setModule("all"),
    },
    ...(Object.keys(MODULE_LABELS) as TxModule[])
      .filter((m) => counts[m])
      .map((m) => ({
        key: m,
        label: (
          <span className="inline-flex items-center gap-1.5">
            <ModuleDot module={m} />
            {MODULE_LABELS[m]}
          </span>
        ),
        count: counts[m],
        onSelect: () => setModule(m),
      })),
  ];

  const query = search.trim().toLowerCase();
  const rows = transactions.filter(
    (tx) =>
      (module === "all" || tx.module === module) &&
      (!query || haystack(tx).includes(query)),
  );

  const columns: Column<UnifiedTransaction>[] = [
    {
      key: "date",
      header: "Date",
      className: "whitespace-nowrap text-muted-foreground",
      cell: (tx) => formatAccraDate(tx.createdAt),
    },
    { key: "entry", header: "Entry", cell: (tx) => <Entry tx={tx} /> },
    {
      key: "channel",
      header: "Channel",
      className: "hidden text-muted-foreground lg:table-cell",
      cell: (tx) => channelLabel(tx.channel) ?? "—",
    },
    {
      key: "account",
      header: "Account",
      className: "tabular hidden text-muted-foreground md:table-cell",
      cell: (tx) => tx.ref.accountNumber ?? "—",
    },
    {
      key: "by",
      header: "Recorded by",
      className: "hidden text-muted-foreground lg:table-cell",
      // A staff row is named; the rest are described. On a customer's own
      // statement, "You" is the honest word for a payment they made
      // themselves through the portal.
      cell: (tx) =>
        tx.recordedByKind === "staff"
          ? (tx.recordedByName ?? "Staff")
          : tx.recordedByKind === "customer"
            ? "You"
            : RECORDED_BY_LABELS[tx.recordedByKind],
    },
    {
      key: "amount",
      header: "Amount · GH₵",
      align: "end",
      cell: (tx) => <Amount tx={tx} />,
    },
    {
      key: "commission",
      header: "Commission",
      align: "end",
      className: "tabular hidden md:table-cell",
      // What the branch took on this entry — the flat savings withdrawal and
      // transfer charge. Gold, which the theme reserves for money the company
      // earns. A dash means this entry carried no charge, not that it is unknown.
      cell: (tx) =>
        tx.fee > 0 ? (
          <span className="font-medium text-revenue-foreground">
            {formatAmount(tx.fee)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  // The API keeps a running balance per savings account; susu, loans, hire
  // purchase and transfers have none. Rather than draw a column of dashes on a
  // selection that holds no savings at all, the column appears only when there
  // is a balance in it to read.
  const hasBalances = rows.some((tx) => tx.balanceAfter != null);
  const mixedBalances = hasBalances && rows.some((tx) => tx.balanceAfter == null);

  if (hasBalances) {
    columns.push({
      key: "balance",
      header: "Savings balance",
      align: "end",
      className: "tabular hidden text-muted-foreground sm:table-cell",
      cell: (tx) => (tx.balanceAfter != null ? formatAmount(tx.balanceAfter) : "—"),
    });
  }

  return (
    <Page className="max-w-none">
      {/* Back on the left, who this statement is for on the right. The period
          is not repeated here — the filter in the toolbar already states it. */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <BackLink to={`/customers/${id}`} />
        <div className="text-right">
          <h2 className="font-heading text-2xl font-bold tracking-tight">
            Statement of account
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {customer.fullName} · <span className="tabular">{customer.phone}</span>
          </p>
        </div>
      </header>

      <DataTable
        filters={<FilterMenu label="Module" items={items} active={module} />}
        actions={
          <>
            <PeriodFilter
              from={from}
              to={to}
              active={explicit}
              apply={applyPeriod}
            />
            <ExportMenu id={id} period={period} rows={transactions.length} />
          </>
        }
        // No tab strip is drawn for this — the menu above owns the choice. It
        // is still passed because the table is paged locally and resets to
        // page one when it changes.
        activeTab={module}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search entry, account or staff"
        searchLabel="Search this statement"
        columns={columns}
        rows={rows}
        rowKey={(tx) => tx.id}
        rowActions={(tx) => (
          <>
            <DropdownMenuItem onSelect={() => setAdvice(tx)}>
              <ReceiptTextIcon />
              View advice
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={adviceHref(tx)} target="_blank" rel="noreferrer">
                <PrinterIcon />
                Export PDF
              </a>
            </DropdownMenuItem>
            {/* The module's own receipt for this entry — a resource route
                answering with bytes, so a plain anchor. Disabled rather than
                absent on a charge that has not landed: the same menu on every
                row, or an item that comes and goes reads as a bug. */}
            {receiptPathFor(tx) ? (
              <DropdownMenuItem asChild>
                <a href={receiptPathFor(tx)!} target="_blank" rel="noreferrer">
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
        noun={{ one: "entry", many: "entries" }}
        pageSize={PAGE_SIZE}
        empty={
          transactions.length === 0
            ? `No money moved between ${formatDayRange(period.from, period.to)}. Widen the period to look further back.`
            : "Nothing matches these filters. Clear the search, or choose All entries."
        }
      />

      {/* A dash carries two different meanings in this table, and neither is
          "missing data". Say so, rather than leaving someone to guess. */}
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <div className="flex gap-1.5">
          <dt className="tabular">—</dt>
          <dd>
            under <span className="font-medium">Commission</span>: no charge was
            taken on that entry
          </dd>
        </div>
        {mixedBalances && (
          <div className="flex gap-1.5">
            <dt className="tabular">—</dt>
            <dd>
              under <span className="font-medium">Savings balance</span>: only
              savings accounts run a balance, so susu, loan, hire-purchase and
              transfer entries have none
            </dd>
          </div>
        )}
      </dl>

      {truncated && (
        <p className="mt-2 text-xs text-warning">
          The period holds more entries than the API returns at once. Narrow the
          dates, or export the full range.
        </p>
      )}

      <Dialog open={advice !== null} onOpenChange={(open) => !open && setAdvice(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Transaction advice</DialogTitle>
            <DialogDescription>
              What the customer is told about this entry. Export it to hand over
              or to file.
            </DialogDescription>
          </DialogHeader>

          {advice && (
            <div className="max-h-[60vh] overflow-y-auto">
              <TransactionAdvice tx={advice} customer={customer} />
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdvice(null)}>
              Close
            </Button>
            {advice && (
              <Button asChild>
                <a href={adviceHref(advice)} target="_blank" rel="noreferrer">
                  <PrinterIcon />
                  Export PDF
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function Entry({ tx }: { tx: UnifiedTransaction }) {
  const Icon =
    tx.direction === "in"
      ? ArrowDownLeftIcon
      : tx.direction === "out"
        ? ArrowUpRightIcon
        : ArrowRightLeftIcon;

  // `detail` sometimes repeats the module or the channel — a cash repayment
  // reports both as "cash" — and "Loans · cash · cash" reads as a bug.
  const channel = channelLabel(tx.channel);
  const base = [...new Set([MODULE_LABELS[tx.module], tx.detail])]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex items-start gap-2.5">
      <ModuleDot module={tx.module} className="mt-1.5" />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              tx.direction === "in" && "text-cash-in",
              tx.direction === "out" && "text-cash-out",
              tx.direction === "internal" && "text-internal",
            )}
          />
          {TX_TYPE_LABELS[tx.type] ?? tx.type}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {base}
          {/* The channel has its own column from `lg` up; narrower than that it
              rides here rather than dropping off the screen. */}
          {channel && <span className="lg:hidden"> · {channel}</span>}
        </p>
      </div>
    </div>
  );
}

function Amount({ tx }: { tx: UnifiedTransaction }) {
  return (
    <>
      <p
        className={cn(
          "tabular font-medium",
          tx.direction === "in" && "text-cash-in",
          tx.direction === "out" && "text-cash-out",
          tx.direction === "internal" && "text-muted-foreground",
        )}
      >
        {tx.direction === "out" ? "−" : tx.direction === "in" ? "+" : ""}
        {formatAmount(tx.amount)}
      </p>
      {/* The charge has its own column from `md` up; below that there is no
          room for one, so it rides under the amount instead of disappearing. */}
      {tx.fee > 0 && (
        <p className="tabular text-xs text-revenue-foreground md:hidden">
          commission {formatAmount(tx.fee)}
        </p>
      )}
    </>
  );
}

/** Downloads the ledger rows for the period on screen. */
function ExportMenu({
  id,
  period,
  rows,
}: {
  id: string;
  period: { from: string; to: string };
  rows: number;
}) {
  const query = `from=${period.from}&to=${period.to}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={rows === 0}>
          <DownloadIcon />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal text-muted-foreground">
          {formatCount(rows)} {rows === 1 ? "entry" : "entries"} from{" "}
          {formatDayRange(period.from, period.to)}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={`/customers/${id}/statement/export?format=csv&${query}`}>
            <FileTextIcon />
            CSV
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`/customers/${id}/statement/export?format=xlsx&${query}`}>
            <DownloadIcon />
            Excel (.xlsx)
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
