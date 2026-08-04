import {
  isPaymentChannel,
  PAYMENT_CHANNEL_LABELS,
  PAYMENT_CHANNELS,
  type PaymentChannel,
} from "~/lib/channel";

/** The API declares this as a `const 31`, not a configurable field. */
export const SUSU_CYCLE_TARGET = 31;

export const SUSU_MIN_DAILY_AMOUNT = 500;

export type SusuAccountStatus =
  | "active"
  | "completed"
  /** Stopped with value still owed to the customer — see `payoutRemaining`. */
  | "pending-payout"
  | "closed";

export const SUSU_ACCOUNT_STATUSES: SusuAccountStatus[] = [
  "active",
  "completed",
  "pending-payout",
  "closed",
];

export const SUSU_ACCOUNT_STATUS_LABELS: Record<SusuAccountStatus, string> = {
  active: "Active",
  completed: "Completed",
  "pending-payout": "Awaiting payout",
  closed: "Closed",
};

export type DepositChannel = PaymentChannel;
export const DEPOSIT_CHANNELS = PAYMENT_CHANNELS;
export const DEPOSIT_CHANNEL_LABELS = PAYMENT_CHANNEL_LABELS;

/** The `SusuAccount` schema. */
export interface SusuAccount {
  id: string;
  accountNumber: string;
  customerId: string;
  /** Joined by the API on list responses, the way `Loan` does it. */
  customerName?: string;
  /** Pesewas. Immutable for the life of the cycle. */
  dailyAmount: number;
  depositsCount: number;
  /** Always 31. Carried from the API rather than assumed, in case it opens up. */
  cycleTarget: number;
  totalDeposited: number;
  status: SusuAccountStatus;
  /** Set at closure: one day's deposit. */
  commissionAmount?: number;
  /** Set at closure: total − commission. */
  payoutAmount?: number;
  /**
   * Value the customer is still owed and hasn't taken — the excess left after a
   * susu-funded loan or HP payment, drawn down by `POST .../payout`. Zero on an
   * ordinary account; when it reaches zero the account closes.
   */
  payoutRemaining: number;
  openedAt: string;
  closedAt?: string;
}

/** The `SusuDeposit` schema. One row of a statement. */
export interface SusuDeposit {
  id: string;
  accountId: string;
  customerId: string;
  /** Who recorded it — a collector or office staff. */
  collectorId: string;
  amount: number;
  daysCovered: number;
  /** 1-based position in the 31-deposit cycle. A catch-up spans seqStart..seqEnd. */
  seqStart: number;
  seqEnd: number;
  channel: DepositChannel;
  /** Present when the deposit was part of a `collect-all` batch. */
  collectAllBatchId?: string;
  createdAt: string;
}

/** One line of `GET /susu/summary` — already joined to the customer name. */
export interface SusuSummaryLine {
  depositId: string;
  accountId: string;
  customerId: string;
  customerName: string;
  collectorId: string;
  amount: number;
  daysCovered: number;
  at: string;
}

export interface SusuSummary {
  /** The Accra calendar day these deposits were recorded on. */
  date: string;
  /** Null when an office role asked for everyone rather than one collector. */
  collectorId: string | null;
  depositCount: number;
  totalCollected: number;
  deposits: SusuSummaryLine[];
}

/** The result of `POST /susu/accounts/{id}/close`. */
export interface SusuCloseResult {
  account: SusuAccount;
  commission: number;
  payout: number;
  /** True when deposits did not cover the commission — needs a human look. */
  flagged: boolean;
}

/** The result of one `collect-all` — every deposit it made, in one batch. */
export interface CollectAllResult {
  batchId: string;
  totalAmount: number;
  deposits: SusuDeposit[];
  accounts: SusuAccount[];
  /** True when the API replayed an earlier identical request. */
  replayed: boolean;
}

/** The result of recording a single deposit. */
export interface RecordDepositResult {
  deposit: SusuDeposit;
  account: SusuAccount;
  /** True when the API replayed an earlier identical request. */
  replayed: boolean;
}

export function isSusuAccountStatus(v: unknown): v is SusuAccountStatus {
  return (
    typeof v === "string" && (SUSU_ACCOUNT_STATUSES as string[]).includes(v)
  );
}

export const isDepositChannel = isPaymentChannel;

/** Deposits still owed on the cycle. Never negative. */
export function remainingDeposits(account: SusuAccount): number {
  return Math.max(0, account.cycleTarget - account.depositsCount);
}

/** 0–100, rounded. For a progress bar; use `depositsCount` for anything counted. */
export function cyclePercent(account: SusuAccount): number {
  if (account.cycleTarget <= 0) return 0;
  return Math.round((account.depositsCount / account.cycleTarget) * 100);
}

export function projectedPayout(account: SusuAccount): number {
  return Math.max(0, account.totalDeposited - account.dailyAmount);
}

export { newIdempotencyKey } from "~/lib/idempotency";

/** What one round of `collect-all` takes: a day's deposit on every open cycle. */
export function collectAllTotal(accounts: SusuAccount[]): number {
  return accounts
    .filter((account) => account.status === "active")
    .reduce((sum, account) => sum + account.dailyAmount, 0);
}

/** `422 AMOUNT_MISMATCH` — the total the API expected, so the field can re-seed. */
export function readRequiredAmount(details: unknown): number | null {
  if (details && typeof details === "object" && "required" in details) {
    const required = (details as { required?: unknown }).required;
    if (typeof required === "number") return required;
  }
  return null;
}

/** `422 EXCEEDS_REMAINING` — how many days are actually left on the cycle. */
export function readExceedsRemaining(details: unknown): number | null {
  if (details && typeof details === "object" && "remaining" in details) {
    const remaining = (details as { remaining?: unknown }).remaining;
    if (typeof remaining === "number") return remaining;
  }
  return null;
}

