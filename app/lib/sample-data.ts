import { calendarYear, lastDays, shiftDay } from "~/lib/analytics";
import { weekdayLabel } from "~/lib/format";

/** Shown wherever a figure from this file is drawn. */
export const SAMPLE_NOTICE = "Sample data";

function seeded(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
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

export function sampleYear(year: number, scope = "all"): SampleMonth[] {
  return calendarYear(year).map((key, i) => {
    const roll = seeded(`${scope}:${key}`);

    const base = 180_000 + i * 14_000;
    const collected = Math.round((base + roll * 90_000) / 100) * 100;

    const paidOut =
      Math.round((collected * (0.35 + seeded(`out:${key}`) * 0.3)) / 100) * 100;

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

export function sampleSavingsDay(date: string): SampleSavingsDay {
  const roll = seeded(`savings:${date}`);
  const withdrawalCount = Math.floor(roll * 6);
  return {
    depositsIn: Math.round((40_000 + roll * 55_000) / 100) * 100,
    depositCount: 4 + Math.floor(seeded(`sc:${date}`) * 11),
    withdrawalsOut: Math.round((withdrawalCount * (18_000 + roll * 20_000)) / 100) * 100,
    withdrawalCount,
    feesCollected: withdrawalCount * 1_000,
  };
}

const toPesewas = (cedis: number) => Math.round(cedis) * 100;

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

const SUSU_BY_WEEKDAY = [4_100, 12_400, 11_800, 12_900, 12_100, 13_600, 9_700];
const SAVINGS_BY_WEEKDAY = [2_600, 8_600, 7_900, 9_200, 8_400, 10_100, 6_300];

function mondayOf(date: string): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return date;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return shiftDay(date, -(weekday === 0 ? 6 : weekday - 1));
}

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
  expected: number;
}

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

export function sampleTellers(date: string): SampleTeller[] {
  return TELLERS.map((teller, i) => {
    const roll = wobble(`till:${date}:${teller.name}`, 0.12);
    const deposits = toPesewas(teller.deposits * roll);
    const withdrawals = toPesewas(teller.withdrawals * roll);
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
