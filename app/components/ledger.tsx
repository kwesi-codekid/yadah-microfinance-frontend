import {
  ArrowDownLeftIcon,
  ArrowLeftRightIcon,
  ArrowRightLeftIcon,
  ArrowUpRightIcon,
  PencilIcon,
  PrinterIcon,
  ScaleIcon,
  UserIcon,
  WalletIcon,
} from "lucide-react";
import { Link } from "react-router";

import { ModuleDot } from "~/components/listing";
import { type Column } from "~/components/ui/data-table";
import { DropdownMenuItem } from "~/components/ui/dropdown-menu";
import { type CorrectionKind } from "~/lib/corrections";
import { channelLabel } from "~/lib/customers";
import {
  accraDay,
  formatAccraDate,
  formatAccraDateTime,
  formatAmount,
  formatPesewas,
} from "~/lib/format";
import {
  MODULE_LABELS,
  RECORDED_BY_LABELS,
  TXN_TYPE_LABELS,
  netCash,
  receiptPathFor,
  refPath,
  type Direction,
  type RecordedByKind,
  type TransactionTotals,
  type TxnModule,
  type UnifiedTransaction,
} from "~/lib/reports";
import { cn } from "~/lib/utils";

/**
 * The ledger table, shared by every screen that lists money movements from
 * the unified feed: the business-wide Transactions page and a member of
 * staff's own day. One definition of a row, its cells, its menu and the
 * totals above it, so the two screens cannot drift apart.
 */

/* -------------------------------------------------------------------- rows --- */

export interface LedgerRow {
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
  recordedByKind: RecordedByKind;
  date: string;
  time: string;
  /** The Accra day this landed on — what the advice link searches. */
  day: string;
  /** The printable receipt, or null for a charge that has not landed. */
  receiptPath: string | null;
  /**
   * What kind of correctable entry this row is, or null when its figure can
   * never be corrected from anywhere: a susu deposit, a savings deposit or
   * withdrawal, a cash loan repayment, or a hire-purchase instalment that
   * has landed and was typed at the counter. Whether it is also the newest
   * on its record, and whether a request is already waiting, is read when
   * the item is chosen.
   */
  kind: CorrectionKind | null;
  /** The record behind it, for the correction dialog. */
  targetId: string;
}

/** The correctable kind a ledger row is, or null. */
function kindOf(t: UnifiedTransaction): CorrectionKind | null {
  if (t.status !== "completed") return null;
  if (t.channel === "transfer" || t.channel === "paystack") return null;
  switch (t.type) {
    case "susu-deposit":
      return t.ref.kind === "susu-account" ? "susu-deposit" : null;
    case "savings-deposit":
    case "savings-withdrawal":
      return t.ref.kind === "savings-account" ? "savings-txn" : null;
    case "loan-repayment":
      return t.ref.kind === "loan" && t.detail === "cash" ? "loan-repayment" : null;
    case "hp-installment":
      return t.ref.kind === "hp-agreement" ? "hp-payment" : null;
    default:
      return null;
  }
}

export function toLedgerRow(t: UnifiedTransaction): LedgerRow {
  return {
    id: t.id,
    module: t.module,
    kind: kindOf(t),
    targetId: t.ref.id,
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
    // A staff row is named; the other three are described. Naming a customer
    // here would only repeat the Customer column, and the question this
    // answers is which of them put the entry on the ledger.
    recordedBy:
      t.recordedByKind === "staff"
        ? (t.recordedByName ?? "Staff")
        : RECORDED_BY_LABELS[t.recordedByKind],
    recordedByKind: t.recordedByKind,
    date: formatAccraDate(t.createdAt),
    // The full stamp reads `25 Aug 2026, 1:32 pm`; the date already has its
    // own line above, so only the clock time is kept here.
    time: formatAccraDateTime(t.createdAt).split(", ")[1] ?? "",
    day: accraDay(new Date(t.createdAt)),
    receiptPath: receiptPathFor(t),
  };
}

