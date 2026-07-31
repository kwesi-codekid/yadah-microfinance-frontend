/**
 * Stand-in figures for the parts of the dashboard the API cannot answer yet.
 *
 * Several panels have no endpoint behind them:
 *
 * - **The yearly chart.** Nothing takes a date range. `GET /susu/summary` answers
 *   one day, so a calendar year is 365 requests; the page used to assemble the
 *   series by reading up to 400 deposit statements instead, which cost a burst of
 *   requests on every load and still had to be captioned "a floor, not a total".
 * - **Savings activity for a day.** There is no `GET /savings/summary`, and
 *   transactions are per account, so a day's deposits and withdrawals would be
 *   one request per savings account.
 * - **Anything spanning a week** — the twelve-week inflow trend, the seven-day
 *   split between counter and round. Same missing date range as the year.
 * - **Payment channels and counter drawers.** The API records neither: a deposit
 *   carries an amount and who took it, not whether it arrived as cash, MoMo or a
 *   cheque, and there is no till to reconcile against.
 *
 * Everything here is therefore invented, and every panel that draws from it says
 * so on screen — see `SAMPLE_NOTICE`. Nothing in this file is used for anything
 * a person acts on: today's collections, the round, the book, payouts due and
 * the collector figures are all real API data.
 *
 * Deterministic on purpose. A `Math.random()` series would differ between the
 * server render and the browser hydration, and the numbers would change every
 * time the page revalidated — which reads as live data rather than as a
 * placeholder. Same inputs, same figures, every time.
 *
 * **Deleting this file is the definition of done.** Each function names the
 * endpoint that replaces it.
 */

import { calendarYear, lastDays, shiftDay } from "~/lib/analytics";
import { weekdayLabel } from "~/lib/format";

/** Shown wherever a figure from this file is drawn. */
export const SAMPLE_NOTICE = "Sample data";

/**
 * A small deterministic hash → a number in [0, 1).
 *
 * Not cryptographic and not meant to be: it exists so `sample-2026-03` always
 * produces the same figure on the server and in the browser.
 */
function seeded(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // >>> 0 first: `Math.imul` returns a signed 32-bit int, and a negative one
  // would put the result outside [0, 1).
  return (hash >>> 0) / 4294967296;
}

/** One month of the sample year. Amounts are integer pesewas, as everywhere. */
export interface SampleMonth {
  /** `YYYY-MM`. */
  key: string;
  collected: number;
  paidOut: number;
  depositCount: number;
}

/**
 * A year of collections, January to December.
 *
 * Replaced by: a susu endpoint taking `from` / `to`, or a monthly summary.
 *
 * `scope` varies the figures per collector so the office view and a collector's
 * own view aren't the same numbers twice — an office total that exactly equalled
 * one person's takings would look like a bug.
 */
export function sampleYear(year: number, scope = "all"): SampleMonth[] {
  // Months come from `calendarYear` rather than being rebuilt here, so the
  // sample series and the axis can't disagree about what a year is.
  return calendarYear(year).map((key, i) => {
    const roll = seeded(`${scope}:${key}`);

    // A base that drifts up across the year, so the chart has a shape rather
    // than twelve equal bars, plus a per-month wobble.
    const base = 180_000 + i * 14_000;
    const collected = Math.round((base + roll * 90_000) / 100) * 100;

    // Payouts trail collections: a cycle closes 31 days after it fills, so the
    // money out of a month is roughly the money in of an earlier one.
    const paidOut =
      Math.round((collected * (0.35 + seeded(`out:${key}`) * 0.3)) / 100) * 100;

    // Deposits average a little over the daily minimum, which is what sets the
    // count against the amount.
    const depositCount = Math.round(collected / (700 + roll * 400));

    return { key, collected, paidOut, depositCount };
  });
}

/** A day's savings movement. */
export interface SampleSavingsDay {
  depositsIn: number;
  depositCount: number;
  withdrawalsOut: number;
  withdrawalCount: number;
  /** Fees taken — GHS 10 a withdrawal. */
  feesCollected: number;
}

/**
 * Savings paid in and out on one day.
 *
 * Replaced by: `GET /savings/summary?date=`, mirroring `GET /susu/summary`.
 */
export function sampleSavingsDay(date: string): SampleSavingsDay {
  const roll = seeded(`savings:${date}`);
  const withdrawalCount = Math.floor(roll * 6);
  return {
    depositsIn: Math.round((40_000 + roll * 55_000) / 100) * 100,
    depositCount: 4 + Math.floor(seeded(`sc:${date}`) * 11),
    withdrawalsOut: Math.round((withdrawalCount * (18_000 + roll * 20_000)) / 100) * 100,
    withdrawalCount,
    // The flat GHS 10 fee, once per withdrawal — the one figure here that is
    // arithmetic rather than invention.
    feesCollected: withdrawalCount * 1_000,
  };
}

