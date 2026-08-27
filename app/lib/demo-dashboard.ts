/**
 * TEMPORARY — dummy figures for the dashboard while `GET /reports/dashboard`
 * is still being built.
 *
 * Everything here is invented. It exists so the screen can be designed and
 * reviewed against realistic figures instead of an empty state, and it is
 * shaped to the payloads the API will answer with: `DashboardMetrics` exactly
 * as `~/lib/reports` declares it, plus a `DashboardSeries` for the history the
 * charts need. When the endpoints land, delete this file and the two calls in
 * `routes/dashboard.tsx` that read it — nothing else on the screen has to move.
 *
 * Two rules the numbers here obey, because a dashboard that contradicts itself
 * is worse than one with no numbers at all:
 *
 *   1. **Everything reconciles.** Today's tiles are the last point of the
 *      30-day series. The collectors' rows sum to today's susu and savings
 *      deposits. The arrears buckets sum to the loan and HP arrears counts, and
 *      PAR-30 is the buckets past 30 days over the credit book. A figure is
 *      never invented twice.
 *   2. **Everything is deterministic.** The generator is seeded from the Accra
 *      calendar day, so the server and the browser render identical figures and
 *      hydration cannot mismatch. Call it in the loader and pass the result
 *      down; never call it during render.
 *
 * Money is integer pesewas throughout, the way the API returns it.
 */

import { accraDay } from "~/lib/format";
import type { DashboardMetrics, Tally, WorkerStatus } from "~/lib/reports";

/* ------------------------------------------------------------------- seed --- */

/** mulberry32 — small, fast, and good enough for figures nobody banks on. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 32-bit seed for any string — the same day always draws the same day. */
function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A value that wobbles around `base` by `spread` either side, rounded to whole. */
function around(r: () => number, base: number, spread: number): number {
  return Math.round(base * (1 + (r() * 2 - 1) * spread));
}

/* --------------------------------------------------------------- the shape --- */

/** The history the dashboard charts read. Not part of the API's shape yet. */
export interface DashboardSeries {
  /** The last 30 Accra days, oldest first. Money in pesewas. */
  daily: DayPoint[];
  /** The last 6 calendar months, oldest first. */
  revenue: RevenueMonth[];
  /** Arrears on the credit book, in the buckets the loan report uses. */
  aging: AgingBucket[];
  /** Portfolio quality — the ratios a branch is judged on. */
  quality: PortfolioQuality;
  /** Who collected what today. */
  collectors: CollectorRow[];
}

export interface DayPoint {
  /** `YYYY-MM-DD`, Accra. */
  day: string;
  /** Short label for an axis tick — `Mon 18`. */
  label: string;
  cashIn: number;
  cashOut: number;
  /** Cash in less cash out. Transfer legs are not in either figure. */
  net: number;
  movements: number;
}

export interface RevenueMonth {
  /** `YYYY-MM`. */
  month: string;
  /** Short label for an axis tick — `Aug`. */
  label: string;
  susuCommission: number;
  savingsFees: number;
  /** Margin on outright counter sales. Trading profit, but revenue all the same. */
  outrightSalesProfit: number;
  total: number;
  /** True for the month still running: its bar is an incomplete figure. */
  partial: boolean;
}

export type AgingKey = "1-30" | "31-60" | "61-90" | "90+";

export interface AgingBucket {
  key: AgingKey;
  label: string;
  count: number;
  amount: number;
}

export interface PortfolioQuality {
  /** Loans plus hire purchase, outstanding. */
  creditBook: number;
  /** Susu held plus savings on deposit. */
  depositsHeld: number;
  /** Credit book over deposits held, as a fraction. */
  loanToDeposit: number;
  /** Balance of everything more than 30 days late, over the credit book. */
  par30: number;
  /** The same past 90 days. */
  par90: number;
  /** What was collected this month against what fell due, as a fraction. */
  collectionEfficiency: number;
  /** Amount behind the two PAR figures, so the ratio can be checked. */
  atRisk30: number;
  atRisk90: number;
}

