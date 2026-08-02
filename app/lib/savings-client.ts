import type { PaymentChannel } from "~/lib/channel";

/** GHS 50 that must stay in an open account. Released only by closing it. */
export const SAVINGS_MIN_BALANCE = 5000;

/** GHS 10, flat, on every withdrawal — and once more on closure. */
export const SAVINGS_FEE = 1000;

/** GHS 10, the smallest deposit the API accepts (`minimum: 1000`). */
export const SAVINGS_MIN_DEPOSIT = 1000;

export type SavingsAccountStatus = "active" | "closed";

export type SavingsTxnType = "deposit" | "withdrawal" | "closure";

export const SAVINGS_ACCOUNT_STATUSES: SavingsAccountStatus[] = [
  "active",
  "closed",
];

export const SAVINGS_ACCOUNT_STATUS_LABELS: Record<
  SavingsAccountStatus,
  string
> = {
  active: "Active",
  closed: "Closed",
};

export const SAVINGS_TXN_TYPE_LABELS: Record<SavingsTxnType, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  closure: "Closure",
};

/** The `SavingsAccount` schema. */
export interface SavingsAccount {
  id: string;
  accountNumber: string;
  customerId: string;
  /** Joined by the API on list responses, the way `Loan` does it. */
  customerName?: string;
  /** Pesewas. Everything in the account, including the untouchable minimum. */
  balance: number;
  availableToWithdraw: number;
  status: SavingsAccountStatus;
  openedAt: string;
  closedAt?: string;
}

/** The `SavingsTxn` schema. One row of a statement. */
export interface SavingsTxn {
  id: string;
  accountId: string;
  customerId: string;
  type: SavingsTxnType;
  amount: number;
  /** GHS 10 on withdrawals and closure; absent on deposits. */
  fee?: number;
  balanceAfter: number;
  channel: PaymentChannel;
  /** Accra calendar day, `YYYY-MM-DD`. What the one-per-day rule counts. */
  accraDay: string;
  /** Who recorded it — a collector or office staff. */
  recordedById: string;
  createdAt: string;
}

export interface SavingsCloseResult {
  account: SavingsAccount;
  fee: number;
  payout: number;
  /** True when the balance did not cover the fee — needs a human look. */
  flagged: boolean;
}

export interface SavingsTxnResult {
  txn: SavingsTxn;
  account: SavingsAccount;
  /** True when the API replayed an earlier identical request. */
  replayed: boolean;
}

export function isSavingsAccountStatus(v: unknown): v is SavingsAccountStatus {
  return (
    typeof v === "string" && (SAVINGS_ACCOUNT_STATUSES as string[]).includes(v)
  );
}

export function lockedBalance(account: SavingsAccount): number {
  return Math.max(0, account.balance - account.availableToWithdraw);
}

export function withdrawalCost(amount: number): number {
  return amount + SAVINGS_FEE;
}

export function closurePayout(account: SavingsAccount): number {
  return Math.max(0, account.balance - SAVINGS_FEE);
}

export function hasCashedOutOn(txns: SavingsTxn[], accraDay: string): boolean {
  return txns.some(
    (txn) =>
      txn.accraDay === accraDay &&
      (txn.type === "withdrawal" || txn.type === "closure"),
  );
}

/** `422 EXCEEDS_AVAILABLE` — what could actually have been withdrawn. */
export function readExceedsAvailable(details: unknown): number | null {
  if (details && typeof details === "object" && "available" in details) {
    const available = (details as { available?: unknown }).available;
    if (typeof available === "number") return available;
  }
  return null;
}