/** Everything that would identify a row when someone types into the search box. */
export function ledgerHaystack(row: LedgerRow): string {
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

/* ----------------------------------------------------------------- columns --- */

export const LEDGER_COLUMNS: Column<LedgerRow>[] = [
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
    // Staff reads as a plain name, which is the common case and needs no
    // decoration. The three that are not a member of staff are the ones
    // worth noticing, so those carry the tint.
    cell: (row) => (
      <span
        className={cn(
          row.recordedByKind === "customer" && "text-foreground",
          row.recordedByKind === "unknown" && "italic",
        )}
      >
        {row.recordedBy}
      </span>
    ),
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
    // What the branch took on this entry: the savings withdrawal or closure
    // fee, or the one-day commission charged when a susu cycle was stopped.
    // Gold, which the theme reserves for money the company earns. A dash
    // means this entry carried no charge, not that it is unknown.
    cell: (row) =>
      row.fee > 0 ? (
        <span className="font-medium text-revenue-foreground">{formatAmount(row.fee)}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

/* ------------------------------------------------------------- row actions --- */

/**
 * The ⋯ menu every ledger row carries. `onCorrect` is the screen's own
 * correction dialog; a screen with none passes nothing and the item is left
 * out rather than offered and refused.
 */
export function LedgerRowActions({
  row,
  onCorrect,
}: {
  row: LedgerRow;
  onCorrect?: (row: LedgerRow) => void;
}) {
  return (
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
      {/* A typed figure can be corrected from here as from its record's
          page. Disabled rather than absent on every other row, for the
          reason above. */}
      {onCorrect && (
        <DropdownMenuItem
          disabled={row.kind === null}
          onSelect={(event) => {
            event.preventDefault();
            onCorrect(row);
          }}
        >
          <PencilIcon />
          {row.kind ? "Correct the amount" : "Nothing to correct"}
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
export function LedgerTotals({
  totals,
  inLabel = "Cash in",
  outLabel = "Cash out",
}: {
  totals: TransactionTotals;
  inLabel?: string;
  outLabel?: string;
}) {
  const net = netCash(totals);

  return (
    <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
      <Stat
        label={inLabel}
        value={formatPesewas(totals.in.amount)}
        icon={ArrowDownLeftIcon}
        tone="in"
      />
      <Stat
        label={outLabel}
        value={formatPesewas(totals.out.amount)}
        icon={ArrowUpRightIcon}
        tone="out"
      />
      <Stat
        label="Net"
        value={`${net > 0 ? "+" : net < 0 ? "−" : ""}${formatPesewas(Math.abs(net))}`}
        icon={ScaleIcon}
        tone={net > 0 ? "in" : net < 0 ? "out" : "internal"}
      />
      <Stat
        label="Internal moves"
        value={formatPesewas(totals.internal.amount)}
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
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
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
          "tabular animate-in fade-in slide-in-from-bottom-1 pr-10 text-[22px] font-bold tracking-tight whitespace-nowrap duration-300 motion-reduce:animate-none",
          tone === "in" && "text-cash-in",
          tone === "out" && "text-cash-out",
          tone === "internal" && "text-muted-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs font-medium">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------- cells --- */

/**
 * What happened, in one cell: the module as a coloured dot, the direction as an
 * arrow, and under it the module and whatever the API said about the entry.
 * Five modules interleaved read as one undifferentiated list without the dot.
 */
function Entry({ row }: { row: LedgerRow }) {
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
function Amount({ row }: { row: LedgerRow }) {
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
        <p className="text-[0.6875rem] tracking-wide text-internal uppercase">Internal</p>
      ) : null}
      {/* The charge has its own column from `md` up; below that there is no
          room for one, so it rides under the amount instead of disappearing.
          Shown for internal rows too — a susu cycle closed straight into a
          loan is internal AND charges its commission. */}
      {row.fee > 0 ? (
        <p className="tabular text-xs text-revenue-foreground md:hidden">
          commission {formatAmount(row.fee)}
        </p>
      ) : null}
    </>
  );
}
