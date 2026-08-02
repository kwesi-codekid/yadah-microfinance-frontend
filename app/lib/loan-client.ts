import type { PaymentChannel } from "~/lib/channel";
import { formatGhs } from "~/lib/money";

/** The only three durations `POST /loans/applications` accepts. */
export const LOAN_DURATIONS = [3, 6, 12] as const;
export type LoanDuration = (typeof LOAN_DURATIONS)[number];

export function isLoanDuration(v: unknown): v is LoanDuration {
  return (LOAN_DURATIONS as readonly unknown[]).includes(Number(v));
}

export type LoanTier = "small" | "big";

export const LOAN_TIER_LABELS: Record<LoanTier, string> = {
  small: "Small",
  big: "Big",
};

export type LoanStatus =
  | "pending"
  | "active"
  | "repaid"
  | "rejected"
  | "arrears";

export const LOAN_STATUSES: LoanStatus[] = [
  "pending",
  "active",
  "repaid",
  "rejected",
  "arrears",
];

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  pending: "Pending",
  active: "Active",
  repaid: "Repaid",
  rejected: "Rejected",
  arrears: "In arrears",
};

export function isLoanStatus(v: unknown): v is LoanStatus {
  return typeof v === "string" && (LOAN_STATUSES as string[]).includes(v);
}

/** Statuses where money is still owed — the ones a repayment can be taken on. */
export function isOpenLoan(status: LoanStatus): boolean {
  return status === "active" || status === "arrears";
}

export const LOAN_CONFIG_DEFAULTS: LoanConfig = {
  ratePercent3: 10,
  ratePercent6: 20,
  ratePercent12: 30,
  smallMinPesewas: 100_000,
  smallMaxPesewas: 2_000_000,
  bigMaxPesewas: 5_000_000,
};

