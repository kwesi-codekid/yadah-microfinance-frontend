/**
 * Loan types and display constants shared by the server and the browser.
 * Nothing here may import a `.server` module or the API client — it is bundled
 * into the client. The fetch functions live in `~/api/loans`.
 *
 * A loan is the one module in the app with no automatic decision anywhere in
 * it. The API summarises four months of a customer's susu and savings history
 * and stops; a person approves or rejects. Everything below exists to put that
 * decision in front of someone with the figures already worked out.
 *
 * Interest is flat and charged on the principal for the whole duration, so
 * `totalDue` is `principal + interestAmount` and settling early pays the same.
 * The one thing that moves is the rate: an overdue loan escalates up a ladder,
 * recomputing interest on the *original* principal, until `frozen` says the
 * ladder is spent.
 */

import type { IdType } from "~/lib/customers";

export type LoanTier = "small" | "big";

export type LoanStatus = "pending" | "active" | "repaid" | "rejected" | "arrears";

/** The three the API accepts. Each carries its own flat rate in the config. */
export const DURATIONS = [3, 6, 12] as const;
export type LoanDuration = (typeof DURATIONS)[number];

/** How a repayment reached the counter. `susu-closure` is the API's own. */
export type RepaymentSource = "cash" | "paystack" | "momo" | "susu-closure" | "transfer";

export type RepaymentChannel = "cash" | "paystack" | "momo";

/**
 * Where the excess goes when a susu closure pays off more than the loan owes.
 * The default leaves it in the susu account for the customer to collect; the
 * alternative credits their savings in the same atomic transaction.
 */
export type ExcessDestination = "pending-withdrawal" | "savings";

/**
 * Who stands behind the loan, snapshotted when the application was recorded.
 *
 * It is a snapshot rather than a live read for the same reason the item on a
 * hire-purchase agreement is: the record has to say who was accepted on the
 * day, whatever the customer's profile says a year later. Both halves absent on
 * loans recorded before guarantors were asked for.
 */
export interface LoanGuarantor {
  fullName: string;
  phone: string;
  idType?: IdType;
  idNumber?: string;
}

export interface Loan {
  id: string;
  customerId: string;
  /** Present on list responses, for display. */
  customerName?: string;
  tier: LoanTier;
  /** Pesewas. Immutable — escalation recomputes interest on this figure. */
  principal: number;
  durationMonths: number;
  /** The rate in force now. Moves up the ladder each time the loan escalates. */
  ratePercent: number;
  interestAmount: number;
  /** `principal + interestAmount`, at the current rate. */
  totalDue: number;
  totalRepaid: number;
  remaining: number;
  status: LoanStatus;
  /** True once the escalation ladder is exhausted — the rate can rise no further. */
  frozen: boolean;
  appliedAt: string;
  approvedAt?: string;
  disbursedAt?: string;
  /** When the last instalment falls due. Absent until approval. */
  dueDate?: string;
  /** The last time the rate moved up. Absent while the loan is on time. */
  escalatedAt?: string;
  closedAt?: string;
  /** Stamped at settlement. This is what unlocks the big tier. */
  repaidOnTime?: boolean;
  rejectionReason?: string;
  /** A picture of the customer's signature on the application. */
  signatureUrl?: string;
  /** The customer standing behind it. Absent on loans that predate the rule. */
  guarantorId?: string;
  guarantor?: LoanGuarantor;
}

/** A loan in the trash. `deletedAt` is what separates it from a live one. */
export interface TrashedLoan extends Loan {
  deletedAt: string;
  deletedById?: string;
  deleteReason?: string;
}

/** One monthly instalment. Generated at approval; the remainder folds into the last. */
export interface Installment {
  installmentNumber: number;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  /** `pending` · `partial` · `paid` · `overdue` — the API's own vocabulary. */
  status: string;
}

export interface Repayment {
  id: string;
  amount: number;
  source: string;
  /** How the cash arrived. Absent on rows the API wrote before it was kept. */
  channel?: string;
  /** Set when the repayment came from closing a susu account. */
  susuAccountId?: string;
  recordedById?: string;
  createdAt?: string;
}

/** What a susu-closure repayment did on the susu side, so both halves show. */
export interface SusuClosureResult {
  accountId: string;
  commission: number;
  payout: number;
}

/**
 * `GET /loans/config`. The spec types this as an opaque object, so every field
 * is optional and every screen falls back to the documented defaults rather
 * than rendering a blank. Treat what comes back as advisory until the shape is
 * confirmed against staging.
 */
export interface LoanConfig {
  ratePercent3?: number;
  ratePercent6?: number;
  ratePercent12?: number;
  smallMinPesewas?: number;
  smallMaxPesewas?: number;
  bigMaxPesewas?: number;
}