/* ------------------------------------------------------------------ *
 * The operator panels
 *
 * Figures below are quoted in whole cedis, because they were written by hand
 * and a row of six-digit pesewa literals is unreadable and unreviewable. They
 * are converted on the way out — everything this file exports is integer
 * pesewas, like the API and like the rest of the app.
 * ------------------------------------------------------------------ */

const toPesewas = (cedis: number) => Math.round(cedis) * 100;

/**
 * A collector's share of an operation-wide figure.
 *
 * Same purpose as `sampleYear`'s `scope`: one person's panel and the whole
 * office's must not print the same number, or the page reads as broken.
 */
function scopeShare(scope: string): number {
  return scope === "all" ? 1 : 0.18 + seeded(`scope:${scope}`) * 0.22;
}

/** ±`spread` around 1, decided by `key`. Keeps a fixed shape from looking fixed. */
function wobble(key: string, spread = 0.08): number {
  return 1 - spread + seeded(key) * spread * 2;
}

/** A named run of figures, one per label. Integer pesewas. */
export interface SampleSeries {
  key: string;
  label: string;
  data: number[];
}

/**
 * A day's money in, indexed the way `Date.getUTCDay` counts — Sunday first.
 *
 * Keyed by weekday for the same reason `BY_WEEKDAY` below is: Monday's shape
 * has to land on Monday whichever day the page is asked about. The weekend
 * carries real figures rather than zeroes — a market trader saves on a Saturday
 * — but both days sit well under the working week, and Sunday lowest of all.
 */
const SUSU_BY_WEEKDAY = [4_100, 12_400, 11_800, 12_900, 12_100, 13_600, 9_700];
const SAVINGS_BY_WEEKDAY = [2_600, 8_600, 7_900, 9_200, 8_400, 10_100, 6_300];

/**
 * The Monday of the week `date` falls in.
 *
 * Sunday counts as the end of the week it closes, not the start of the next
 * one — asking on a Sunday should show the week just worked, not an empty one.
 */
function mondayOf(date: string): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return date;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return shiftDay(date, -(weekday === 0 ? 6 : weekday - 1));
}

/**
 * The week's money in, susu against savings — Monday through Sunday.
 *
 * Replaced by: a susu and a savings endpoint taking `from` / `to`, bucketed by
 * day — the same thing that replaces `sampleYear`.
 */
export function sampleWeeklyInflows(
  date: string,
  scope = "all",
): {
  labels: string[];
  dates: string[];
  series: SampleSeries[];
} {
  const share = scopeShare(scope);
  const monday = mondayOf(date);
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(monday, i));

  // The column runs Monday-first; the shape rows are indexed Sunday-first, so
  // the last column (Sunday) wraps back to slot 0.
  const scale = (shape: number[], key: string) =>
    days.map((day, i) =>
      toPesewas(
        (shape[(i + 1) % 7] ?? 0) *
          share *
          wobble(`${key}:${scope}:${day}`, 0.06),
      ),
    );

  return {
    labels: days.map((day) => weekdayLabel(day)),
    dates: days,
    series: [
      {
        key: "susu",
        label: "Susu collections",
        data: scale(SUSU_BY_WEEKDAY, "susu"),
      },
      {
        key: "savings",
        label: "Savings deposits",
        data: scale(SAVINGS_BY_WEEKDAY, "savings"),
      },
    ],
  };
}

/**
 * A weekday's shape, indexed the way `Date.getUTCDay` counts — Sunday first.
 *
 * Keyed by weekday rather than held as a flat seven-day run so the market's
 * quiet Sunday lands on the actual Sunday whichever day the page is asked
 * about. A run of figures that slid a day every time somebody changed the date
 * would be a worse lie than the invention itself.
 */
const BY_WEEKDAY = [
  { office: 4_200, field: 21_400, round: 30_000 }, // Sun
  { office: 33_800, field: 45_100, round: 47_200 },
  { office: 33_200, field: 38_650, round: 46_200 },
  { office: 28_400, field: 42_100, round: 47_000 },
  { office: 31_200, field: 44_300, round: 47_500 },
  { office: 34_600, field: 45_800, round: 48_000 },
  { office: 18_900, field: 39_200, round: 46_000 }, // Sat
];

