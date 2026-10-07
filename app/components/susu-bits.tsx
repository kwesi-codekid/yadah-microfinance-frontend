import { formatAmount, formatCount } from "~/lib/format";
import {
  CYCLE_TARGET,
  PLAN_STATUS_LABELS,
  SUSU_STATUS_BLURBS,
  SUSU_STATUS_LABELS,
  SUSU_STATUS_TONE,
  type SusuPlan,
  type SusuStatus,
} from "~/lib/susu";
import { cn } from "~/lib/utils";

/**
 * The small pieces the susu screens share. They live here rather than in the
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

/** The account's state, drawn the way every other status in the app is drawn. */
export function SusuStatusPill({ status }: { status: SusuStatus }) {
  const tone = SUSU_STATUS_TONE[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap"
      title={SUSU_STATUS_BLURBS[status]}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
      <span className={TONE_TEXT[tone]}>{SUSU_STATUS_LABELS[status]}</span>
    </span>
  );
}

/**
 * One plan, in the space of a table cell: its daily amount and how far its
 * cycle has come. A customer with two plans reads as two of these side by
 * side, which is exactly how the branch talks about them — "the ten and the
 * twenty".
 */
export function PlanChip({ plan, className }: { plan: SusuPlan; className?: string }) {
  const target = plan.cycleTarget || CYCLE_TARGET;
  const stopped = plan.status === "stopped";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap",
        stopped
          ? "border-dashed border-border text-muted-foreground"
          : "border-border bg-card",
        className,
      )}
      title={
        stopped
          ? `${PLAN_STATUS_LABELS.stopped} · ${formatAmount(plan.dailyAmount)} a day`
          : `Cycle ${plan.cycleNumber} · ${plan.paidInCycle} of ${target} paid`
      }
    >
      <span className="tabular font-medium">{formatAmount(plan.dailyAmount)}</span>
      {stopped ? (
        <span>stopped</span>
      ) : (
        <span className="tabular text-muted-foreground">
          {formatCount(plan.paidInCycle)}/{formatCount(target)}
        </span>
      )}
    </span>
  );
}

/**
 * The 31 payments of a plan's cycle, one row, each its own square.
 *
 * The numbers are cycle positions, not dates — the API counts a cycle by
 * payment and a catch-up fills several at once, so there is no honest mapping
 * to a Tuesday. What the strip buys over a bar is the shape of the thing: a
 * run of paid squares reads at a glance, and the ones still to fill are
 * countable rather than inferred from how full a bar looks.
 */
export function CycleStrip({
  paid,
  target = CYCLE_TARGET,
  dim = false,
  className,
}: {
  paid: number;
  target?: number;
  /** A stopped plan: the strip stays for the record but stops asking for attention. */
  dim?: boolean;
  className?: string;
}) {
  const full = target || CYCLE_TARGET;
  const done = Math.max(0, Math.min(full, paid));

  return (
    <ol
      className={cn("grid gap-0.75", className)}
      style={{ gridTemplateColumns: `repeat(${full}, minmax(0, 1fr))` }}
      aria-label={`${done} of ${full} payments made`}
    >
      {Array.from({ length: full }, (_, i) => i + 1).map((n) => {
        const isPaid = n <= done;
        const next = !dim && !isPaid && n === done + 1;
        return (
          <li
            key={n}
            aria-label={`Payment ${n}: ${isPaid ? "paid" : "not yet"}`}
            className={cn(
              "h-2.5 rounded-xs",
              isPaid ? (dim ? "bg-muted-foreground/40" : "bg-primary") : "bg-muted",
              next && "ring-1 ring-primary/50 ring-inset",
            )}
          />
        );
      })}
    </ol>
  );
}

/**
 * How much of the balance is the customer's, against the commission due to
 * Yadah on the cycles in progress. Two numbers that only mean something
 * against each other, so they are one bar — the same bar the savings page
 * draws for its minimum balance, because the two products are meant to feel
 * like one.
 */
export function LockMeter({
  balance,
  available,
  locked,
  className,
}: {
  balance: number;
  available: number;
  locked: number;
  className?: string;
}) {
  const width = balance > 0 ? Math.max(0, Math.min(1, available / balance)) : 0;
  return (
    <div className={cn("space-y-2", className)}>
      <div
        className="flex h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`GH₵ ${formatAmount(available)} customer's money of a GH₵ ${formatAmount(balance)} balance`}
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${width * 100}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-primary" />
          <span className="tabular">{formatAmount(available)}</span> customer's money
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-muted-foreground/30" />
          <span className="tabular">{formatAmount(locked)}</span> commission due to Yadah
        </span>
      </div>
    </div>
  );
}

/**
 * The column heading and the pager both live in `~/components/listing` now:
 * every module draws them the same way. Re-exported here so the susu screens
 * keep importing their furniture from one place.
 */
export { Figure, PagerButton, Th } from "~/components/listing";
