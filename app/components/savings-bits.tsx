import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  DoorClosedIcon,
  type LucideIcon,
} from "lucide-react";
import { formatAmount } from "~/lib/format";
import {
  ACCOUNT_TYPE_LABELS,
  MIN_BALANCE,
  SAVINGS_STATUS_BLURBS,
  SAVINGS_STATUS_LABELS,
  SAVINGS_STATUS_TONE,
  TXN_TYPE_LABELS,
  type SavingsAccountType,
  type SavingsStatus,
  type SavingsTxnType,
} from "~/lib/savings";
import { cn } from "~/lib/utils";

/**
 * The small pieces the savings screens share. They live here rather than in the
 * listing route so the account page can use the same pill without one route
 * importing another.
 */

const TONE_DOT: Record<string, string> = {
  success: "bg-success",
  muted: "bg-muted-foreground/50",
};

const TONE_TEXT: Record<string, string> = {
  success: "text-foreground",
  muted: "text-muted-foreground",
};

/**
 * The account's state, drawn the way every other status in the app is drawn: a
 * dot and a word. Savings has only the two, so the colour is carrying less than
 * it does in susu — but the shape has to match, or the two books read as two
 * different products.
 */
export function SavingsStatusPill({ status }: { status: SavingsStatus }) {
  const tone = SAVINGS_STATUS_TONE[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap"
      title={SAVINGS_STATUS_BLURBS[status]}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
      <span className={TONE_TEXT[tone]}>{SAVINGS_STATUS_LABELS[status]}</span>
    </span>
  );
}

/**
 * Standard or student. Deliberately quiet: the money rules are identical, so it
 * is a label on the record and not a state anybody acts on. Only the one that
 * carries office procedure behind it gets any ink.
 */
export function AccountTypeTag({ type }: { type: SavingsAccountType }) {
  if (type === "standard") {
    return <span className="text-sm text-muted-foreground">Standard</span>;
  }
  return (
    <span
      className="inline-flex items-center rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-info"
      title="The customer is the minor; the guardian's ID and next-of-kin details are on the customer record."
    >
      {ACCOUNT_TYPE_LABELS.student}
    </span>
  );
}

const TXN_ICON: Record<SavingsTxnType, LucideIcon> = {
  deposit: ArrowDownLeftIcon,
  withdrawal: ArrowUpRightIcon,
  closure: DoorClosedIcon,
};

const TXN_TONE: Record<SavingsTxnType, string> = {
  deposit: "text-success",
  withdrawal: "text-warning",
  closure: "text-muted-foreground",
};

/**
 * Which way the money went. A statement is read down a column, so the arrow
 * does the work — in and out are told apart before the word is read, which is
 * what makes a long statement scannable at all.
 */
export function TxnTypeTag({ type }: { type: SavingsTxnType }) {
  const Icon = TXN_ICON[type];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Icon className={cn("size-4 shrink-0", TXN_TONE[type])} />
      {TXN_TYPE_LABELS[type]}
    </span>
  );
}

/**
 * How much of the balance is actually the customer's to take today, and how
 * much is the GHS 50 the account has to keep. Two numbers that only mean
 * something against each other, so they are drawn as one bar rather than left
 * side by side to be compared.
 */
export function BalanceMeter({
  balance,
  available,
  className,
}: {
  balance: number;
  available: number;
  className?: string;
}) {
  const held = Math.min(balance, MIN_BALANCE);
  const width = balance > 0 ? Math.max(0, Math.min(1, available / balance)) : 0;

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className="flex h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`GH₵ ${formatAmount(available)} available of a GH₵ ${formatAmount(balance)} balance`}
      >
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${width * 100}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-primary" />
          <span className="tabular">{formatAmount(available)}</span> available
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-muted-foreground/30" />
          <span className="tabular">{formatAmount(held)}</span> held back
        </span>
      </div>
    </div>
  );
}

/**
 * The figure box, the column heading and the pager all live in
 * `~/components/listing` now: every module draws them the same way, and a copy
 * per module is how two tables end up a pixel apart. Re-exported here so the
 * savings screens keep importing their furniture from one place.
 */
export { Figure, PagerButton, Th } from "~/components/listing";
