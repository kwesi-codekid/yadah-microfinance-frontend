/**
 * The arithmetic behind the dashboard.
 *
 * Everything here is a pure function over data the API already returns — there
 * is no analytics endpoint, and no endpoint takes a date *range*. That single
 * fact decides the shape of the whole file:
 *
 * - **Money in, by month** is summed from deposit statements. `GET /susu/summary`
 *   answers for one day, so a year of it would be 365 requests; a statement
 *   (`GET /susu/accounts/{id}/deposits`) carries every deposit on a cycle with
 *   its `createdAt`, so a year costs one request per account instead. Each
 *   deposit also names the collector who took it, which is what lets a monthly
 *   figure be scoped to one person exactly rather than approximately.
 * - **Money out, by month** is free: a closed susu account carries `closedAt`
 *   and `payoutAmount`, so the account list already holds every payout ever.
 *
 * Client-safe — no server-only imports — so a loader can derive with it and a
 * component can format with it. Every amount in and out is integer pesewas; see
 * [money.ts](app/lib/money.ts).
 */

import { CEDI } from "~/lib/money";
import type { SavingsAccount } from "~/lib/savings-client";
import { projectedPayout, type SusuAccount } from "~/lib/susu-client";

/* ------------------------------------------------------------------ *
 * Calendar
 *
 * Ghana keeps UTC+0 with no daylight saving, so the UTC digits of an ISO
 * timestamp *are* the Accra calendar day the API reconciles against — the same
 * reasoning [format.ts](app/lib/format.ts) is built on. Day arithmetic goes
 * through `Date.UTC` for that reason: parsing `2026-07-26` into a local `Date`
 * shifts it a day backwards for anyone west of UTC, which would silently
 * mislabel every column on the chart.
 * ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `2026-07-26` shifted by whole days, still as `YYYY-MM-DD`. */
export function shiftDay(iso: string, delta: number): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return iso.slice(0, 10);
  return new Date(Date.UTC(year, month - 1, day) + delta * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The `count` days ending at `iso`, oldest first.
 *
 * The x-axis of every week-long panel on the dashboard. Built by walking days
 * rather than by subtracting from a `Date`, so it inherits `shiftDay`'s
 * indifference to the reader's timezone.
 */
export function lastDays(iso: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftDay(iso, i - (count - 1)));
}

/* ------------------------------------------------------------------ *
 * Months
 *
 * A month is held as `YYYY-MM` — the first seven characters of any timestamp
 * the API returns — so bucketing is a string slice and never a `Date`. Same
 * reasoning as the day helpers above: no parse, no timezone, no drift.
 * ------------------------------------------------------------------ */

/** `2026-07-26T09:14:00Z` → `2026-07`. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * The twelve months of one calendar year, January to December.
 *
 * A rolling window ending at the current month used to back the chart, which
 * put the year boundary in the middle of the axis — reading Aug…Jul with two
 * different years in it, and no column for a month that hasn't happened yet.
 * A year reads the way a year is spoken about, and December stays on the right
 * where a reader expects to find it.
 */