export interface CollectorRow {
  id: string;
  name: string;
  susu: Tally;
  savings: Tally;
  /** Susu plus savings, the figure a collector counts their bag against. */
  total: number;
  /** What this collector is expected to bring in on a full day. */
  target: number;
}

/* ------------------------------------------------------------- the branch --- */

/**
 * The invented branch. One place to change if the figures should read bigger or
 * smaller — everything below is derived from these.
 */
const BRANCH = {
  customersActive: 1247,
  susu: { accounts: 486, held: 52_400_000, awaitingClosure: 23, pendingPayout: 3_180_000 },
  savings: { accounts: 612, standard: 412, student: 200, balance: 73_150_000 },
  loans: { active: 214, arrears: 31, outstanding: 89_400_000 },
  hp: { active: 78, arrears: 9, outstanding: 21_650_000 },
};

/**
 * The field staff, with the round each usually walks and what a full day on it
 * is expected to bring in. The targets sit a little above a normal day's take,
 * so the column reads as something to be met rather than as a formality that
 * everyone clears by lunchtime.
 */
const COLLECTORS = [
  { id: "u-101", name: "Kwame Mensah", weight: 0.26, target: 940_000 },
  { id: "u-102", name: "Ama Boateng", weight: 0.23, target: 830_000 },
  { id: "u-103", name: "Yaw Osei", weight: 0.19, target: 690_000 },
  { id: "u-104", name: "Efua Danso", weight: 0.17, target: 610_000 },
  { id: "u-105", name: "Kojo Asare", weight: 0.15, target: 540_000 },
];

/* ---------------------------------------------------------------- a day --- */

/** Every tally a single Accra day produces. The unit of everything below. */
interface DayLedger {
  susuDeposits: Tally;
  savingsDeposits: Tally;
  loanRepayments: Tally;
  hpPayments: Tally;
  susuPayouts: Tally;
  savingsWithdrawals: Tally;
  loanDisbursements: Tally;
  internal: Tally;
}

const MS_PER_DAY = 86_400_000;

/**
 * One day's book, drawn from the day's own seed.
 *
 * The weekly rhythm is the point: susu is collected door to door six days a
 * week and Sunday is quiet, month-end is when loans are disbursed and when
 * customers come for their savings. A flat random series would draw a chart
 * that no branch would recognise as its own week.
 */
function ledgerFor(day: string): DayLedger {
  const r = rng(seedOf(day));
  const date = new Date(`${day}T12:00:00Z`);
  const weekday = date.getUTCDay(); // 0 = Sunday
  const dayOfMonth = date.getUTCDate();

  const sunday = weekday === 0;
  // Market days carry the heaviest collections; Sunday almost none.
  const collectionPace = sunday ? 0.08 : weekday === 6 ? 1.25 : weekday === 3 ? 1.15 : 1;
  // Loans are disbursed in the last week of the month and the first few days.
  const disbursing = dayOfMonth >= 24 || dayOfMonth <= 3;

  const susuCount = Math.round(around(r, 320, 0.18) * collectionPace);
  const savingsCount = Math.round(around(r, 78, 0.25) * collectionPace);
  const repayCount = sunday ? 0 : around(r, 56, 0.3);
  const hpCount = sunday ? 0 : around(r, 18, 0.4);

  // The out side is sized to roughly balance the in side over a month, because
  // that is what a branch in steady state looks like: a susu cycle pays out
  // what it took in, and loans go back out as fast as they are repaid. Sized
  // any smaller and the demo draws a branch whose deposits grow 40% a month.
  const payoutCount = sunday ? 0 : around(r, 14, 0.5);
  const withdrawalCount = sunday ? 0 : Math.round(around(r, 30, 0.35) * (disbursing ? 1.3 : 1));
  // Roughly a month's worth of principal back out the door, so the loan book
  // neither doubles nor drains over the thirty days the chart draws.
  const disburseCount = disbursing && !sunday ? around(r, 10, 0.5) : r() > 0.7 ? 1 : 0;

  const tally = (count: number, ticket: number, spread: number): Tally => ({
    count,
    amount: count === 0 ? 0 : count * around(r, ticket, spread),
  });

  return {
    susuDeposits: tally(susuCount, 5_900, 0.12),
    savingsDeposits: tally(savingsCount, 16_400, 0.2),
    loanRepayments: tally(repayCount, 26_500, 0.18),
    hpPayments: tally(hpCount, 21_800, 0.22),
    susuPayouts: tally(payoutCount, 142_000, 0.25),
    savingsWithdrawals: tally(withdrawalCount, 40_000, 0.3),
    loanDisbursements: tally(disburseCount, 305_000, 0.35),
    internal: tally(sunday ? 0 : around(r, 6, 0.6), 62_000, 0.4),
  };
}

