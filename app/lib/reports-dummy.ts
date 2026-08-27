/**
 * Placeholder figures for the reports page.
 *
 * Everything is generated from a fixed seed so the server and the browser draw
 * the same page — a `Math.random()` here would tear hydration apart — and so
 * that two people looking at the page see the same numbers and can talk about
 * them. Money is integer pesewas, as everywhere else in the app. When the
 * reporting endpoints land, each block below maps onto one of them; the shapes
 * are named for that.
 */

/* ------------------------------------------------------------------- seed --- */

/** Mulberry32 — small, deterministic, good enough for plausible-looking books. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whole pesewas between `lo` and `hi` cedis. */
const cedis = (r: () => number, lo: number, hi: number) =>
  Math.round((lo + (hi - lo) * r()) * 100);

/* ----------------------------------------------------------------- period --- */

export const REPORT_PERIODS = {
  month: { label: "This month", months: 1, days: 30 },
  quarter: { label: "Last 3 months", months: 3, days: 91 },
  year: { label: "Last 12 months", months: 12, days: 365 },
} as const;

export type ReportPeriod = keyof typeof REPORT_PERIODS;

export const DEFAULT_REPORT_PERIOD: ReportPeriod = "quarter";

export function reportPeriodOf(raw: string | null): ReportPeriod {
  return raw && raw in REPORT_PERIODS
    ? (raw as ReportPeriod)
    : DEFAULT_REPORT_PERIOD;
}

/* ----------------------------------------------------------------- shapes --- */

export interface MonthPoint {
  /** `YYYY-MM`. */
  key: string;
  /** `Aug`. */
  label: string;
  /** True for the month still running. */
  partial: boolean;
}

/** One month of flow through one book. */
export interface BookMonth extends MonthPoint {
  inflow: number;
  outflow: number;
}

export interface FlowMonth extends MonthPoint {
  susu: number;
  savings: number;
  loans: number;
  hp: number;
  sales: number;
}

export interface StaffRow {
  id: string;
  name: string;
  role: "collector" | "teller";
  /** Field cash recorded across the period. */
  recorded: number;
  /** What the office confirmed receiving. */
  confirmed: number;
  customers: number;
  /** Collector days reconciled / worked. */
  daysReconciled: number;
  daysWorked: number;
}

export interface HandoverCell {
  /** `YYYY-MM-DD`. */
  day: string;
  /** Confirmed − recorded, pesewas. Null: no collection that day. */
  variance: number | null;
}

export interface HandoverRow {
  staffId: string;
  name: string;
  cells: HandoverCell[];
}

export interface AgingBucket {
  key: "1-30" | "31-60" | "61-90" | "90+";
  label: string;
  count: number;
  amount: number;
}

export interface OverdueLoan {
  id: string;
  customer: string;
  principal: number;
  remaining: number;
  daysOverdue: number;
  collector: string;
}

export interface SusuCycleStage {
  label: string;
  count: number;
}

export interface CategorySales {
  category: string;
  outright: number;
  hp: number;
  units: number;
}

export interface HpStatus {
  label: string;
  count: number;
  amount: number;
}

export interface CustomerMonth extends MonthPoint {
  joined: number;
  dormant: number;
  active: number;
}

export interface RevenueMonth extends MonthPoint {
  susuCommission: number;
  savingsFees: number;
  loanInterest: number;
  salesMargin: number;
}

export interface ReportsData {
  period: ReportPeriod;
  from: string;
  to: string;
  generatedAt: string;
  kpis: {
    depositsMobilised: number;
    depositsDelta: number;
    withdrawalsPaid: number;
    loansDisbursed: number;
    loansCount: number;
    /** Portfolio at risk > 30 days, as a fraction of the open book. */
    par30: number;
    par30Delta: number;
    revenue: number;
    revenueDelta: number;
    handoverVariance: number;
    handoverDays: number;
  };
  flow: FlowMonth[];
  susu: {
    accounts: number;
    valueHeld: number;
    collectedPerDay: number[]; // Mon..Sat, pesewas
    cycles: SusuCycleStage[];
    payoutsDue: { count: number; amount: number };
    months: BookMonth[];
  };
  savings: {
    accounts: number;
    balance: number;
    months: BookMonth[];
    /** Closing balance per month. */
    balances: number[];
  };
  loans: {
    open: number;
    outstanding: number;
    months: BookMonth[];
    parTrend: number[];
    aging: AgingBucket[];
    overdue: OverdueLoan[];
  };
  hp: {
    contracts: number;
    outstanding: number;
    statuses: HpStatus[];
  };
  sales: {
    receipts: number;
    total: number;
    voided: number;
    categories: CategorySales[];
  };
  staff: StaffRow[];
  handover: { days: string[]; rows: HandoverRow[] };
  customers: {
    total: number;
    months: CustomerMonth[];
    byProduct: { label: string; count: number }[];
  };
  revenue: RevenueMonth[];
}

