/**
 * Client-safe savings types, mirroring the API's `components.schemas`, plus the
 * arithmetic the screens need. Safe to import from browser components — the same
 * split as [susu-client.ts](app/lib/susu-client.ts), which owns the other product.
 *
 * The domain in one paragraph: a savings account is an open-ended balance, not a
 * cycle. Money goes in whenever (minimum GHS 10 a time) and comes out on request
 * — but a flat **GHS 10 fee** is charged on every withdrawal, a **GHS 50 minimum
 * balance** has to stay in the account, and only **one withdrawal per Accra day**
 * is allowed. Closing the account is the only thing that releases the minimum
 * balance, and it pays the fee one last time.
 *
 * That is the whole difference from susu, and it is why this file has no cycle
 * arithmetic and susu-client has no fee arithmetic.
 *
 * Every amount here is integer pesewas. See [money.ts](app/lib/money.ts).
 *
 * Source of truth: GET https://yadah-backend-staging.adamusgh.com/api/v1/openapi.json
 */

import type { PaymentChannel } from "~/lib/channel";

/* ------------------------------------------------------------------ *
 * The three numbers the product is built on
 *
 * Hard-coded in the API's descriptions rather than returned as fields, so they
 * are named here and used everywhere instead of being retyped as literals. If
 * the business changes one, this is the line to change.
 * ------------------------------------------------------------------ */

/** GHS 50 that must stay in an open account. Released only by closing it. */
export const SAVINGS_MIN_BALANCE = 5000;

/** GHS 10, flat, on every withdrawal — and once more on closure. */
export const SAVINGS_FEE = 1000;

/** GHS 10, the smallest deposit the API accepts (`minimum: 1000`). */
export const SAVINGS_MIN_DEPOSIT = 1000;

export type SavingsAccountStatus = "active" | "closed";

/**
 * `closure` is the API's own third type, not a withdrawal with a flag: the
 * closing payout releases the minimum balance, which no ordinary withdrawal can
 * touch. A statement that called both "withdrawal" would make the last line
 * look like it broke the floor.
 */
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
  /**
   * Ten digits, unique — the handle a customer quotes. Note it is *ten*, where
   * a susu account number is six; a search field built for one will silently
   * refuse the other.
   */
  accountNumber: string;
  customerId: string;
  /** Pesewas. Everything in the account, including the untouchable minimum. */
  balance: number;
  /**
   * What a withdrawal could actually take right now: balance − the GHS 50
   * minimum − the GHS 10 fee, floored at zero.
   *
   * Computed server-side and read, never recomputed here. `withdrawableFrom`
   * below says the same thing from a balance, but only for figures the UI is
   * projecting — an account in hand always answers with this field.
   */
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
  /**
   * For a deposit, what went in. For a withdrawal or closure, **what the
   * customer received** — the fee is not inside this number, it is `fee`
   * alongside it, and the balance fell by the two together.
   */
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

/* ------------------------------------------------------------------ *
 * Fee and floor arithmetic
 *
 * Derived, never stored. The API owns the numbers; these turn them into the
 * questions a teller actually gets asked at the counter.
 * ------------------------------------------------------------------ */

/**
 * The part of the balance a withdrawal can't reach: the minimum plus the fee
 * the next withdrawal would cost. `balance − availableToWithdraw`, read off the
 * account rather than recomputed, so it stays right even if the API's own
 * formula changes underneath.
 */
export function lockedBalance(account: SavingsAccount): number {
  return Math.max(0, account.balance - account.availableToWithdraw);
}

/**
 * What leaves the balance to put `amount` in someone's hand — the amount plus
 * the flat fee. This is the number that has to fit inside the balance, and it
 * is not the number the customer walks away with, which is why both appear on
 * the withdrawal form.
 */
export function withdrawalCost(amount: number): number {
  return amount + SAVINGS_FEE;
}

/**
 * What closing the account would pay out today: the whole balance, minimum
 * included, less one last fee. Floored at zero — a balance under GHS 10 pays
 * nothing rather than owing it, and the API flags that case on closure.
 */
export function closurePayout(account: SavingsAccount): number {
  return Math.max(0, account.balance - SAVINGS_FEE);
}

/**
 * Has this account already been cashed out today?
 *
 * The API allows one withdrawal per Accra calendar day and answers a second
 * with `409 WITHDRAWAL_LIMIT` — and closure counts, since it pays out too.
 * Checking the statement we already loaded turns that into a disabled button
 * with a reason rather than a rejected submit.
 *
 * Only as good as the page of transactions passed in. It is a courtesy, not the
 * rule: the API owns the rule, and a stale page fails safe by letting the
 * request through to be refused properly.
 */
export function hasCashedOutOn(txns: SavingsTxn[], accraDay: string): boolean {
  return txns.some(
    (txn) =>
      txn.accraDay === accraDay &&
      (txn.type === "withdrawal" || txn.type === "closure"),
  );
}

/* ------------------------------------------------------------------ *
 * Error details
 *
 * The one savings failure that carries the number needed to fix it.
 * ------------------------------------------------------------------ */

/** `422 EXCEEDS_AVAILABLE` — what could actually have been withdrawn. */
export function readExceedsAvailable(details: unknown): number | null {
  if (details && typeof details === "object" && "available" in details) {
    const available = (details as { available?: unknown }).available;
    if (typeof available === "number") return available;
  }
  return null;
}