const cashInOf = (l: DayLedger): Tally =>
  sum([l.susuDeposits, l.savingsDeposits, l.loanRepayments, l.hpPayments]);

const cashOutOf = (l: DayLedger): Tally =>
  sum([l.susuPayouts, l.savingsWithdrawals, l.loanDisbursements]);

function sum(tallies: Tally[]): Tally {
  return tallies.reduce(
    (acc, t) => ({ count: acc.count + t.count, amount: acc.amount + t.amount }),
    { count: 0, amount: 0 },
  );
}

/* ------------------------------------------------------------- generators --- */

/**
 * The dashboard's figures, as at `now`.
 *
 * Call this in a loader. It reads the clock once, and everything it returns is
 * plain JSON — so the browser renders exactly what the server sent.
 */
export function demoDashboard(now: Date = new Date()): {
  metrics: DashboardMetrics;
  series: DashboardSeries;
} {
  const today = accraDay(now);
  const ledger = ledgerFor(today);
  const cashIn = cashInOf(ledger);
  const cashOut = cashOutOf(ledger);

  const daily = demoDaily(now, 30);
  const revenue = demoRevenue(now, 6);
  const thisMonth = revenue[revenue.length - 1];
  const monthStart = `${today.slice(0, 7)}-01`;

  const aging = demoAging();
  const atRisk30 = aging
    .filter((b) => b.key !== "1-30")
    .reduce((total, b) => total + b.amount, 0);
  const atRisk90 = aging.find((b) => b.key === "90+")?.amount ?? 0;
  const creditBook = BRANCH.loans.outstanding + BRANCH.hp.outstanding;
  const depositsHeld = BRANCH.susu.held + BRANCH.savings.balance;

  const metrics: DashboardMetrics = {
    today: {
      day: today,
      cashIn,
      cashOut,
      internalMoves: ledger.internal,
      in: {
        susuDeposits: ledger.susuDeposits,
        savingsDeposits: ledger.savingsDeposits,
        loanRepayments: ledger.loanRepayments,
        hpPayments: ledger.hpPayments,
      },
      out: {
        susuPayouts: ledger.susuPayouts,
        savingsWithdrawals: ledger.savingsWithdrawals,
        loanDisbursements: ledger.loanDisbursements,
      },
    },
    monthToDate: {
      from: monthStart,
      to: today,
      susuCommission: { count: thisMonth.susuCommissionCount, amount: thisMonth.susuCommission },
      savingsFees: { count: thisMonth.savingsFeesCount, amount: thisMonth.savingsFees },
      outrightSalesProfit: {
        count: thisMonth.salesCount,
        amount: thisMonth.outrightSalesProfit,
      },
      totalRevenue: thisMonth.total,
    },
    portfolio: {
      customersActive: BRANCH.customersActive,
      susu: {
        activeAccounts: BRANCH.susu.accounts,
        completedAwaitingClosure: BRANCH.susu.awaitingClosure,
        valueHeld: BRANCH.susu.held,
        pendingPayout: {
          count: BRANCH.susu.awaitingClosure,
          amount: BRANCH.susu.pendingPayout,
        },
      },
      savings: {
        activeAccounts: BRANCH.savings.accounts,
        totalBalance: BRANCH.savings.balance,
        byType: {
          standard: { count: BRANCH.savings.standard, amount: 58_200_000 },
          student: { count: BRANCH.savings.student, amount: 14_950_000 },
        },
      },
      loans: {
        active: BRANCH.loans.active,
        arrears: BRANCH.loans.arrears,
        outstanding: BRANCH.loans.outstanding,
      },
      hirePurchase: {
        active: BRANCH.hp.active,
        inArrears: BRANCH.hp.arrears,
        outstanding: BRANCH.hp.outstanding,
      },
    },
    generatedAt: now.toISOString(),
  };

  return {
    metrics,
    series: {
      daily,
      revenue: revenue.map(
        ({ susuCommissionCount, savingsFeesCount, salesCount, ...month }) => month,
      ),
      aging,
      quality: {
        creditBook,
        depositsHeld,
        loanToDeposit: creditBook / depositsHeld,
        par30: atRisk30 / creditBook,
        par90: atRisk90 / creditBook,
        collectionEfficiency: 0.942,
        atRisk30,
        atRisk90,
      },
      collectors: demoCollectors(today, ledger),
    },
  };
}

