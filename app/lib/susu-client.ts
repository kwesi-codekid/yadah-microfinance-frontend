import {
  isPaymentChannel,
  PAYMENT_CHANNEL_LABELS,
  PAYMENT_CHANNELS,
  type PaymentChannel,
} from "~/lib/channel";
import { formatGhs } from "~/lib/money";

/** The API declares this as a `const 31`, not a configurable field. */
export const SUSU_CYCLE_TARGET = 31;

export const SUSU_MIN_DAILY_AMOUNT = 500;

export type SusuAccountStatus = "active" | "completed" | "closed";

export const SUSU_ACCOUNT_STATUSES: SusuAccountStatus[] = [
  "active",
  "completed",
  "closed",
];

export const SUSU_ACCOUNT_STATUS_LABELS: Record<SusuAccountStatus, string> = {
  active: "Active",
  completed: "Completed",
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

/** The result of `POST /susu/collect-all`. */
export interface CollectAllResult {
  batchId: string;
  totalAmount: number;
  deposits: SusuDeposit[];
  accounts: SusuAccount[];
  replayed: boolean;
}

/** The result of recording a single deposit. */
export interface RecordDepositResult {
  deposit: SusuDeposit;
  account: SusuAccount;
  /** True when the API replayed an earlier identical request. */
  replayed: boolean;
}

/** The API's `accountNumber` filter takes exactly six digits and nothing else. */
export const SUSU_ACCOUNT_NUMBER_PATTERN = /^\d{6}$/;

export function isSusuAccountNumber(v: string): boolean {
  return SUSU_ACCOUNT_NUMBER_PATTERN.test(v);
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

/** What a completed cycle is worth: the daily amount every one of the 31 days. */
export function cycleTargetAmount(account: SusuAccount): number {
  return account.dailyAmount * account.cycleTarget;
}

/** 0–100, rounded. For a progress bar; use `depositsCount` for anything counted. */
export function cyclePercent(account: SusuAccount): number {
  if (account.cycleTarget <= 0) return 0;
  return Math.round((account.depositsCount / account.cycleTarget) * 100);
}

export function projectedPayout(account: SusuAccount): number {
  return Math.max(0, account.totalDeposited - account.dailyAmount);
}

/** Accounts a deposit can actually be recorded against. */
export function activeAccounts(accounts: SusuAccount[]): SusuAccount[] {
  return accounts.filter((a) => a.status === "active");
}

export function collectAllTotal(accounts: SusuAccount[]): number {
  return activeAccounts(accounts).reduce((sum, a) => sum + a.dailyAmount, 0);
}

/** One of the 31 cells in a cycle grid. */
export interface CycleSlot {
  /** 1-based position in the cycle. */
  seq: number;
  filled: boolean;
  /** The deposit that covered this day, when filled. */
  deposit?: SusuDeposit;
  /** True when the deposit covering it spanned several days (a catch-up). */
  partOfCatchUp: boolean;
}

export function buildCycleSlots(
  account: SusuAccount,
  deposits: SusuDeposit[],
): CycleSlot[] {
  const bySeq = new Map<number, SusuDeposit>();
  for (const deposit of deposits) {
    for (let seq = deposit.seqStart; seq <= deposit.seqEnd; seq++) {
      bySeq.set(seq, deposit);
    }
  }

  return Array.from({ length: account.cycleTarget }, (_, i) => {
    const seq = i + 1;
    const deposit = bySeq.get(seq);
    return {
      seq,
      filled: deposit !== undefined,
      deposit,
      partOfCatchUp: deposit !== undefined && deposit.daysCovered > 1,
    };
  });
}

export function describeAccount(account: SusuAccount): string {
  return `${formatGhs(account.dailyAmount)} daily · ${account.depositsCount}/${account.cycleTarget}`;
}

export { newIdempotencyKey } from "~/lib/idempotency";

/** `422 EXCEEDS_REMAINING` — how many days are actually left on the cycle. */
export function readExceedsRemaining(details: unknown): number | null {
  if (details && typeof details === "object" && "remaining" in details) {
    const remaining = (details as { remaining?: unknown }).remaining;
    if (typeof remaining === "number") return remaining;
  }
  return null;
}

export interface AmountMismatch {
  /** The exact total the collection should have been, in pesewas. */
  required: number;
  /** Per-account split of that total, when the API sent one. */
  breakdown: { accountId: string; dailyAmount: number }[];
}

/** `422 AMOUNT_MISMATCH` from collect-all — the required total and its split. */
export function readAmountMismatch(details: unknown): AmountMismatch | null {
  if (!details || typeof details !== "object") return null;
  const required = (details as { required?: unknown }).required;
  if (typeof required !== "number") return null;

  const raw = (details as { breakdown?: unknown }).breakdown;
  const breakdown = Array.isArray(raw)
    ? raw.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const { accountId, dailyAmount } = row as Record<string, unknown>;
        return typeof accountId === "string" && typeof dailyAmount === "number"
          ? [{ accountId, dailyAmount }]
          : [];
      })
    : [];

  return { required, breakdown };
}