export function calendarYear(year: number): string[] {
  return Array.from(
    { length: 12 },
    (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`,
  );
}

/** `2026-07` → `Jul`. The x-axis label — twelve of these have to fit. */
export function monthLabel(ym: string): string {
  const month = Number(ym.slice(5, 7));
  return MONTHS[month - 1] ?? "";
}

/** `2026-07` → `Jul 2026`. The tooltip's title, where the year has room. */
export function monthTitle(ym: string): string {
  return `${monthLabel(ym)} ${ym.slice(0, 4)}`;
}

/* ------------------------------------------------------------------ *
 * The monthly series
 * ------------------------------------------------------------------ */

/** One column of the analytics chart. */
export interface FlowPoint {
  /** `YYYY-MM`. */
  key: string;
  /** Under the axis — `Jul`. */
  label: string;
  /** In the tooltip — `Jul 2026`. */
  title: string;
  /** Susu deposits taken that month. */
  collected: number;
  /** Susu payouts released that month. */
  paidOut: number;
  depositCount: number;
}

/*
 * Money in, by month, used to be summed here from every account's deposit
 * statement — the only way to get a series out of an API where nothing takes a
 * date range. It cost up to 400 requests a page load, grew with the book, and
 * the answer still had to be labelled a floor. The chart now draws sample
 * figures and says so; see [sample-data.ts](app/lib/sample-data.ts). Restore a
 * real series here the moment a `from`/`to` endpoint exists.
 */

/**
 * Money out, by the month it left the drawer.
 *
 * Susu only. A closed savings account records its payout as a transaction on
 * the account, and there is no cross-account transaction list to read it from —
 * `GET /savings/accounts/{id}/transactions` is per account — so savings
 * withdrawals are simply not in this series, and the chart says so rather than
 * implying the month's outflow is complete.
 */
export function payoutsByMonth(accounts: SusuAccount[]): Map<string, number> {
  const byMonth = new Map<string, number>();
  for (const account of accounts) {
    if (account.status !== "closed" || !account.closedAt) continue;
    const month = monthKey(account.closedAt);
    byMonth.set(month, (byMonth.get(month) ?? 0) + (account.payoutAmount ?? 0));
  }
  return byMonth;
}

/**
 * Money out on one day, from the accounts closed on it.
 *
 * Real and free, for the same reason `payoutsByMonth` is: a closed account
 * carries `closedAt` and `payoutAmount`, so the account list already holds every
 * payout ever. Susu only — a savings withdrawal lives on the account's
 * transaction list and there is no cross-account view of those.
 */
export function payoutsOnDay(
  accounts: SusuAccount[],
  date: string,
): { amount: number; count: number } {
  let amount = 0;
  let count = 0;
  for (const account of accounts) {
    if (account.status !== "closed" || !account.closedAt) continue;
    if (account.closedAt.slice(0, 10) !== date) continue;
    amount += account.payoutAmount ?? 0;
    count += 1;
  }
  return { amount, count };
}

/**
 * The cash to have ready inside the next `days` collecting days.
 *
 * "Days" here counts deposits, not dates: a cycle is 31 *deposits* and has no
 * calendar maturity, so a cycle four deposits from full is four collecting days
 * away — sooner if the customer pays for several days at once, never later
 * unless they miss. The figure is therefore the earliest the money can be owed,
 * which is the right way round for planning a float.
 */
export function payoutsWithin(
  accounts: SusuAccount[],
  days = 7,
): { amount: number; count: number } {
  let amount = 0;
  let count = 0;
  for (const account of accounts) {
    const due =
      account.status === "completed" ||
      (account.status === "active" &&
        account.cycleTarget - account.depositsCount <= days);
    if (!due) continue;
    amount += projectedPayout(account);
    count += 1;
  }
  return { amount, count };
}

/* ------------------------------------------------------------------ *
 * The day
 *
 * Both derivations below are pure set arithmetic over two things the loader
 * already holds — the account list and `GET /susu/summary` for the day — so
 * neither costs a request.
 * ------------------------------------------------------------------ */

/**
 * Running cycles with no deposit recorded on the day.
 *
 * The work still outstanding, which is the question a collector opens the app
 * with. Ordered by how far behind the cycle is: an account 9 days short of
 * where it should be is a customer about to fall out of a cycle, and one that
 * merely hasn't been seen today is not.
 *
 * `expectedByNow` is deliberately not computed from the calendar. A cycle is 31
 * *deposits*, not 31 days — it has no schedule to be behind, only a target to
 * reach — so "behind" here means how much of the cycle is left to fill.
 */
export function uncollectedToday(
  accounts: SusuAccount[],
  lines: { accountId: string }[],
  limit = 8,
): { accounts: SusuAccount[]; total: number; expected: number } {
  const collected = new Set(lines.map((line) => line.accountId));
  const outstanding = accounts.filter(
    (account) => account.status === "active" && !collected.has(account.id),
  );
  return {
    accounts: [...outstanding]
      .sort(
        (a, b) =>
          b.cycleTarget - b.depositsCount - (a.cycleTarget - a.depositsCount),
      )
      .slice(0, limit),
    total: outstanding.length,
    // What the round is still worth: one day on every account not yet seen.
    expected: outstanding.reduce((sum, a) => sum + a.dailyAmount, 0),
  };
}

/**
 * The day's takings split by where they were taken — the counter or the round.
 *
 * The API records who took a deposit, not where, so the split is read off the
 * role: a deposit recorded by somebody on the collector list came off a round,
 * and one recorded by anybody else came over the counter. Exactly the same rule
 * `byCollector` uses to gather its synthetic "Office" row, so the two panels
 * cannot disagree about what a field deposit is.
 */
export function splitBySource(
  lines: { collectorId: string; amount: number }[],
  collectorIds: Set<string>,
): { office: number; field: number } {
  let office = 0;
  let field = 0;
  for (const line of lines) {
    if (collectorIds.has(line.collectorId)) field += line.amount;
    else office += line.amount;
  }
  return { office, field };
}

/** One collector's day, for the office's reconciliation table. */
export interface CollectorDay {
  id: string;
  name: string;
  amount: number;
  deposits: number;
  /** ISO timestamp of their most recent deposit, or null if they took none. */
  lastAt: string | null;
}

/**
 * The day's takings split by who took them, everyone included.
 *
 * Collectors who recorded nothing are in the list with zeroes rather than
 * missing from it — an absent row reads as "no data", and the whole point of
 * this table at handover is to see who hasn't come in yet.
 *
 * Deposits recorded by an admin or manager are gathered under one synthetic
 * "Office" row: they are real money that has to reconcile, but they belong to
 * no collector's round.
 */
export function byCollector(
  lines: { collectorId: string; amount: number; at: string }[],
  collectors: { id: string; name: string }[],
): CollectorDay[] {
  const rows = new Map<string, CollectorDay>(
    collectors.map((c) => [
      c.id,
      { id: c.id, name: c.name, amount: 0, deposits: 0, lastAt: null },
    ]),
  );

  const OFFICE = "__office__";
  for (const line of lines) {
    const key = rows.has(line.collectorId) ? line.collectorId : OFFICE;
    const row = rows.get(key) ?? {
      id: OFFICE,
      name: "Office",
      amount: 0,
      deposits: 0,
      lastAt: null,
    };
    row.amount += line.amount;
    row.deposits += 1;
    if (!row.lastAt || line.at > row.lastAt) row.lastAt = line.at;
    rows.set(key, row);
  }

  // Most collected first; anyone on zero falls to the bottom, which is where
  // the eye goes looking for them anyway.
  return [...rows.values()].sort((a, b) => b.amount - a.amount);
}

/* ------------------------------------------------------------------ *
 * The book
 * ------------------------------------------------------------------ */

/**
 * What the business is holding, split the way the products actually differ.
 *
 * Not one "total balance": a completed susu cycle is money that has to be
 * counted out over the counter shortly, and the locked part of a savings
 * balance is money that cannot leave at all. Both sit inside a single total and
 * mean opposite things to whoever plans the cash.
 */
export interface Portfolio {
  /** Susu paid in on cycles still running. */
  susuActive: number;
  /** Susu on full cycles — payout is due, less one day's commission. */
  susuCompleted: number;
  /** Savings a withdrawal could take today. */
  savingsAvailable: number;
  /** The GHS 50 minimum and the next fee, held back on every open account. */
  savingsLocked: number;
  total: number;
  susuAccounts: number;
  savingsAccounts: number;
  /** Sum of the daily amount on every running cycle — a full day's round. */
  expectedDaily: number;
}

export function buildPortfolio(
  susu: SusuAccount[],
  savings: SavingsAccount[],
): Portfolio {
  let susuActive = 0;
  let susuCompleted = 0;
  let expectedDaily = 0;
  let susuAccounts = 0;

  for (const account of susu) {
    if (account.status === "closed") continue;
    susuAccounts++;
    if (account.status === "active") {
      susuActive += account.totalDeposited;
      expectedDaily += account.dailyAmount;
    } else {
      susuCompleted += account.totalDeposited;
    }
  }

  let savingsAvailable = 0;
  let savingsLocked = 0;
  let savingsAccounts = 0;

  for (const account of savings) {
    if (account.status !== "active") continue;
    savingsAccounts++;
    savingsAvailable += account.availableToWithdraw;
    // Read off the account rather than recomputed from the two constants, for
    // the reason `lockedBalance` gives: the API owns the formula.
    savingsLocked += Math.max(0, account.balance - account.availableToWithdraw);
  }

  return {
    susuActive,
    susuCompleted,
    savingsAvailable,
    savingsLocked,
    total: susuActive + susuCompleted + savingsAvailable + savingsLocked,
    susuAccounts,
    savingsAccounts,
    expectedDaily,
  };
}

/**
 * The accounts with cash to count out, soonest first.
 *
 * A completed cycle is already owed, so those come first regardless of amount;
 * after them, the running cycles closest to their 31st day. This is the panel
 * somebody plans tomorrow's float from, so it is ordered by *when the money is
 * needed*, not by how much it is.
 */
export function payoutsDue(accounts: SusuAccount[], limit = 5): SusuAccount[] {
  return accounts
    .filter((a) => a.status === "active" || a.status === "completed")
    .sort((a, b) => {
      const remainingA =
        a.status === "completed" ? -1 : a.cycleTarget - a.depositsCount;
      const remainingB =
        b.status === "completed" ? -1 : b.cycleTarget - b.depositsCount;
      if (remainingA !== remainingB) return remainingA - remainingB;
      // Same distance from the end: the bigger payout is the one worth
      // knowing about first, because it is the one the drawer might not cover.
      return b.totalDeposited - a.totalDeposited;
    })
    .slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Comparison
 * ------------------------------------------------------------------ */

export interface Change {
  /** Whole percent, always positive — `direction` carries the sign. */
  percent: number;
  direction: "up" | "down" | "flat";
}

/**
 * Period on period, or `null` when there is nothing to compare against.
 *
 * A rise from zero has no percentage — "+∞%" and "+100%" are both lies, and a
 * dash that says "no basis" is more honest than either. Callers render the
 * previous figure instead when this comes back null.
 */
export function percentChange(current: number, previous: number): Change | null {
  if (previous === 0) return null;
  const delta = ((current - previous) / previous) * 100;
  const percent = Math.abs(Math.round(delta));
  return {
    percent,
    direction: percent === 0 ? "flat" : delta > 0 ? "up" : "down",
  };
}

/* ------------------------------------------------------------------ *
 * Axis
 * ------------------------------------------------------------------ */

/**
 * A round ceiling at or above the tallest bar, so the gridlines land on figures
 * a person would say out loud (₵200, ₵500, ₵1k) rather than on the data's own
 * ragged maximum.
 */
export function axisMax(peak: number): number {
  if (peak <= 0) return 1000; // ₵10 — an empty chart still needs a scale
  const exponent = Math.floor(Math.log10(peak));
  const base = 10 ** exponent;
  const steps = [1, 2, 2.5, 5, 10];
  const step = steps.find((s) => peak <= s * base) ?? 10;
  return step * base;
}

/** `count` evenly spaced gridline values from 0 to `max`, inclusive. */
export function axisTicks(max: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i);
}

/**
 * An amount short enough for an axis tick — `₵0`, `₵850`, `₵1.2k`.
 *
 * Formatted by hand for the same reason `formatGhs` is: `Intl` can disagree
 * between the server render and the browser hydration, and a mismatch that only
 * appears on someone else's machine is the worst kind.
 */
export function compactGhs(pesewas: number): string {
  const cedis = pesewas / 100;
  const abs = Math.abs(cedis);
  if (abs >= 1_000_000) return `${CEDI}${trimDecimal(cedis / 1_000_000)}m`;
  if (abs >= 1000) return `${CEDI}${trimDecimal(cedis / 1000)}k`;
  return `${CEDI}${Math.round(cedis)}`;
}

function trimDecimal(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

/**
 * Rows → a CSV string.
 *
 * Two things are not decoration. Quotes are doubled and every field is wrapped,
 * because a customer's name can contain a comma and half the app's figures
 * contain one. And any field opening with `= + - @` is prefixed with a
 * quote: spreadsheets read those as formulas, so a name typed as `=cmd|...`
 * becomes an instruction when the file is opened. Both are cheap here and
 * impossible to fix once the file has left.
 */
export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell);
          const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
          return `"${safe.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
}
