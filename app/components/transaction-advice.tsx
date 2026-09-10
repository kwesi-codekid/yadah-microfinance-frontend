import type { ReactNode } from "react";

import {
  channelLabel,
  MODULE_LABELS,
  TX_TYPE_LABELS,
  type UnifiedTransaction,
} from "~/lib/customers";
import { formatAccraDate, formatAmount } from "~/lib/format";
import { cn } from "~/lib/utils";

/**
 * A transaction advice, in the form a Ghanaian bank sends one: who it is for,
 * what happened to their account, then every figure on its own ruled line.
 *
 * The branch hands this to the customer, so it is written to them rather than
 * about them — "your account has been credited", not "susu-deposit, in". The
 * ruled stripes are the theme's gold, which is reserved for money throughout
 * the app, so an advice reads as the same kind of object as the revenue
 * figures on the dashboard.
 */

/** Just enough of a customer to address the advice. */
export interface AdviceCustomer {
  fullName: string;
  phone: string;
  residentialAddress?: string | null;
}

/**
 * What the entry did to the customer's account, in their words. `direction` is
 * recorded from the company's cash view, which is the mirror of theirs: money
 * into the company is a deposit, and a deposit credits the customer.
 */
const NOTICE: Record<UnifiedTransaction["direction"], string> = {
  in: "Please be informed your account has been credited as below.",
  out: "Please be informed your account has been debited as below.",
  internal: "Please be informed a transfer has been recorded on your account as below.",
};

/** The branch quotes this figure in GHS, the way every bank alert here does. */
function ghs(pesewas: number): string {
  return `GHS ${formatAmount(pesewas)}`;
}

export function TransactionAdvice({
  tx,
  customer,
  withCustomer = false,
  className,
}: {
  tx: UnifiedTransaction;
  customer: AdviceCustomer;
  /** Append the customer's own details — the print copy carries them. */
  withCustomer?: boolean;
  className?: string;
}) {
  const balance = tx.balanceAfter != null ? ghs(tx.balanceAfter) : "n/a";

  return (
    <article className={cn("text-sm", className)}>
      <p className="font-heading text-base font-bold">
        Dear {customer.fullName},
      </p>
      <p className="mt-3 font-medium">{NOTICE[tx.direction]}</p>

      <Ruled
        className="mt-4"
        rows={[
          ["Account Number", tx.ref.accountNumber ?? "n/a"],
          ["Transaction Reference", <Ref key="ref" value={tx.id} />],
          ["Transaction Date", formatAccraDate(tx.createdAt)],
          ["Amount", <Amount key="amt" tx={tx} />],
          ["Transaction Type", TX_TYPE_LABELS[tx.type] ?? tx.type],
          ["Module", MODULE_LABELS[tx.module]],
          ["Description", tx.detail || "n/a"],
          ["Channel", channelLabel(tx.channel) ?? "n/a"],
          // Only savings withdrawals and transfers carry one.
          ["Commission", tx.fee > 0 ? ghs(tx.fee) : "n/a"],
          ["Recorded By", tx.recordedByName || "n/a"],
          ["Transaction Location", "Yadah Dynamic Enterprise"],
          // The API runs a balance on savings accounts only, so susu, loan,
          // hire-purchase and transfer advices have none to quote.
          ["Ledger Balance", balance],
          ["Available Balance", balance],
        ]}
      />

      {withCustomer && (
        <>
          <h3 className="mt-6 mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Customer
          </h3>
          <Ruled
            rows={[
              ["Full Name", customer.fullName],
              ["Phone", customer.phone],
              ["Address", customer.residentialAddress || "n/a"],
            ]}
          />
        </>
      )}
    </article>
  );
}

/** The label/value lines, ruled in gold every other row. */
function Ruled({
  rows,
  className,
}: {
  rows: [string, ReactNode][];
  className?: string;
}) {
  return (
    <dl className={cn("overflow-hidden rounded-md border border-border", className)}>
      {rows.map(([label, value], i) => (
        <div
          key={label}
          className={cn(
            "flex gap-4 px-3 py-2",
            // Gold is a fill in this theme, never text — the stripe is the one
            // place an advice gets to use it at full strength.
            i % 2 === 0 ? "bg-revenue-subtle" : "bg-card",
          )}
        >
          <dt className="w-[45%] shrink-0 text-muted-foreground">{label}</dt>
          <dd className="min-w-0 flex-1 font-medium wrap-break-word">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The amount, coloured the way the ledger colours it. */
function Amount({ tx }: { tx: UnifiedTransaction }) {
  return (
    <span
      className={cn(
        "font-semibold tabular",
        tx.direction === "in" && "text-cash-in",
        tx.direction === "out" && "text-cash-out",
        tx.direction === "internal" && "text-internal",
      )}
    >
      {ghs(tx.amount)}
    </span>
  );
}

/**
 * The reference someone quotes back to the branch when they query an entry, so
 * it is the record's own id verbatim — upper-cased for reading aloud, never
 * shortened, because a truncated reference cannot be looked up.
 */
function Ref({ value }: { value: string }) {
  return <span className="tabular break-all">{value.toUpperCase()}</span>;
}
