import { formatDate, formatMonth } from "~/lib/format";
import { formatGhs } from "~/lib/money";
import {
  buildCycleCalendar,
  WEEKDAYS,
  type CalendarDay,
  type CalendarMonth,
} from "~/lib/susu-calendar";
import {
  cyclePercent,
  type SusuAccount,
  type SusuDeposit,
} from "~/lib/susu-client";

/**
 * The cycle, on the calendar it happened on.
 *
 * Two questions get asked over the counter, and they are not the same question:
 * "how far am I?" — answered by the count and the bar at the top — and "which
 * days did I pay?", which needs dates. This used to be 31 numbered boxes, which
 * answered only the first: the boxes are cycle *positions*, and a customer who
 * misses a week still owes day 12 next, so box 12 could be any date at all.
 *
 * One cell is one day of the month, and one visit fills one cell on the day the
 * money was taken. A catch-up covering four days stays a single cell marked
 * ×4 rather than four filled squares — because four squares would claim four
 * visits that never happened, and reconciling a statement against them is
 * exactly where that lie gets found.
 */

/**
 * The cycle as 31 chips — the paper susu card, which is literally a row of
 * numbered boxes a collector marks off.
 *
 * One chip is one *position* in the cycle, not one visit. That distinction is
 * the whole reason the calendar next door exists, so it has to be handled
 * rather than ignored: a single payment covering four days fills four chips,
 * because four positions really were covered, and those four carry a dashed
 * edge to say they arrived as one payment rather than four trips to the
 * counter. Solid means somebody walked in that day.
 *
 * What a chip cannot show is *when*. Position 12 is position 12 whether it was
 * paid on time or three weeks late, so the date lives in each chip's title and
 * screen-reader text, and the statement above carries every one in full.
 */
