import { formatCount } from "~/lib/format";
import {
  CYCLE_TARGET,
  SUSU_STATUS_BLURBS,
  SUSU_STATUS_LABELS,
  SUSU_STATUS_TONE,
  type SusuStatus,
} from "~/lib/susu";
import { cn } from "~/lib/utils";

/**
 * The small pieces the susu screens share. They live here rather than in the
 * listing route so the detail page can use the same pill without one route
 * importing another.
 */

const TONE_DOT: Record<string, string> = {
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  muted: "bg-muted-foreground/50",
};

const TONE_TEXT: Record<string, string> = {
  success: "text-foreground",
  info: "text-foreground",
  warning: "text-foreground",
  muted: "text-muted-foreground",
};

/**
 * The account's state, drawn the way every other status in the app is drawn: a
 * dot and a word. The colour carries the urgency — a `pending-payout` account
 * is money the branch still owes someone, so it takes the warning tone.
 */
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
 * How far through the 31 deposits. A cycle is the unit the whole product is
 * built on, so it is drawn as a bar rather than left as two numbers to compare
 * — "24 / 31" takes a moment, a bar three-quarters full does not.
 */
export function CycleBar({
  count,
  target = CYCLE_TARGET,
  className,
}: {
  count: number;
  target?: number;
  className?: string;
}) {
  const full = target || CYCLE_TARGET;
  const done = Math.max(0, Math.min(full, count));
  const complete = done >= full;

  return (
    <div className={cn("w-28 space-y-1", className)}>
      <p className="tabular text-xs text-muted-foreground">
        <span className={cn("font-medium", complete ? "text-info" : "text-foreground")}>
          {formatCount(done)}
        </span>
        {" of "}
        {formatCount(full)}
      </p>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${done} of ${full} deposits`}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            complete ? "bg-info" : "bg-primary",
          )}
          style={{ width: `${(done / full) * 100}%` }}
        />
      </div>
    </div>
  );
}

/**
 * The 31 days of the cycle, one row, each day its own square.
 *
 * The numbers are cycle positions, not dates — the API counts a cycle by
 * position and a catch-up deposit fills several at once, so there is no honest
 * mapping to a Tuesday. What the grid buys over a single bar is the shape of
 * the thing: a run of paid days reads at a glance, and the squares still to
 * fill are countable rather than inferred from how full a bar looks.
 */
export function CycleGrid({
  count,
  target = CYCLE_TARGET,
  saved,
  withdrawn,
  held,
  className,
}: {
  count: number;
  target?: number;
  /** Total paid in, already formatted — shown beside the day count. */
  saved: string;
  /**
   * Handed back through partial withdrawals, already formatted. Omitted, or
   * given as zero, when nothing has been taken out.
   *
   * Since partial withdrawals were allowed, "saved" and "held" are two
   * different figures and a customer asking what is in their account means the
   * second. Showing only the first would overstate it by whatever they have
   * already collected — so both appear, or neither does.
   */
  withdrawn?: string;
  /** What the account actually holds now, already formatted. */
  held?: string;
  className?: string;
}) {
  const full = target || CYCLE_TARGET;
  const done = Math.max(0, Math.min(full, count));
  const complete = done >= full;

  return (
    <section className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm">
          <span className="text-muted-foreground">Day </span>
          <span className={cn("tabular font-semibold", complete && "text-info")}>
            {formatCount(done)}
          </span>
          <span className="text-muted-foreground"> of {formatCount(full)}</span>
          <span className="tabular ml-3 text-muted-foreground">{saved} saved</span>
          {withdrawn && held && (
            <>
              <span className="tabular ml-3 text-muted-foreground">
                {withdrawn} taken out
              </span>
              <span className="tabular ml-3 font-semibold">{held} held</span>
            </>
          )}
        </p>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-primary" />
            Paid
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-muted" />
            Not yet
          </span>
        </div>
      </div>

      {/* All of them on one row. Below roughly 750px that stops fitting, so
          the strip scrolls rather than shrinking the days into slivers. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <ol
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${full}, minmax(1.5rem, 1fr))` }}
          aria-label={`${done} of ${full} days paid`}
        >
          {Array.from({ length: full }, (_, i) => i + 1).map((day) => {
            const paid = day <= done;
            return (
              <li
                key={day}
                aria-label={`Day ${day}: ${paid ? "paid" : "not yet"}`}
                className={cn(
                  "tabular flex h-9 items-center justify-center rounded-md text-xs",
                  paid
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                  // The next one due, so the eye lands on what to collect.
                  !paid && day === done + 1 && "ring-1 ring-primary/40",
                )}
              >
                {day}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/**
 * The column heading and the pager both live in `~/components/listing` now:
 * every module draws them the same way, and a copy per module is how two
 * tables end up a pixel apart. Re-exported here so the susu screens keep
 * importing their furniture from one place.
 */
export { PagerButton, Th } from "~/components/listing";