/** What the API says about a customer, for the person making the decision. */
export interface LoanEligibility {
  customer: {
    id: string;
    fullName: string;
    /**
     * Informational only. Every ID type is accepted — the Ghana Card is not
     * required, and a loan is never refused for its absence.
     */
    hasGhanaCard: boolean;
    /** An ID type and number are recorded. Refused with `ID_REQUIRED` without. */
    hasId?: boolean;
    /** Both sides of the ID document uploaded. Refused with `ID_DOCUMENT_REQUIRED` without. */
    hasIdDocument: boolean;
  };
  /** Null when they have never paid anything in. */
  firstActivityAt: string | null;
  monthsOfHistory: number;
  susu: { accounts: number; activeAccounts: number; totalDeposited: number };
  savings: { accounts: number; totalBalance: number };
  /** The loan already on their name, if any. One open loan is the limit. */
  openLoan: Loan | null;
  bigTierUnlocked: boolean;
}

/* ---------------------------------------------------------------- defaults --- */

/**
 * The figures in the API documentation, used until `GET /loans/config` answers.
 * They are a fallback for rendering, never a rule — the API is the authority on
 * what it will accept, and it says so with `PRINCIPAL_OUT_OF_RANGE`.
 */
export const DEFAULT_CONFIG: Required<LoanConfig> = {
  ratePercent3: 10,
  ratePercent6: 20,
  ratePercent12: 30,
  smallMinPesewas: 100_000,
  smallMaxPesewas: 2_000_000,
  bigMaxPesewas: 5_000_000,
};

/** The config with every gap filled, so screens can read fields without care. */
export function withDefaults(config: LoanConfig | null | undefined): Required<LoanConfig> {
  return { ...DEFAULT_CONFIG, ...clean(config) };
}

function clean(config: LoanConfig | null | undefined): LoanConfig {
  if (!config || typeof config !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** The flat rate a duration carries, from the config in force. */
export function rateFor(config: Required<LoanConfig>, months: number): number {
  if (months === 3) return config.ratePercent3;
  if (months === 6) return config.ratePercent6;
  return config.ratePercent12;
}

/** What a principal costs over a duration, at a flat rate. */
export function interestOn(principal: number, ratePercent: number): number {
  return Math.round((principal * ratePercent) / 100);
}

/** The tier a principal falls in, or null when it is outside both. */
export function tierFor(
  config: Required<LoanConfig>,
  pesewas: number,
): LoanTier | null {
  if (pesewas < config.smallMinPesewas) return null;
  if (pesewas <= config.smallMaxPesewas) return "small";
  if (pesewas <= config.bigMaxPesewas) return "big";
  return null;
}

/* ------------------------------------------------------------------ labels --- */

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  pending: "Pending",
  active: "Active",
  arrears: "In arrears",
  repaid: "Repaid",
  rejected: "Rejected",
};

/**
 * What each state means at the desk, in one line. These are the states someone
 * has to act on, so each says what is owed of them, not what the record is.
 */
export const LOAN_STATUS_BLURBS: Record<LoanStatus, string> = {
  pending: "Waiting on a decision. Nothing has been disbursed.",
  active: "Disbursed and repaying to schedule.",
  arrears: "Past due. The rate escalates until it is brought current.",
  repaid: "Settled in full.",
  rejected: "Turned down. No money moved.",
};

export const LOAN_STATUS_TONE: Record<
  LoanStatus,
  "success" | "info" | "warning" | "danger" | "muted"
> = {
  pending: "info",
  active: "success",
  arrears: "danger",
  repaid: "muted",
  rejected: "muted",
};

export const TIER_LABELS: Record<LoanTier, string> = {
  small: "Small",
  big: "Big",
};

export const DURATION_LABELS: Record<number, string> = {
  3: "3 months",
  6: "6 months",
  12: "12 months",
};

/** How a repayment arrived, for the history table. */
export const SOURCE_LABELS: Record<string, string> = {
  cash: "Cash",
  momo: "MoMo",
  paystack: "Paystack",
  "susu-closure": "Susu closure",
  transfer: "Transfer",
};

export const CHANNEL_OPTIONS: { value: RepaymentChannel; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "momo", label: "MoMo" },
  { value: "paystack", label: "Paystack" },
];

/** The instalment states the schedule uses, and how each one is drawn. */
export const INSTALLMENT_TONE: Record<string, "success" | "warning" | "danger" | "muted"> =
  {
    paid: "success",
    partial: "warning",
    overdue: "danger",
    pending: "muted",
  };

export const INSTALLMENT_LABELS: Record<string, string> = {
  paid: "Paid",
  partial: "Part paid",
  overdue: "Overdue",
  pending: "Due",
};