export interface LoanConfig {
  /** Flat percentage of the principal, charged once. Not an APR. */
  ratePercent3: number;
  ratePercent6: number;
  ratePercent12: number;
  /** The smallest loan there is. Pesewas. */
  smallMinPesewas: number;
  /** The small/big boundary: at or below is small, above is big. Pesewas. */
  smallMaxPesewas: number;
  /** The largest loan there is. Pesewas. */
  bigMaxPesewas: number;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeLoanConfig(raw: unknown): {
  config: LoanConfig;
  complete: boolean;
  /** Field names that were missing, for a diagnostic line. */
  missing: string[];
} {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const config = { ...LOAN_CONFIG_DEFAULTS };
  const missing: string[] = [];

  for (const key of Object.keys(LOAN_CONFIG_DEFAULTS) as (keyof LoanConfig)[]) {
    const value = readNumber(source, key);
    if (value === null) missing.push(key);
    else config[key] = value;
  }

  return { config, complete: missing.length === 0, missing };
}

/** The flat rate this duration carries, as a whole percent. */
export function rateFor(config: LoanConfig, months: LoanDuration): number {
  return months === 3
    ? config.ratePercent3
    : months === 6
      ? config.ratePercent6
      : config.ratePercent12;
}

export function tierFor(config: LoanConfig, principal: number): LoanTier {
  return principal > config.smallMaxPesewas ? "big" : "small";
}

/** The `Loan` schema. */
export interface Loan {
  id: string;
  customerId: string;
  /** Present on list responses only — the detail endpoint does not join it. */
  customerName?: string;
  tier: LoanTier;
  /** Pesewas, immutable. Escalation raises the interest, never this. */
  principal: number;
  durationMonths: number;
  ratePercent: number;
  interestAmount: number;
  /** `principal + interestAmount` at the current rate. Grows on escalation. */
  totalDue: number;
  totalRepaid: number;
  remaining: number;
  status: LoanStatus;
  /** True once escalation is exhausted — the rate can rise no further. */
  frozen: boolean;
  appliedAt: string;
  approvedAt?: string;
  /** Final instalment's due date. Set at approval. */
  dueDate?: string;
  /** The last time the rate moved up. Absent on a loan that never fell behind. */
  escalatedAt?: string;
  closedAt?: string;
  /** Set at settlement. True is what unlocks the big tier for this customer. */
  repaidOnTime?: boolean;
  rejectionReason?: string;
}

export interface LoanInstalment {
  /** 1-based. The last one carries the rounding remainder. */
  installmentNumber: number;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  status: string;
}

/** One recorded repayment. */
export interface LoanRepayment {
  id: string;
  amount: number;
  /** How the money arrived — cash/momo, or a susu account that was closed. */
  source: string;
  /** Set when `source` is the susu-closure path. */
  susuAccountId?: string;
  recordedById: string;
  createdAt: string;
}

/** `GET /loans/{id}` — the loan and everything hanging off it. */
export interface LoanDetail {
  loan: Loan;
  schedule: LoanInstalment[];
  repayments: LoanRepayment[];
}

export interface LoanEligibility {
  customer: {
    id: string;
    fullName: string;
    hasGhanaCard: boolean;
  };
  /** Null for a customer who has never saved anything. */
  firstActivityAt: string | null;
  monthsOfHistory: number;
  susu: { accounts: number; activeAccounts: number; totalDeposited: number };
  savings: { accounts: number; totalBalance: number };
  /** The one open loan, if there is one — a second application is refused. */
  openLoan: Loan | null;
  /** True when a previous small loan was repaid on time. */
  bigTierUnlocked: boolean;
}

/** The result of either repayment endpoint. */
export interface LoanRepaymentResult {
  repayment: { id: string; amount: number; source: string };
  loan: Loan;
  /** True when the API replayed an earlier identical request. */
  replayed: boolean;
  /** Present only on the susu-closure path: what closing the account produced. */
  susuClosure?: { accountId: string; commission: number; payout: number };
}

export function projectInterest(principal: number, ratePercent: number): number {
  return Math.round((principal * ratePercent) / 100);
}

/** `principal + interest` at the given rate. Same caveat as `projectInterest`. */
export function projectTotalDue(principal: number, ratePercent: number): number {
  return principal + projectInterest(principal, ratePercent);
}

export function projectInstalments(
  totalDue: number,
  months: number,
): { each: number; last: number } {
  if (months <= 0) return { each: 0, last: 0 };
  const each = Math.floor(totalDue / months);
  return { each, last: totalDue - each * (months - 1) };
}

/** 0–100, rounded. For a progress bar; use the figures for anything counted. */
export function repaidPercent(loan: Loan): number {
  if (loan.totalDue <= 0) return 0;
  return Math.min(100, Math.round((loan.totalRepaid / loan.totalDue) * 100));
}

export function settlementAmount(loan: Loan): number {
  return Math.max(0, loan.remaining);
}

export function scheduleStatusLabel(status: string): string {
  const known: Record<string, string> = {
    pending: "Not due",
    due: "Due",
    partial: "Part paid",
    paid: "Paid",
    overdue: "Overdue",
  };
  return (
    known[status] ??
    status.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}

/** How a repayment arrived, made presentable. Same open-string caveat. */
export function repaymentSourceLabel(source: string): string {
  const known: Record<string, string> = {
    cash: "Cash",
    momo: "Mobile money",
    paystack: "Paystack",
    "susu-closure": "Susu closure",
    susu_closure: "Susu closure",
    susuClosure: "Susu closure",
  };
  return (
    known[source] ??
    source.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}

/** Channels a cash repayment can be recorded under — the API's own default is cash. */
export type LoanRepaymentChannel = PaymentChannel;

export function readExceedsBalance(details: unknown): number | null {
  if (details && typeof details === "object" && "remaining" in details) {
    const remaining = (details as { remaining?: unknown }).remaining;
    if (typeof remaining === "number") return remaining;
  }
  return null;
}

export const LOAN_APPLICATION_ERRORS: Record<string, string> = {
  GHANA_CARD_REQUIRED:
    "This customer has no Ghana Card on their profile. A loan needs one — add it to their record first.",
  PRINCIPAL_OUT_OF_RANGE:
    "That amount is outside the range this tier allows.",
  BIG_TIER_LOCKED:
    "The big tier needs a previous small loan repaid on time. This customer hasn't got one yet.",
  CUSTOMER_INACTIVE:
    "This customer is deactivated. Reactivate them before recording an application.",
  LOAN_EXISTS:
    "This customer already has an open loan. Only one at a time — settle it first.",
};
