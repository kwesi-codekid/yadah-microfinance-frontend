import { formatGhs } from "~/lib/money";
import {
  buildCycleSlots,
  cyclePercent,
  remainingDeposits,
  type SusuAccount,
  type SusuDeposit,
} from "~/lib/susu-client";

/**
 * The cycle, drawn.
 *
 * A susu account is 31 days at a fixed amount, and the question a customer asks
 * at the counter is "how far am I?". A table of deposits answers that only after
 * you count the rows — so the primary view is a grid of 31 cells, one per day,
 * which answers it at a glance and from arm's length.
 */

export function CycleGrid({
  account,
  deposits,
}: {
  account: SusuAccount;
  /**
   * Every deposit on the cycle — ask for them with `limit: 100`, not the
   * default page of 20. A cycle is at most 31 deposits, so one page always
   * holds the lot; a short page would silently draw a cycle with holes in it.
   */
  deposits: SusuDeposit[];
}) {
  const slots = buildCycleSlots(account, deposits);
  const left = remainingDeposits(account);
  const hasCatchUp = slots.some((slot) => slot.partOfCatchUp);

  return (
    <div className="space-y-3">
      {/* The grid is decorative to a screen reader — the sentence below carries
          the same information in a form that doesn't require counting squares. */}
      <ol
        aria-hidden="true"
        // Cells size themselves to the space: eight or so across on a phone,
        // the full 31 in two rows on a monitor. A fixed column count would
        // either overflow at 360px or leave a stripe of empty grid on desktop.
        className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1.5"
      >
        {slots.map((slot) => (
          <li
            key={slot.seq}
            title={
              slot.deposit
                ? `Day ${slot.seq} · ${formatGhs(account.dailyAmount)}${
                    slot.partOfCatchUp
                      ? ` · part of a ${slot.deposit.daysCovered}-day catch-up`
                      : ""
                  }`
                : `Day ${slot.seq} · not yet paid`
            }
            className={[
              "flex aspect-square items-center justify-center rounded-md border-2 text-[11px] font-semibold tabular-nums transition-colors",
              slot.filled
                ? // A catch-up is the same money, so it keeps the same fill —
                  // but a dashed edge marks the days that were paid in one
                  // lump rather than one by one, which is the distinction a
                  // collector has to explain when a customer reads a statement
                  // and finds four days they don't remember paying.
                  slot.partOfCatchUp
                  ? "border-dashed border-success bg-success/25 text-foreground"
                  : "border-success bg-success text-success-foreground"
                : "border-border bg-surface text-muted/60",
            ].join(" ")}
          >
            {slot.seq}
          </li>
        ))}
      </ol>

      <p className="text-sm text-muted">
        <span className="font-semibold text-foreground">
          {account.depositsCount} of {account.cycleTarget}
        </span>{" "}
        days paid
        {left > 0 ? (
          <>
            {" "}
            · {left} {left === 1 ? "day" : "days"} left ·{" "}
            {formatGhs(left * account.dailyAmount)} to go
          </>
        ) : (
          " · cycle complete"
        )}
      </p>

      {/* Only worth explaining the dashed cells when there are some. */}
      {hasCatchUp && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <span
            aria-hidden="true"
            className="inline-block size-3 rounded-sm border-2 border-dashed border-success bg-success/25"
          />
          Paid as part of a catch-up covering several days.
        </p>
      )}
    </div>
  );
}

/**
 * The same progress in one line, for a list of accounts where the full grid
 * would be more ink than the row deserves.
 */
export function CycleBar({ account }: { account: SusuAccount }) {
  const percent = cyclePercent(account);

  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuenow={account.depositsCount}
        aria-valuemin={0}
        aria-valuemax={account.cycleTarget}
        aria-label={`${account.depositsCount} of ${account.cycleTarget} days paid`}
      >
        <div
          className={`h-full rounded-full ${percent >= 100 ? "bg-brand" : "bg-success"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted">
        {account.depositsCount}/{account.cycleTarget}
      </span>
    </div>
  );
}

/** Status pill, shared by the account list and the account detail header. */
export function StatusPill({ account }: { account: SusuAccount }) {
  // Tinted fills, so the text colour is the *token* rather than its
  // `-foreground` pair — `success-foreground` is white, which is for a solid
  // success fill and would vanish on a 15% one.
  const tone =
    account.status === "active"
      ? "bg-success/15 text-success"
      : account.status === "completed"
        ? "bg-brand/15 text-brand-dark dark:text-brand-light"
        : "bg-muted/15 text-muted";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${tone}`}
    >
      {account.status}
    </span>
  );
}