const WEEKDAY_INDEX = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One day of the counter-against-round panel. */
export interface SampleSourceDay {
  /** `YYYY-MM-DD`. */
  date: string;
  /** `Tue`. */
  label: string;
  office: number;
  field: number;
  /**
   * What a full round is worth on that weekday — the round's target alone, not
   * the day's.
   *
   * It follows the chart. The two sources are drawn side by side now, each
   * measured off the axis, so a rule covering both added together would sit
   * above every bar on the panel and read as a target nobody ever meets. Scoped
   * to the round, it lines up with the bar it is about: did the route get
   * covered.
   */
  expected: number;
}

/**
 * Seven days of takings, split between the counter and the round.
 *
 * Replaced by: `GET /susu/summary` gaining a date range, or any endpoint that
 * reports a deposit's origin. Today's column is the only one the app can
 * currently answer for real — see `splitBySource` in
 * [analytics.ts](app/lib/analytics.ts).
 */
export function sampleSourceWeek(date: string, scope = "all"): SampleSourceDay[] {
  const share = scopeShare(scope);
  return lastDays(date, 7).map((day) => {
    const label = weekdayLabel(day);
    const shape = BY_WEEKDAY[Math.max(0, WEEKDAY_INDEX.indexOf(label))];
    const roll = wobble(`src:${scope}:${day}`);
    return {
      date: day,
      label,
      office: toPesewas(shape.office * share * roll),
      field: toPesewas(shape.field * share * roll),
      // What the round alone should bring in on that weekday.
      expected: toPesewas(shape.round * share),
    };
  });
}

/** One row of the payment-channel panel. */
export interface SampleChannel {
  key: string;
  label: string;
  value: number;
}

/** Month to date, by how the money arrived. Cedis, before scoping. */
const CHANNELS = [
  { key: "cash_counter", label: "Cash (counter)", value: 428_000 },
  { key: "mtn_momo", label: "MTN MoMo", value: 356_000 },
  { key: "vodafone_cash", label: "Telecel Cash", value: 188_000 },
  { key: "bank_transfer", label: "Bank transfer", value: 142_000 },
  { key: "cheque", label: "Cheque", value: 64_000 },
];

/**
 * How the month's money arrived.
 *
 * Replaced by: a `channel` on the deposit and transaction records, which the
 * API does not carry today — a deposit knows its amount and who took it, and
 * nothing else about how it was paid.
 */
export function sampleChannels(month: string, scope = "all"): SampleChannel[] {
  const share = scopeShare(scope);
  return CHANNELS.map((channel) => ({
    ...channel,
    value: toPesewas(channel.value * share * wobble(`ch:${channel.key}:${month}`)),
  }));
}

/** One counter teller's day. */
export interface SampleTeller {
  name: string;
  branch: string;
  transactions: number;
  deposits: number;
  withdrawals: number;
  /** Deposits less withdrawals — what the drawer should be up by. */
  netCash: number;
  drawer: "balanced" | "variance" | "open";
}

const TELLERS = [
  { name: "Comfort Adjei", branch: "Accra Central", transactions: 84, deposits: 22_400, withdrawals: 11_200 },
  { name: "Samuel Tetteh", branch: "Kumasi Adum", transactions: 71, deposits: 18_900, withdrawals: 9_600 },
  { name: "Linda Ofori", branch: "Accra Central", transactions: 66, deposits: 15_300, withdrawals: 14_800 },
  { name: "Bernard Quaye", branch: "Takoradi Market", transactions: 52, deposits: 12_100, withdrawals: 6_400 },
  { name: "Mavis Danso", branch: "Tamale Central", transactions: 39, deposits: 8_700, withdrawals: 5_100 },
];

/**
 * The counter, teller by teller, for the day.
 *
 * Replaced by: nothing that exists. The API has no branch, no till and no
 * concept of a teller's session, so a drawer cannot be reconciled against it —
 * this panel is a sketch of a feature, not a stand-in for a missing endpoint.
 *
 * `netCash` is arithmetic on the two figures above it rather than a third
 * invented number, so a reader who adds the row up gets the answer printed.
 */
export function sampleTellers(date: string): SampleTeller[] {
  return TELLERS.map((teller, i) => {
    const roll = wobble(`till:${date}:${teller.name}`, 0.12);
    const deposits = toPesewas(teller.deposits * roll);
    const withdrawals = toPesewas(teller.withdrawals * roll);
    // One drawer out and one still open, decided by the date so the day's
    // alert and the day's table always name the same person.
    const off = Math.floor(seeded(`drawer:${date}`) * TELLERS.length);
    return {
      name: teller.name,
      branch: teller.branch,
      transactions: Math.round(teller.transactions * roll),
      deposits,
      withdrawals,
      netCash: deposits - withdrawals,
      drawer: i === off ? "variance" : i === TELLERS.length - 1 ? "open" : "balanced",
    };
  });
}