/* --------------------------------------------------------------- generate --- */

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

const FIRST_NAMES = [
  "Ama",
  "Kofi",
  "Abena",
  "Yaw",
  "Esi",
  "Kwame",
  "Adwoa",
  "Kojo",
  "Akua",
  "Kwabena",
  "Efua",
  "Nana",
];
const LAST_NAMES = [
  "Mensah",
  "Owusu",
  "Boateng",
  "Asante",
  "Darko",
  "Osei",
  "Appiah",
  "Agyemang",
  "Ofori",
  "Acheampong",
  "Baah",
  "Frimpong",
];

function monthsBack(to: string, count: number): MonthPoint[] {
  const [y, m] = to.split("-").map(Number);
  const out: MonthPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const idx = m - 1 - i;
    const year = y + Math.floor(idx / 12);
    const month = ((idx % 12) + 12) % 12;
    out.push({
      key: `${year}-${String(month + 1).padStart(2, "0")}`,
      label: MONTHS[month],
      partial: i === 0,
    });
  }
  return out;
}

function daysBack(to: string, count: number): string[] {
  const end = Date.parse(`${to}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) =>
    new Date(end - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

/** How far through the running month we are, as a fraction of it. */
function monthFraction(to: string): number {
  return Math.max(0.1, Number(to.slice(8, 10)) / 30);
}

export function buildReportsData(
  period: ReportPeriod,
  to: string,
  generatedAt: string,
): ReportsData {
  const r = rng(20260827);
  const { months: monthCount, days: dayCount } = REPORT_PERIODS[period];
  const months = monthsBack(to, Math.max(monthCount, 6)).slice(
    -Math.max(monthCount, 3),
  );
  const frac = monthFraction(to);
  const scale = (p: MonthPoint) => (p.partial ? frac : 1);

  // A gentle upward drift so every series reads as a business growing.
  const drift = (i: number, n: number) =>
    0.82 + (0.36 * i) / Math.max(1, n - 1);

  const flow: FlowMonth[] = months.map((p, i) => {
    const d = drift(i, months.length) * scale(p);
    return {
      ...p,
      susu: Math.round(cedis(r, 38_000, 52_000) * d),
      savings: Math.round(cedis(r, 22_000, 31_000) * d),
      loans: Math.round(cedis(r, 14_000, 21_000) * d),
      hp: Math.round(cedis(r, 6_000, 9_500) * d),
      sales: Math.round(cedis(r, 9_000, 14_000) * d),
    };
  });

  const susuMonths: BookMonth[] = months.map((p, i) => {
    const d = drift(i, months.length) * scale(p);
    return {
      ...p,
      inflow: Math.round(cedis(r, 38_000, 52_000) * d),
      outflow: Math.round(cedis(r, 24_000, 41_000) * d),
    };
  });
  const savingsMonths: BookMonth[] = months.map((p, i) => {
    const d = drift(i, months.length) * scale(p);
    return {
      ...p,
      inflow: Math.round(cedis(r, 22_000, 31_000) * d),
      outflow: Math.round(cedis(r, 12_000, 22_000) * d),
    };
  });
  let running = cedis(r, 210_000, 240_000);
  const balances = savingsMonths.map((m) => (running += m.inflow - m.outflow));

  const loanMonths: BookMonth[] = months.map((p, i) => {
    const d = drift(i, months.length) * scale(p);
    return {
      ...p,
      inflow: Math.round(cedis(r, 14_000, 21_000) * d), // repayments
      outflow: Math.round(cedis(r, 16_000, 26_000) * d), // disbursed
    };
  });
  const parTrend = months.map(
    (_, i) => 0.115 - i * 0.006 + (r() - 0.5) * 0.012,
  );

  const staffNames = Array.from({ length: 8 }, (_, i) => ({
    id: `s${i + 1}`,
    name: `${FIRST_NAMES[(i * 5) % FIRST_NAMES.length]} ${LAST_NAMES[(i * 7) % LAST_NAMES.length]}`,
  }));

  const staff: StaffRow[] = staffNames.map((s, i) => {
    const collector = i < 6;
    const daysWorked = Math.min(
      dayCount,
      Math.round(dayCount * (0.78 + r() * 0.2)),
    );
    const recorded = Math.round(
      cedis(r, collector ? 9_000 : 4_000, collector ? 26_000 : 9_000) *
        (dayCount / 30),
    );
    const shortfall = r() < 0.75 ? r() * 0.012 : r() * 0.045;
    return {
      id: s.id,
      name: s.name,
      role: collector ? "collector" : "teller",
      recorded,
      confirmed: Math.round(
        recorded * (1 - shortfall + (r() < 0.2 ? 0.006 : 0)),
      ),
      customers: 40 + Math.round(r() * 130),
      daysReconciled: Math.round(daysWorked * (0.7 + r() * 0.3)),
      daysWorked,
    };
  });

  const handoverDays = daysBack(to, 14);
  const handover: HandoverRow[] = staff
    .filter((s) => s.role === "collector")
    .map((s) => ({
      staffId: s.id,
      name: s.name,
      cells: handoverDays.map((day) => {
        const sunday = new Date(`${day}T12:00:00Z`).getUTCDay() === 0;
        if (sunday || r() < 0.06) return { day, variance: null };
        const roll = r();
        const variance =
          roll < 0.62
            ? 0
            : roll < 0.88
              ? -cedis(r, 5, 180)
              : roll < 0.96
                ? cedis(r, 5, 60)
                : -cedis(r, 200, 900);
        return { day, variance };
      }),
    }));

  const aging: AgingBucket[] = [
    {
      key: "1-30",
      label: "1–30 days",
      count: 23,
      amount: cedis(r, 14_000, 19_000),
    },
    {
      key: "31-60",
      label: "31–60 days",
      count: 11,
      amount: cedis(r, 9_000, 13_000),
    },
    {
      key: "61-90",
      label: "61–90 days",
      count: 6,
      amount: cedis(r, 5_000, 8_000),
    },
    {
      key: "90+",
      label: "90+ days",
      count: 4,
      amount: cedis(r, 6_000, 11_000),
    },
  ];

  const overdue: OverdueLoan[] = Array.from({ length: 6 }, (_, i) => {
    const principal = cedis(r, 1_500, 9_000);
    return {
      id: `L-${2041 + i * 17}`,
      customer: `${FIRST_NAMES[(i * 3 + 1) % 12]} ${LAST_NAMES[(i * 5 + 2) % 12]}`,
      principal,
      remaining: Math.round(principal * (0.25 + r() * 0.6)),
      daysOverdue: [134, 97, 71, 44, 38, 12][i],
      collector: staffNames[i % 6].name,
    };
  });

  const revenue: RevenueMonth[] = months.map((p, i) => {
    const d = drift(i, months.length) * scale(p);
    return {
      ...p,
      susuCommission: Math.round(cedis(r, 1_400, 1_900) * d),
      savingsFees: Math.round(cedis(r, 380, 560) * d),
      loanInterest: Math.round(cedis(r, 1_900, 2_700) * d),
      salesMargin: Math.round(cedis(r, 900, 1_500) * d),
    };
  });

  const customerMonths: CustomerMonth[] = months.map((p, i) => ({
    ...p,
    joined: Math.round((18 + r() * 22) * scale(p)),
    dormant: Math.round((3 + r() * 7) * scale(p)),
    active: 1_120 + i * 24 + Math.round(r() * 12),
  }));

  const sum = <T>(rows: T[], pick: (row: T) => number) =>
    rows.reduce((n, row) => n + pick(row), 0);
  const last = <T>(rows: T[]) => rows[rows.length - 1];
  const prev = <T>(rows: T[]) => rows[Math.max(0, rows.length - 2)];
  const delta = (now: number, before: number) =>
    before > 0 ? (now - before) / before : 0;

  const depositsMobilised =
    sum(susuMonths, (m) => m.inflow) + sum(savingsMonths, (m) => m.inflow);
  const withdrawalsPaid =
    sum(susuMonths, (m) => m.outflow) + sum(savingsMonths, (m) => m.outflow);
  const revenueTotal = sum(
    revenue,
    (m) => m.susuCommission + m.savingsFees + m.loanInterest + m.salesMargin,
  );
  const revLast = last(revenue);
  const revPrev = prev(revenue);
  const revOf = (m: RevenueMonth) =>
    m.susuCommission + m.savingsFees + m.loanInterest + m.salesMargin;

  return {
    period,
    from: daysBack(to, dayCount)[0],
    to,
    generatedAt,
    kpis: {
      depositsMobilised,
      depositsDelta: delta(
        last(susuMonths).inflow + last(savingsMonths).inflow,
        (prev(susuMonths).inflow + prev(savingsMonths).inflow) * frac,
      ),
      withdrawalsPaid,
      loansDisbursed: sum(loanMonths, (m) => m.outflow),
      loansCount: Math.round(sum(loanMonths, (m) => m.outflow) / 480_000),
      par30: (aging[1].amount + aging[2].amount + aging[3].amount) / 41_250_000,
      par30Delta: last(parTrend) - prev(parTrend),
      revenue: revenueTotal,
      revenueDelta: delta(revOf(revLast), revOf(revPrev) * frac),
      handoverVariance: sum(staff, (s) => s.confirmed - s.recorded),
      handoverDays: sum(staff, (s) => s.daysReconciled),
    },
    flow,
    susu: {
      accounts: 684,
      valueHeld: 18_640_000 + Math.round(r() * 800_000),
      collectedPerDay: [0.92, 1, 0.88, 0.95, 1.08, 0.61].map((k) =>
        Math.round(cedis(r, 1_700, 1_900) * k),
      ),
      cycles: [
        { label: "Days 1–10", count: 214 },
        { label: "Days 11–20", count: 198 },
        { label: "Days 21–30", count: 176 },
        { label: "Complete, awaiting payout", count: 61 },
        { label: "Paid out this period", count: 35 },
      ],
      payoutsDue: { count: 61, amount: 4_120_000 + Math.round(r() * 300_000) },
      months: susuMonths,
    },
    savings: {
      accounts: 412,
      balance: last(balances),
      months: savingsMonths,
      balances,
    },
    loans: {
      open: 137,
      outstanding: 41_250_000,
      months: loanMonths,
      parTrend,
      aging,
      overdue,
    },
    hp: {
      contracts: 58,
      outstanding: 9_780_000 + Math.round(r() * 400_000),
      statuses: [
        { label: "Paying on time", count: 39, amount: 6_240_000 },
        { label: "Behind", count: 12, amount: 2_460_000 },
        { label: "Defaulted", count: 3, amount: 780_000 },
        { label: "Settled this period", count: 4, amount: 0 },
      ],
    },
    sales: {
      receipts: 1_284,
      total: sum(flow, (m) => m.sales),
      voided: 17,
      categories: [
        {
          category: "Phones & tablets",
          outright: cedis(r, 12_000, 16_000),
          hp: cedis(r, 9_000, 13_000),
          units: 96,
        },
        {
          category: "Home appliances",
          outright: cedis(r, 7_000, 10_000),
          hp: cedis(r, 11_000, 15_000),
          units: 61,
        },
        {
          category: "Furniture",
          outright: cedis(r, 2_500, 4_500),
          hp: cedis(r, 6_000, 8_500),
          units: 24,
        },
        {
          category: "Solar & power",
          outright: cedis(r, 3_000, 5_000),
          hp: cedis(r, 4_000, 6_000),
          units: 33,
        },
        {
          category: "Accessories",
          outright: cedis(r, 5_000, 7_500),
          hp: 0,
          units: 412,
        },
      ],
    },
    staff,
    handover: { days: handoverDays, rows: handover },
    customers: {
      total: last(customerMonths).active,
      months: customerMonths,
      byProduct: [
        { label: "Susu only", count: 486 },
        { label: "Savings only", count: 214 },
        { label: "Susu + savings", count: 198 },
        { label: "With a loan", count: 137 },
        { label: "Hire purchase", count: 58 },
      ],
    },
    revenue,
  };
}