export function CycleChips({
  account,
  deposits,
  selectedSeq = null,
  onSelectSeq,
}: {
  account: SusuAccount;
  /** Every deposit on the cycle — `limit: 100`, same as the calendar wants. */
  deposits: SusuDeposit[];
  /**
   * The cycle position picked by clicking a chip, if any. A position rather
   * than a date, because several positions can share one date — every day of
   * a catch-up does — and selecting by date lit the whole run when only one
   * day had been clicked.
   */
  selectedSeq?: number | null;
  /**
   * Called with a paid chip's position when it is clicked. Omit and the chips
   * are read-only — they stay plain text, not buttons that do nothing.
   */
  onSelectSeq?: (seq: number) => void;
}) {
  const filtering = selectedSeq != null;
  // Position -> the deposit that covered it. A catch-up spans seqStart..seqEnd,
  // so one deposit claims several positions.
  const bySeq = new Map<number, SusuDeposit>();
  for (const deposit of deposits) {
    for (let seq = deposit.seqStart; seq <= deposit.seqEnd; seq += 1) {
      bySeq.set(seq, deposit);
    }
  }

  const hasCatchUp = deposits.some((deposit) => deposit.daysCovered > 1);

  /**
   * The chips in runs of one month, so the row can be labelled.
   *
   * Contiguous by construction: positions fill in order and time only moves
   * forwards, so every position paid in July sits before every position paid
   * in August, and the tail nobody has paid yet is the last run of all. That
   * is what lets a run be a column span rather than a scattered set.
   */
  const runs: { key: string; label: string; span: number }[] = [];
  for (let seq = 1; seq <= account.cycleTarget; seq += 1) {
    const deposit = bySeq.get(seq);
    // Grouped on the raw `YYYY-MM`, not on the label — a cycle that ran over a
    // year end would otherwise merge two Januaries into one run.
    const key = deposit ? deposit.createdAt.slice(0, 7) : "";
    const label = deposit ? formatMonth(deposit.createdAt) : "Not yet";
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.span += 1;
    else runs.push({ key, label, span: 1 });
  }

  // One set of columns, shared by the month band and the chips, so a label
  // sits exactly over the days it covers.
  const columns = {
    gridTemplateColumns: `repeat(${account.cycleTarget}, minmax(0, 1fr))`,
  };

  return (
    <div className="rounded-lg border-2 border-border bg-surface p-3">
      {/* Count, total and key all on one line. Each was a row of its own and
          the panel ran to four — for thirty-one numbers, a legend and a figure
          that between them say one sentence. The key sits here rather than
          under the chips because it is the least of the three and gets the
          leftover width; below `sm` it wraps to its own line, which is the one
          place the space is actually free. */}
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
        <p className="text-sm font-semibold tabular-nums text-foreground">
          Day {account.depositsCount} of {account.cycleTarget}
        </p>
        <p className="text-xs tabular-nums text-muted">
          {formatGhs(account.totalDeposited)} saved
        </p>

        <ul className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <ChipKey className="border-success bg-success" label="Paid" />
          {/* Only worth explaining the dashed chips when there are some. */}
          {hasCatchUp && (
            <ChipKey
              className="border-dashed border-success bg-success/20"
              label="Catch-up"
            />
          )}
          <ChipKey
            className="border-transparent bg-background"
            label="Not yet"
          />
        </ul>
      </div>

      {/* The whole cycle on one line, chips stretched to fill it, so the row
          reads as a bar divided into 31 rather than a bag of pills. It stops
          shrinking at 46rem and scrolls sideways below that — squeezing 31
          two-digit numbers into a phone's width makes them unreadable, and a
          timeline is a thing people expect to scroll. */}
      <div className="overflow-x-auto">
        <div className="min-w-184">
          {/* Month band. Same columns as the chips, each label spanning its
              own run, so the tick marks where a month begins. */}
          <ul className="mb-1 grid gap-1" style={columns}>
            {runs.map((run) => (
              <li
                key={run.key || "unpaid"}
                style={{ gridColumn: `span ${run.span}` }}
                className="truncate border-l-2 border-border pl-1.5 text-[10px] font-bold uppercase tracking-wide text-muted"
              >
                {run.label}
              </li>
            ))}
          </ul>

          <ul className="grid gap-1" style={columns}>
        {Array.from({ length: account.cycleTarget }, (_, index) => {
          const seq = index + 1;
          const deposit = bySeq.get(seq);
          const catchUp = deposit ? deposit.daysCovered > 1 : false;
          const picked = seq === selectedSeq;

          const face = deposit
            ? catchUp
              ? "border-dashed border-success bg-success/20 text-foreground"
              : "border-success bg-success text-success-foreground"
            : "border-transparent bg-background text-muted";

          // While a day is picked, the rest fade rather than recolour: a
          // greyed-out green chip still reads as paid, where repainting it
          // would read as a day nobody paid.
          const dimmed = filtering && !picked ? "opacity-35" : "";
          const ringed = picked ? "ring-2 ring-accent" : "";

          const spoken = deposit
            ? `Day ${seq}: paid ${formatDate(deposit.createdAt)}${
                catchUp
                  ? `, one of ${deposit.daysCovered} days covered together`
                  : ""
              }`
            : `Day ${seq}: not yet paid`;

          const chip = `flex w-full items-center justify-center rounded-full border-2 py-0.5 text-[11px] font-semibold tabular-nums transition-opacity ${face} ${dimmed} ${ringed}`;

          // Only a paid day has something to filter to. An unpaid one stays a
          // plain span — a disabled button here would be 20-odd focus stops
          // that lead nowhere.
          if (!deposit || !onSelectSeq) {
            return (
              <li key={seq} className="min-w-0">
                <span title={spoken} className={chip}>
                  <span aria-hidden="true">{seq}</span>
                  <span className="sr-only">{spoken}</span>
                </span>
              </li>
            );
          }

          return (
            <li key={seq} className="min-w-0">
              <button
                type="button"
                // Pressed, not selected: this is a toggle, and clicking the
                // day already isolated is how you clear it.
                aria-pressed={picked}
                title={`${spoken}. Click to show this day only.`}
                onClick={() => onSelectSeq(seq)}
                className={`${chip} cursor-pointer hover:ring-2 hover:ring-accent/50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent`}
              >
                <span aria-hidden="true">{seq}</span>
                <span className="sr-only">{spoken}. Show this day only.</span>
              </button>
            </li>
          );
        })}
        </ul>
        </div>
      </div>
    </div>
  );
}

/** One swatch in the key, shaped like the chips it explains. */
function ChipKey({ className, label }: { className: string; label: string }) {
  return (
    <li className="flex items-center gap-1">
      <span
        aria-hidden="true"
        className={`inline-block h-3 w-5 rounded-full border-2 ${className}`}
      />
      {label}
    </li>
  );
}

export function CycleCalendar({
  account,
  deposits,
  today,
}: {
  account: SusuAccount;
  /**
   * Every deposit on the cycle — ask for them with `limit: 100`, not the
   * default page of 20. A cycle is at most 31 deposits, so one page always
   * holds the lot; a short page would silently draw a calendar with holes.
   */
  deposits: SusuDeposit[];
  /** Accra's date, `YYYY-MM-DD`, from the loader — see `buildCycleCalendar`. */
  today: string;
}) {
  const { months, omitted } = buildCycleCalendar(account, deposits, today);
  const hasCatchUp = deposits.some((deposit) => deposit.daysCovered > 1);

  return (
    <div className="space-y-4">
      {/* No count, bar or "last paid" line above the months: the header of this
          page already carries the cycle's state, and the calendar is here to be
          read as a calendar. The statement below is where the figures live. */}

      {/* Two months side by side on a laptop: a 31-day cycle spans two, and
          seeing both at once is what makes a missed week obvious. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {months.map((month) => (
          <Month key={month.key} month={month} />
        ))}
      </div>

      {omitted > 0 && (
        <p className="text-xs text-muted">
          {omitted} earlier {omitted === 1 ? "month" : "months"} not shown — the
          statement below has every deposit.
        </p>
      )}

      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
        <Key className="border-success bg-success" label="Paid" />
        {/* Only worth explaining the dashed cells when there are some. */}
        {hasCatchUp && (
          <Key
            className="border-dashed border-success bg-success/25"
            label="Catch-up — one visit covering several days"
          />
        )}
        <Key className="border-accent bg-surface ring-2 ring-accent" label="Today" />
        <Key
          className="border-border bg-surface"
          label="Opened or closed"
          dot
        />
      </ul>
    </div>
  );
}

