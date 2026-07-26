import type { SusuAccount, SusuDeposit } from "~/lib/susu-client";

/**
 * A cycle laid out on the calendar it actually happened on.
 *
 * The 31 days of a susu cycle are *sequence* numbers, not dates: a customer who
 * misses a week still owes day 12 next, so day 12 can fall three weeks after
 * day 11. A row of 31 numbered boxes shows how far along the cycle is but
 * cannot answer the two questions asked over the counter — "which days did I
 * pay?" and "when did I last pay?" — because it has no dates in it at all.
 *
 * So this maps deposits onto real months. One visit is one cell, on the day the
 * money was taken; a catch-up covering four days is still one visit, and the
 * cell says so rather than colouring in four squares that never happened.
 *
 * Dates are the ISO string's own digits throughout, never a parsed local
 * `Date` — the same rule as [format.ts](app/lib/format.ts), and for the same
 * reason: the API stores UTC, Ghana is UTC+0 all year, and going through the
 * browser's timezone would shift a deposit onto the previous day for anyone
 * west of it and disagree with the statement table on the same page.
 */

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Monday first. Collections run Monday to Saturday, so a week that starts on
 * Sunday puts a working week across two rows and splits the pattern a collector
 * is looking for.
 */
export const WEEKDAYS = [
  { short: "Mon", long: "Monday" },
  { short: "Tue", long: "Tuesday" },
  { short: "Wed", long: "Wednesday" },
  { short: "Thu", long: "Thursday" },
  { short: "Fri", long: "Friday" },
  { short: "Sat", long: "Saturday" },
  { short: "Sun", long: "Sunday" },
];

/**
 * How many months are ever drawn.
 *
 * A 31-day cycle spans two calendar months, three if it is paid patchily. A
 * year of them means an account nobody has touched in months, and twelve month
 * cards would be a wall rather than an answer — the oldest are dropped and
 * counted, never dropped silently.
 */
const MAX_MONTHS = 6;

export interface CalendarDay {
  /** `YYYY-MM-DD`. */
  date: string;
  dayOfMonth: number;
  /** False for the days of the neighbouring months that pad the first and last
   *  weeks. They are drawn, faintly, so the weeks keep their shape. */
  inMonth: boolean;
  /** Between the day the account opened and the day it stopped taking money. */
  withinCycle: boolean;
  isToday: boolean;
  isOpenedOn: boolean;
  isClosedOn: boolean;
  /** Every deposit taken on this date — normally none or one. */
  deposits: SusuDeposit[];
  /** Cycle days covered by them: more than one when a visit was a catch-up. */
  daysCovered: number;
  /** Pesewas taken on the date. */
  amount: number;
  hasCatchUp: boolean;
}

export interface CalendarMonth {
  /** `2026-07`, stable across renders — the React key. */
  key: string;
  /** `July 2026`. */
  label: string;
  /** Whole weeks, Monday first: four to six rows of seven. */
  weeks: CalendarDay[][];
  /** Cycle days paid within this month, and what they came to. */
  daysPaid: number;
  amount: number;
}

export interface CycleCalendar {
  months: CalendarMonth[];
  /** Older months dropped by `MAX_MONTHS`. Say so if it isn't zero. */
  omitted: number;
}

/** `YYYY-MM-DD` → a UTC midnight `Date`, safe to do arithmetic on. */
function toUtc(ymd: string): Date {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * The months an account has lived through, with every deposit placed on the day
 * it was taken.
 *
 * `today` is passed in rather than read from the clock: this renders on the
 * server and again in the browser, and a component that asks the clock twice
 * can draw two different calendars either side of midnight — which React
 * reports as a hydration mismatch on someone else's machine and never on yours.
 */
export function buildCycleCalendar(
  account: SusuAccount,
  deposits: SusuDeposit[],
  today: string,
): CycleCalendar {
  const opened = account.openedAt.slice(0, 10);

  const byDate = new Map<string, SusuDeposit[]>();
  for (const deposit of deposits) {
    const date = deposit.createdAt.slice(0, 10);
    const existing = byDate.get(date);
    if (existing) existing.push(deposit);
    else byDate.set(date, [deposit]);
  }

  // `YYYY-MM-DD` sorts and compares correctly as a string, so none of this
  // needs a Date.
  const dates = [...byDate.keys()].sort();
  const lastDeposit = dates.at(-1);

  /**
   * The last day worth drawing. A closed account stops at its closing date; a
   * live one runs to today, so the empty days since the last deposit are
   * visible — that gap is the thing a collector is looking for. A completed
   * cycle takes no more money, so it stops at the deposit that filled it.
   */
  let end =
    account.closedAt?.slice(0, 10) ??
    (account.status === "active" ? today : (lastDeposit ?? opened));
  if (lastDeposit && lastDeposit > end) end = lastDeposit;
  if (end < opened) end = opened;

  // First of the opened month, first of the end month.
  const firstMonth = toUtc(`${opened.slice(0, 7)}-01`);
  const lastMonth = toUtc(`${end.slice(0, 7)}-01`);

  const months: CalendarMonth[] = [];
  for (
    let cursor = firstMonth;
    cursor <= lastMonth;
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
    )
  ) {
    months.push(
      buildMonth({
        year: cursor.getUTCFullYear(),
        month: cursor.getUTCMonth(),
        byDate,
        opened,
        end,
        today,
        closedAt: account.closedAt?.slice(0, 10),
      }),
    );
  }

  // Keep the most recent: what happened lately is what anyone is looking at.
  const omitted = Math.max(0, months.length - MAX_MONTHS);
  return { months: omitted ? months.slice(omitted) : months, omitted };
}

function buildMonth({
  year,
  month,
  byDate,
  opened,
  end,
  today,
  closedAt,
}: {
  year: number;
  month: number;
  byDate: Map<string, SusuDeposit[]>;
  opened: string;
  end: string;
  today: string;
  closedAt?: string;
}): CalendarMonth {
  const first = new Date(Date.UTC(year, month, 1));
  // Day 0 of the next month is the last day of this one.
  const dayCount = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  // `getUTCDay()` is Sunday-based; rotate it so Monday is column 0.
  const lead = (first.getUTCDay() + 6) % 7;
  const cellCount = Math.ceil((lead + dayCount) / 7) * 7;

  const days: CalendarDay[] = [];
  let daysPaid = 0;
  let amount = 0;

  for (let i = 0; i < cellCount; i++) {
    const date = addDays(first, i - lead);
    const ymd = toYmd(date);
    const inMonth = date.getUTCMonth() === month;
    // Padding days belong to the neighbouring month's own card, and marking
    // them here would draw the same deposit twice.
    const deposits = inMonth ? (byDate.get(ymd) ?? []) : [];

    const covered = deposits.reduce((sum, d) => sum + d.daysCovered, 0);
    const taken = deposits.reduce((sum, d) => sum + d.amount, 0);
    daysPaid += covered;
    amount += taken;

    days.push({
      date: ymd,
      dayOfMonth: date.getUTCDate(),
      inMonth,
      withinCycle: inMonth && ymd >= opened && ymd <= end,
      isToday: inMonth && ymd === today,
      isOpenedOn: inMonth && ymd === opened,
      isClosedOn: inMonth && ymd === closedAt,
      deposits,
      daysCovered: covered,
      amount: taken,
      hasCatchUp: deposits.some((d) => d.daysCovered > 1),
    });
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return {
    key: `${year}-${String(month + 1).padStart(2, "0")}`,
    label: `${MONTH_NAMES[month]} ${year}`,
    weeks,
    daysPaid,
    amount,
  };
}
