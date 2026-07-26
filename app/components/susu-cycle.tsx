import { formatDate } from "~/lib/format";
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
