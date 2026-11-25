/**
 * The Reports page's data, as `GET /reports/overview` sends it: one block per
 * tab, every figure read from the books. Money is integer pesewas, as
 * everywhere else in the app. Client-safe: the fetch lives in `~/api/reports`.
 */

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
