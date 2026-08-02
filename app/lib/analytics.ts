import { CEDI } from "~/lib/money";
import type { SavingsAccount } from "~/lib/savings-client";
import { projectedPayout, type SusuAccount } from "~/lib/susu-client";

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

export function lastDays(iso: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftDay(iso, i - (count - 1)));
}

/** `2026-07-26T09:14:00Z` → `2026-07`. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

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

export function payoutsByMonth(accounts: SusuAccount[]): Map<string, number> {
  const byMonth = new Map<string, number>();
  for (const account of accounts) {
    if (account.status !== "closed" || !account.closedAt) continue;
    const month = monthKey(account.closedAt);
    byMonth.set(month, (byMonth.get(month) ?? 0) + (account.payoutAmount ?? 0));
  }
  return byMonth;
}

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

  return [...rows.values()].sort((a, b) => b.amount - a.amount);
}

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

export function payoutsDue(accounts: SusuAccount[], limit = 5): SusuAccount[] {
  return accounts
    .filter((a) => a.status === "active" || a.status === "completed")
    .sort((a, b) => {
      const remainingA =
        a.status === "completed" ? -1 : a.cycleTarget - a.depositsCount;
      const remainingB =
        b.status === "completed" ? -1 : b.cycleTarget - b.depositsCount;
      if (remainingA !== remainingB) return remainingA - remainingB;
      return b.totalDeposited - a.totalDeposited;
    })
    .slice(0, limit);
}

export interface Change {
  /** Whole percent, always positive — `direction` carries the sign. */
  percent: number;
  direction: "up" | "down" | "flat";
}

export function percentChange(current: number, previous: number): Change | null {
  if (previous === 0) return null;
  const delta = ((current - previous) / previous) * 100;
  const percent = Math.abs(Math.round(delta));
  return {
    percent,
    direction: percent === 0 ? "flat" : delta > 0 ? "up" : "down",
  };
}

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