/** One month card. A real `<table>`, so the columns are days of the week to a
 *  screen reader as well as to the eye. */
function Month({ month }: { month: CalendarMonth }) {
  return (
    /* `bg-surface` now that the cards sit straight on the page rather than
       inside another one — the secondary tone was there to lift them off a
       white card and is all but invisible against the page background. */
    <section className="rounded-xl border-2 border-border bg-surface p-3">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-heading text-sm font-semibold text-foreground">
          {month.label}
        </h3>
        {month.daysPaid > 0 && (
          <p className="text-xs tabular-nums text-muted">
            {month.daysPaid} {month.daysPaid === 1 ? "day" : "days"} ·{" "}
            {formatGhs(month.amount)}
          </p>
        )}
      </header>

      <table className="w-full table-fixed border-separate border-spacing-1">
        <caption className="sr-only">
          Deposits in {month.label}, by day
        </caption>
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th
                key={weekday.long}
                scope="col"
                className="pb-1 text-[10px] font-bold uppercase tracking-wide text-muted"
              >
                <abbr title={weekday.long} className="no-underline">
                  {weekday.short}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {month.weeks.map((week) => (
            <tr key={week[0]?.date}>
              {week.map((day) => (
                <td key={day.date} className="p-0 align-top">
                  <Day day={day} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Day({ day }: { day: CalendarDay }) {
  // A padding day belongs to the neighbouring month's own card. It holds the
  // week's shape and says nothing.
  if (!day.inMonth) return <div aria-hidden="true" className="aspect-square" />;

  const paid = day.deposits.length > 0;

  const face = paid
    ? // A catch-up is the same money, so it keeps the same colour — the dashed
      // edge is what marks days paid in one lump rather than one by one, which
      // is the distinction a collector has to explain when a customer reads a
      // statement and finds four days they don't remember paying.
      day.hasCatchUp
      ? "border-dashed border-success bg-success/25 font-semibold text-foreground"
      : "border-success bg-success font-semibold text-success-foreground"
    : day.withinCycle
      ? "border-border bg-surface text-muted"
      : // Before the account existed, or after it stopped taking money.
        "border-transparent text-muted/40";

  const spoken = paid
    ? `${formatDate(day.date)}: paid ${formatGhs(day.amount)}${
        day.daysCovered > 1 ? `, covering ${day.daysCovered} days` : ""
      }`
    : day.withinCycle
      ? `${formatDate(day.date)}: nothing paid`
      : formatDate(day.date);

  return (
    <div
      title={[
        spoken,
        day.isOpenedOn ? "Account opened" : null,
        day.isClosedOn ? "Account closed" : null,
        day.isToday ? "Today" : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      className={[
        "relative flex aspect-square flex-col items-center justify-center rounded-lg border-2 text-[11px] tabular-nums transition-colors",
        face,
        day.isToday ? "ring-2 ring-accent" : "",
      ].join(" ")}
    >
      <span aria-hidden="true">{day.dayOfMonth}</span>
      {/* How many cycle days this one visit covered. Absolute, so a ×4 never
          shifts the date off the centre of its cell. */}
      {day.daysCovered > 1 && (
        <span
          aria-hidden="true"
          className="absolute right-0.5 top-0.5 text-[9px] font-bold leading-none"
        >
          ×{day.daysCovered}
        </span>
      )}
      {/* The two days that aren't deposits but are still events. */}
      {(day.isOpenedOn || day.isClosedOn) && (
        <span
          aria-hidden="true"
          className="absolute bottom-1 size-1 rounded-full bg-current opacity-60"
        />
      )}
      <span className="sr-only">{spoken}</span>
    </div>
  );
}

/** One swatch in the key under the calendar. */
function Key({
  className,
  label,
  dot,
}: {
  className: string;
  label: string;
  dot?: boolean;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={`relative inline-block size-3.5 rounded-sm border-2 ${className}`}
      >
        {dot && (
          <span className="absolute inset-x-0 bottom-0 mx-auto size-1 rounded-full bg-muted" />
        )}
      </span>
      {label}
    </li>
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