/* ------------------------------------------------------------------- rules --- */

/** True while the loan can still take a repayment. */
export function isOpen(loan: Pick<Loan, "status">): boolean {
  return loan.status === "active" || loan.status === "arrears";
}

/** True while the application can still be approved or rejected. */
export function isPending(loan: Pick<Loan, "status">): boolean {
  return loan.status === "pending";
}

/**
 * Only a pending or rejected application may be trashed. Once money has been
 * disbursed the loan is ledger history, and history does not leave the books.
 */
export function canTrash(loan: Pick<Loan, "status">): boolean {
  return loan.status === "pending" || loan.status === "rejected";
}

/** How much of the total has been paid off, 0–1. */
export function repaymentProgress(loan: Pick<Loan, "totalDue" | "totalRepaid">): number {
  if (loan.totalDue <= 0) return 0;
  return Math.max(0, Math.min(1, loan.totalRepaid / loan.totalDue));
}

/**
 * The API refuses an overpayment and answers with the exact remaining balance,
 * so this refuses the same thing first. Returns the fault, or null.
 */
export function checkRepaymentAmount(
  loan: Pick<Loan, "remaining">,
  pesewas: number | null,
): string | null {
  if (pesewas == null || !Number.isFinite(pesewas) || pesewas <= 0) {
    return "Enter the cash received.";
  }
  if (pesewas > loan.remaining) {
    return "More than this loan still owes.";
  }
  return null;
}

/**
 * The API's range check, run before the round trip. It answers
 * `PRINCIPAL_OUT_OF_RANGE` for anything outside the tiers, and
 * `BIG_TIER_LOCKED` for a big principal without a small loan repaid on time
 * behind it — both are worth catching in the form.
 */
export function checkPrincipal(
  config: Required<LoanConfig>,
  pesewas: number | null,
  bigTierUnlocked: boolean,
): string | null {
  if (pesewas == null || !Number.isFinite(pesewas) || pesewas <= 0) {
    return "Enter how much they are asking for.";
  }
  const tier = tierFor(config, pesewas);
  if (tier === null) {
    return pesewas < config.smallMinPesewas
      ? "Below the smallest loan the branch writes."
      : "Above the largest loan the branch writes.";
  }
  if (tier === "big" && !bigTierUnlocked) {
    return "The big tier opens once a small loan has been repaid on time.";
  }
  return null;
}

/**
 * Whole days past the due date, or null while the loan is not late. Counted in
 * Accra days like every other boundary in the app — see `~/lib/format`.
 */
export function daysOverdue(dueDay: string | null, today: string): number | null {
  if (!dueDay) return null;
  const days =
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDay}T00:00:00Z`)) /
    86_400_000;
  return days > 0 ? Math.round(days) : null;
}

/** The aging bucket a number of days overdue falls in, matching the report. */
export function agingBucket(days: number): "1-30" | "31-90" | "90+" {
  if (days <= 30) return "1-30";
  if (days <= 90) return "31-90";
  return "90+";
}

export const AGING_LABELS: Record<string, string> = {
  "1-30": "1–30 days",
  "31-90": "31–90 days",
  "90+": "Over 90 days",
};

/**
 * Whether the rate on this loan has moved since it was approved. The API sends
 * the current rate and the moment it last escalated, but not what the rate
 * started at — the config in force for the duration is the closest thing, and
 * both figures belong on the detail page together.
 */
export function hasEscalated(loan: Pick<Loan, "escalatedAt">): boolean {
  return Boolean(loan.escalatedAt);
}

/* -------------------------------------------------------------- guarantors --- */

/**
 * What stops this customer standing behind the loan, or null.
 *
 * The rule is the API's: a guarantor is a customer of the branch who has an ID
 * recorded and a photograph of both sides of it on file, and nobody guarantees
 * their own borrowing. Any ID type will do — the Ghana Card carries no special
 * standing here.
 *
 * Only an explicit `false` disqualifies. A search response that does not carry
 * the flags must not disqualify everybody; the API checks again on submit and
 * refuses with `GUARANTOR_ID_INCOMPLETE` if it comes to that.
 */
export function guarantorIssue(
  borrowerId: string | null,
  guarantor: { id: string; hasIdNumber?: boolean; hasIdDocument?: boolean },
): string | null {
  if (borrowerId && borrowerId === guarantor.id) {
    return "A customer cannot guarantee their own loan.";
  }
  const missing: string[] = [];
  if (guarantor.hasIdNumber === false) missing.push("an ID type and number");
  if (guarantor.hasIdDocument === false) {
    missing.push("a photo of both sides of the ID");
  }
  if (missing.length === 0) return null;
  return `Needs ${missing.join(" and ")} on their profile first.`;
}
