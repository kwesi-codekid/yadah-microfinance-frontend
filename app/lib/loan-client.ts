/**
 * Client-safe loan types, mirroring the API's `components.schemas`, plus the
 * arithmetic the screens need. Safe to import from browser components — the same
 * split as [susu-client.ts](app/lib/susu-client.ts) and
 * [savings-client.ts](app/lib/savings-client.ts), which own the other products.
 *
 * The domain in one paragraph: a customer applies for a loan of a fixed
 * principal over 3, 6 or 12 months. **A human approves it** — the API says so
 * outright ("No auto-approval exists"), and `GET /loans/eligibility/{customerId}`
 * exists only to put four months of susu/savings history in front of that human.
 * Approval locks the rate and the interest from the config as it stands *at that
 * moment* and generates a monthly schedule. Interest is **flat** — a percentage
 * of the principal, not amortised — so `totalDue` is `principal + interest` and
 * nothing about it moves as the loan is repaid. Repayments are allocated to
 * instalments oldest-first, and settling exactly flips the loan to `repaid`.
 *
 * Two things make this product unlike the other two:
 *
 * - **Escalation.** A loan that falls behind moves *up* the rate ladder
 *   (10 → 20 → 30) and `totalDue` grows with it, on the original principal.
 *   `escalatedAt` stamps the last move and `frozen` says the ladder is
 *   exhausted. So `ratePercent` is the *current* rate, not the agreed one.
 * - **One open loan per customer.** A second application is always refused with
 *   409 `LOAN_EXISTS`, which is why the eligibility summary carries `openLoan`.
 *
 * Every amount here is integer pesewas. See [money.ts](app/lib/money.ts).
 *
 * Source of truth: GET https://yadah-backend-staging.adamusgh.com/api/v1/openapi.json
 */

import type { PaymentChannel } from "~/lib/channel";
import { formatGhs } from "~/lib/money";

/* ------------------------------------------------------------------ *
 * The shape of the product
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * Config
 *
 * `GET /loans/config` declares its response as a bare `config: {}` — the spec
 * gives the object no properties at all, so the field names below are taken
 * from the *request* body of `PUT /loans/config`, which is fully specified and
 * must describe the same object for the round trip to work.
 *
 * That inference is why `normalizeLoanConfig` exists rather than a cast: the
 * six numbers drive the application form's bounds and the interest it projects,
 * and a missing one would otherwise render as `NaN` on screen. Anything absent
 * or non-numeric falls back to the documented default, and `complete` says
 * whether the fallbacks were needed — so a screen can admit it is showing
 * defaults instead of quietly asserting them.
 * ------------------------------------------------------------------ */

/**
 * Defaults from the API's own `Loans` tag description: "Small 1k–20k / big to
 * 50k GHS · flat 10/20/30% by duration". In pesewas and whole percents.
 */
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

/**
 * Read whatever `GET /loans/config` returned into a `LoanConfig`, filling gaps
 * from the documented defaults.
 *
 * `complete` is false when anything had to be filled in. Callers that put a
 * bound or a rate in front of a user should say so — an application form
 * validating against a guessed ceiling will refuse a principal the API would
 * have taken, or take one it will refuse.
 */
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

/**
 * Which tier a principal falls in.
 *
 * The boundary is `smallMaxPesewas` inclusive — the tag reads "small 1,000–20,000,
 * big to 50,000", so 20,000 is the last small loan and anything above it is big.
 * Nothing here checks whether the customer is *allowed* the big tier; that is
 * `bigTierUnlocked` on the eligibility summary, and only the API can say.
 */
export function tierFor(config: LoanConfig, principal: number): LoanTier {
  return principal > config.smallMaxPesewas ? "big" : "small";
}

/* ------------------------------------------------------------------ *
 * Schemas
 * ------------------------------------------------------------------ */

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
  /**
   * The **current** rate, not the agreed one: it moves up the ladder each time
   * the loan escalates. Compare against `rateFor(config, durationMonths)` to
   * see whether it has moved — but only for a loan approved under the config
   * as it stands now, since approval locks whatever was current that day.
   */
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

/**
 * One row of the repayment schedule, generated at approval.
 *
 * `status` is declared as a bare `string` by the spec rather than an enum, so it
 * is carried as one and labelled defensively — see `scheduleStatusLabel`.
 */
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

/**
 * `GET /loans/eligibility/{customerId}` — the history summary the approving
 * human reads. It decides nothing: every field here is evidence, and the API is
 * explicit that the decision is a person's.
 */
export interface LoanEligibility {
  customer: {
    id: string;
    fullName: string;
    /**
     * Whether the profile carries a Ghana Card. An application without one is
     * refused with 422 `GHANA_CARD_REQUIRED`, so this is a hard gate rather
     * than a factor to weigh.
     */
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

/* ------------------------------------------------------------------ *
 * Arithmetic
 *
 * Derived, never stored. The API owns every figure on a loan that exists; these
 * are for the one that doesn't yet — the application being typed.
 * ------------------------------------------------------------------ */

/**
 * Flat interest on a principal: `principal × rate ÷ 100`, rounded to the
 * pesewa.
 *
 * A **projection**, and only ever that. The rate is locked from the config at
 * *approval*, not at application, so a pending loan approved after a config
 * change carries a rate this never saw. Any screen showing it should say the
 * figure is indicative.
 */
export function projectInterest(principal: number, ratePercent: number): number {
  return Math.round((principal * ratePercent) / 100);
}

/** `principal + interest` at the given rate. Same caveat as `projectInterest`. */
export function projectTotalDue(principal: number, ratePercent: number): number {
  return principal + projectInterest(principal, ratePercent);
}

/**
 * What one instalment comes to, and what the last one comes to.
 *
 * The API folds the rounding remainder into the final instalment — its words:
 * "generates the monthly schedule (remainder folds into the last instalment)".
 * Mirroring that here rather than dividing evenly means the schedule this app
 * projects for an application adds up to the same total the API will generate.
 */
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

/**
 * The amount that settles the loan exactly.
 *
 * Worth its own name because it is the one repayment with a side effect: paying
 * exactly this flips the status to `repaid` and stamps `repaidOnTime`, which is
 * what unlocks the big tier for this customer's next application. Anything more
 * is refused outright — there is no overpayment.
 */
export function settlementAmount(loan: Loan): number {
  return Math.max(0, loan.remaining);
}

/**
 * The schedule row's `status`, made presentable.
 *
 * The spec types it as an open string, so the known values are mapped and
 * anything else is title-cased rather than dropped — a status this app has
 * never seen is still more use on screen than a blank cell.
 */
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

/* ------------------------------------------------------------------ *
 * Error details
 *
 * The loan failures that carry the number needed to fix them.
 * ------------------------------------------------------------------ */

/**
 * `422 EXCEEDS_BALANCE` — the exact amount still owed.
 *
 * There is no overpayment on a loan: the API refuses anything above the
 * remaining balance rather than taking it and refunding. Reading the figure
 * back turns the refusal into a prefilled correction.
 */
export function readExceedsBalance(details: unknown): number | null {
  if (details && typeof details === "object" && "remaining" in details) {
    const remaining = (details as { remaining?: unknown }).remaining;
    if (typeof remaining === "number") return remaining;
  }
  return null;
}

/**
 * The 422s that mean "this customer can't have this loan", each needing a
 * different sentence rather than the API's terser phrasing.
 */
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