/** The last `days` Accra days ending today, oldest first. */
function demoDaily(now: Date, days: number): DayPoint[] {
  const points: DayPoint[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const day = accraDay(new Date(now.getTime() - back * MS_PER_DAY));
    const ledger = ledgerFor(day);
    const cashIn = cashInOf(ledger);
    const cashOut = cashOutOf(ledger);
    points.push({
      day,
      label: shortDayLabel(day),
      cashIn: cashIn.amount,
      cashOut: cashOut.amount,
      net: cashIn.amount - cashOut.amount,
      movements: cashIn.count + cashOut.count,
    });
  }
  return points;
}

/** `Mon 18` — a tick that says both which weekday and which date. */
function shortDayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
  }).format(new Date(`${day}T12:00:00Z`));
}

type RevenueMonthInternal = RevenueMonth & {
  susuCommissionCount: number;
  savingsFeesCount: number;
  salesCount: number;
};

/**
 * The last `count` calendar months, oldest first. The running month is drawn
 * pro-rata for the days elapsed and flagged `partial`, so its short bar reads
 * as "not finished" rather than "a bad month".
 */
function demoRevenue(now: Date, count: number): RevenueMonthInternal[] {
  const today = accraDay(now);
  const [year, month, dayOfMonth] = today.split("-").map(Number);
  const months: RevenueMonthInternal[] = [];

  for (let back = count - 1; back >= 0; back--) {
    const date = new Date(Date.UTC(year, month - 1 - back, 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const r = rng(seedOf(`revenue:${key}`));
    const partial = back === 0;

    const daysInMonth = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const elapsed = partial ? dayOfMonth / daysInMonth : 1;

    // Susu commission is one day's contribution per cycle closed, so it tracks
    // closures rather than volume; savings fees track withdrawals; the sale
    // margin tracks how many things went over the counter outright.
    //
    // The book is growing, so the base climbs across the six months — without
    // that the bars come out within a few percent of each other and the chart
    // draws a flat line that tells the reader nothing they did not already know
    // from the month-to-date figure above it.
    // Gentle enough that the running month, pro-rated, still lands below the
    // months that finished — otherwise the shortest bar is the tallest one and
    // "so far" reads as a lie.
    const growth = 1 + (count - 1 - back) * 0.03;
    const closures = Math.round(around(r, 82 * growth, 0.32) * elapsed);
    const withdrawals = Math.round(around(r, 300 * growth, 0.28) * elapsed);
    const sales = Math.round(around(r, 46 * growth, 0.35) * elapsed);
    const susuCommission = closures * around(r, 19_400, 0.12);
    const savingsFees = withdrawals * around(r, 2_600, 0.1);
    const outrightSalesProfit = sales * around(r, 8_900, 0.22);

    months.push({
      month: key,
      label: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short" }).format(date),
      susuCommission,
      savingsFees,
      outrightSalesProfit,
      total: susuCommission + savingsFees + outrightSalesProfit,
      partial,
      susuCommissionCount: closures,
      savingsFeesCount: withdrawals,
      salesCount: sales,
    });
  }
  return months;
}

/**
 * Arrears on the credit book. Fixed rather than drawn: the bucket counts have
 * to add up to the 31 loans and 9 agreements the portfolio already reports, and
 * a random walk would drift away from them.
 */
function demoAging(): AgingBucket[] {
  return [
    { key: "1-30", label: "1–30 days", count: 18, amount: 2_240_000 },
    { key: "31-60", label: "31–60 days", count: 11, amount: 2_180_000 },
    { key: "61-90", label: "61–90 days", count: 5, amount: 1_240_000 },
    { key: "90+", label: "Over 90 days", count: 6, amount: 2_130_000 },
  ];
}

/**
 * Today's collection split across the field staff. The shares are drawn, then
 * the remainder is settled on the last row, so the table's total is today's
 * susu and savings deposits exactly — which is the whole point of the table.
 */
function demoCollectors(today: string, ledger: DayLedger): CollectorRow[] {
  const r = rng(seedOf(`collectors:${today}`));
  // Each collector's share wobbles around their usual weight, then is normalised.
  const shares = COLLECTORS.map((c) => c.weight * (0.75 + r() * 0.5));
  const totalShare = shares.reduce((a, b) => a + b, 0);

  const rows: CollectorRow[] = [];
  const running = { susuCount: 0, susuAmount: 0, savingsCount: 0, savingsAmount: 0 };

  COLLECTORS.forEach((collector, i) => {
    const last = i === COLLECTORS.length - 1;
    const share = shares[i] / totalShare;

    const susu: Tally = last
      ? {
          count: ledger.susuDeposits.count - running.susuCount,
          amount: ledger.susuDeposits.amount - running.susuAmount,
        }
      : {
          count: Math.round(ledger.susuDeposits.count * share),
          amount: Math.round(ledger.susuDeposits.amount * share),
        };

    const savings: Tally = last
      ? {
          count: ledger.savingsDeposits.count - running.savingsCount,
          amount: ledger.savingsDeposits.amount - running.savingsAmount,
        }
      : {
          count: Math.round(ledger.savingsDeposits.count * share),
          amount: Math.round(ledger.savingsDeposits.amount * share),
        };

    running.susuCount += susu.count;
    running.susuAmount += susu.amount;
    running.savingsCount += savings.count;
    running.savingsAmount += savings.amount;

    rows.push({
      id: collector.id,
      name: collector.name,
      susu,
      savings,
      total: susu.amount + savings.amount,
      target: collector.target,
    });
  });

  return rows.sort((a, b) => b.total - a.total);
}

/**
 * The four background workers, all healthy and recently run. The real endpoint
 * is admin-only and in-memory; this stands in for it with the same shape.
 */
export function demoWorkers(now: Date = new Date()): Record<string, WorkerStatus> {
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  const startedAt = new Date(now.getTime() - 19 * 3_600_000).toISOString();

  return {
    sms: {
      startedAt,
      lastRunAt: minutesAgo(2),
      lastOk: true,
      lastError: null,
      lastChanges: { sent: 34, failed: 1 },
      runs: 574,
    },
    loanEscalation: {
      startedAt,
      lastRunAt: minutesAgo(41),
      lastOk: true,
      lastError: null,
      lastChanges: { escalated: 3 },
      runs: 19,
    },
    hpArrears: {
      startedAt,
      lastRunAt: minutesAgo(41),
      lastOk: true,
      lastError: null,
      lastChanges: { flagged: 1 },
      runs: 19,
    },
    debtRecovery: {
      startedAt,
      lastRunAt: minutesAgo(128),
      lastOk: false,
      lastError: "susu account s-4471 has no balance to recover from",
      lastChanges: { recovered: 0 },
      runs: 6,
    },
  };
}
