/**
 * Susu types and display constants shared by the server and the browser.
 * Nothing here may import a `.server` module or the API client — it is bundled
 * into the client. The fetch functions live in `~/api/susu`.
 *
 * One account is one cycle: 31 deposits at a fixed daily amount. The amount
 * cannot change once the account is open — a different amount means closing
 * this account and opening another — and a customer may run several at once.
 */

/** The 31 deposits a full cycle runs to. The API sends it on every account. */
export const CYCLE_TARGET = 31;

/** The API's floor on a daily amount: GHS 10, in pesewas. Raised API-side, Aug 2026. */
export const MIN_DAILY_AMOUNT = 1000;

export type SusuStatus =
  | "active"
  | "completed"
  | "pending-payout"
  | "closed"
  | "terminated";

/** How the cash physically arrived. `transfer` is only ever set by the API. */
export type DepositChannel = "cash" | "paystack" | "momo";

/** Cycle months, in the three-letter form the branch writes on a passbook. */
export const CYCLE_MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;
export type CycleMonth = (typeof CYCLE_MONTHS)[number];

/** The month we are in now, which is what a new cycle is called by default. */
export function currentCycleMonth(): CycleMonth {
  // Ghana is UTC+0 year-round, so the UTC month is the Accra month.
  return CYCLE_MONTHS[new Date().getUTCMonth()] ?? "JAN";
}

export interface SusuAccount {
  id: string;
  /**
   * `SU` + YYMM + a 4-digit monthly sequence + the cycle month, e.g.
   * `SU26090005-SEP`. Accounts opened before the cycle month carry no suffix;
   * accounts opened before the scheme keep their legacy 6 random digits.
   */
  accountNumber: string;
  customerId: string;
  /** Present on list responses, for display. */
  customerName?: string;
  /** Pesewas. Immutable for the life of the cycle. */
  dailyAmount: number;
  depositsCount: number;
  cycleTarget: number;
  /** Gross paid in over the life of the cycle. Withdrawals never reduce it. */
  totalDeposited: number;
  /** Handed back through partial withdrawals, without stopping the cycle. */
  withdrawnAmount: number;
  /** `totalDeposited − withdrawnAmount` — what the account actually holds. */
  balance: number;
  /**
   * `balance − dailyAmount`, floored at zero. One day stays reserved so the
   * closing commission is still collectible after a partial withdrawal.
   */
  availableToWithdraw: number;
  status: SusuStatus;
  /**
   * The month this cycle is called — the `-SEP` on the account number. It need
   * not be the month the number was issued in: a cycle opened in late August
   * for a customer who thinks of it as September is a September cycle.
   * Absent on accounts opened before the field existed.
   */
  cycleMonth?: CycleMonth;
  /** Set when this cycle exists because another one overflowed into it. */
  carriedFromAccountId?: string;
  /** Set when the account stops: one day's deposit. */
  commissionAmount?: number;
  /** Set when the account stops: total less the commission. */
  payoutAmount?: number;
  /** Value awaiting withdrawal — what `pending-payout` still owes. */
  payoutRemaining: number;
  openedAt: string;
  closedAt?: string;
}

/** One account's share of a payment. More than one only on a carry-forward. */
export interface DepositLeg {
  deposit: SusuDeposit;
  account: SusuAccount;
  /** True when this leg's account was opened by this very payment. */
  carried: boolean;
}

/**
 * What recording a deposit gives back.
 *
 * `deposit` and `account` are always the leg on the account that was paid
 * into, so every existing screen reads the same two fields. A payment that ran
 * past the end of the cycle has more in `legs`, and the accounts it had to
 * open in `openedAccounts`.
 */
export interface DepositResult {
  deposit: SusuDeposit;
  account: SusuAccount;
  legs: DepositLeg[];
  /** Pesewas across every leg — what the customer actually handed over. */
  totalAmount: number;
  openedAccounts: SusuAccount[];
  replayed?: boolean;
}

/** An account in the trash. `deletedAt` is what separates it from a live one. */
export interface TrashedSusuAccount extends SusuAccount {
  deletedAt: string;
  deletedById?: string;
  deleteReason?: string;
}

export interface SusuDeposit {
  id: string;
  accountId: string;
  customerId: string;
  /** Whoever recorded it — a collector in the field or office staff. */
  collectorId: string;
  amount: number;
  daysCovered: number;
  /** 1-based position in the 31-deposit cycle. */
  seqStart: number;
  seqEnd: number;
  channel: DepositChannel | "transfer";
  /** Set when the deposit came from a collect-all across several accounts. */
  collectAllBatchId?: string;
  /**
   * The other half of a payment that ran past the end of this cycle. The half
   * that overflowed points forward; the half in the new account points back.
   */
  carriedToDepositId?: string;
  carriedToAccountId?: string;
  carriedFromDepositId?: string;
  carriedFromAccountId?: string;
  createdAt: string;
}

export interface TrashedSusuDeposit extends SusuDeposit {
  deletedAt: string;
  deletedById?: string;
  deleteReason?: string;
}

/** GET /susu/summary — one Accra day's collection, for reconciliation. */
export interface SusuSummary {
  date: string;
  /** Null when the office asked for everyone rather than one collector. */
  collectorId: string | null;
  depositCount: number;
  totalCollected: number;
  deposits: SummaryDeposit[];
}

export interface SummaryDeposit {
  depositId: string;
  accountId: string;
  customerId: string;
  customerName: string;
  collectorId: string;
  amount: number;
  daysCovered: number;
  at: string;
}

/* ------------------------------------------------------------------ labels --- */

export const SUSU_STATUS_LABELS: Record<SusuStatus, string> = {
  active: "Active",
  completed: "Completed",
  "pending-payout": "Pending payout",
  closed: "Closed",
  terminated: "Terminated",
};

/**
 * What each state means at the counter, in one line. These are the states a
 * clerk has to act on, so the tooltip has to say what to do, not what it is.
 */
export const SUSU_STATUS_BLURBS: Record<SusuStatus, string> = {
  active: "Taking deposits.",
  completed: "31 deposits in. Ready to close and pay out.",
  "pending-payout": "Stopped with value still owed to the customer.",
  closed: "Paid out, less one day's commission.",
  terminated: "Refunded in full, no commission taken.",
};

/**
 * The tone each state carries in the listing. Money still owed to a customer
 * is the one that must catch the eye, so `pending-payout` takes the warning.
 */
export const SUSU_STATUS_TONE: Record<SusuStatus, "success" | "info" | "warning" | "muted"> = {
  active: "success",
  completed: "info",
  "pending-payout": "warning",
  closed: "muted",
  terminated: "muted",
};

export const CHANNEL_LABELS: Record<string, string> = {
  cash: "Cash",
  momo: "MoMo",
  paystack: "Paystack",
  transfer: "Transfer",
};

export const CHANNEL_OPTIONS: { value: DepositChannel; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "momo", label: "MoMo" },
  { value: "paystack", label: "Paystack" },
];

/** True while the account can still take a deposit. */
export function isOpen(account: SusuAccount): boolean {
  return account.status === "active";
}

/**
 * How far through the cycle, 0–1. Deposits can exceed the target only if the
 * API ever lets them, so it is clamped rather than trusted.
 */
export function cycleProgress(account: SusuAccount): number {
  const target = account.cycleTarget || CYCLE_TARGET;
  return Math.max(0, Math.min(1, account.depositsCount / target));
}

/** What one day's commission will be when the account stops. */
export function commissionOf(account: SusuAccount): number {
  return account.commissionAmount ?? account.dailyAmount;
}

/**
 * What the customer would receive if the account closed now: what the account
 * still holds, less exactly one day. Below one day's deposit there is nothing
 * to take the commission from, and the API refuses the close — that account can
 * only be terminated, which refunds the lot.
 *
 * Read from `balance` rather than `totalDeposited`: since partial withdrawals
 * were allowed, the two diverge, and the deposits already handed back are not
 * owed again.
 */
export function payoutIfClosedNow(account: SusuAccount): number {
  return account.balance - commissionOf(account);
}

/** True when a close would be refused with `COMMISSION_NOT_COVERED`. */
export function commissionUncovered(account: SusuAccount): boolean {
  return account.balance < commissionOf(account);
}

/**
 * A partial withdrawal, checked before the round trip.
 *
 * The API keeps one day's amount back so the closing commission stays
 * collectible, which is exactly what `availableToWithdraw` already is — so this
 * refuses what the API would refuse, using the figure it sent.
 */
export function checkWithdrawalAmount(
  account: SusuAccount,
  pesewas: number | null,
): string | null {
  if (pesewas == null || !Number.isFinite(pesewas) || pesewas <= 0) {
    return "Enter what the customer is taking.";
  }
  if (account.availableToWithdraw <= 0) {
    return "One day's amount has to stay in to cover the closing commission.";
  }
  if (pesewas > account.availableToWithdraw) {
    return "More than this account can give up while staying open.";
  }
  return null;
}

/** What the account holds once a withdrawal of this size comes off. No fee. */
export function balanceAfterWithdrawal(
  account: SusuAccount,
  pesewas: number,
): number {
  return account.balance - pesewas;
}

/** Days still unpaid in this cycle. */
export function daysRemaining(account: SusuAccount): number {
  return (account.cycleTarget || CYCLE_TARGET) - account.depositsCount;
}

/**
 * How many new accounts a payment of this size would have to open. A payment
 * fills the rest of this cycle first, then whole cycles after it.
 */
export function accountsCarried(account: SusuAccount, pesewas: number): number {
  const days = Math.floor(pesewas / account.dailyAmount);
  const over = days - daysRemaining(account);
  return over <= 0 ? 0 : Math.ceil(over / (account.cycleTarget || CYCLE_TARGET));
}

/**
 * The API derives the days covered from the cash handed over, so the amount
 * must be a whole multiple of the daily amount. Returns the fault, or null.
 *
 * Running past the end of the cycle is no longer a fault: the days that fit
 * finish this cycle and the rest starts a new one. Running past the end of
 * TWO cycles is, because a single payment worth that much is far likelier a
 * mistyped amount than cash somebody actually handed over.
 */
export function checkDepositAmount(
  account: SusuAccount,
  pesewas: number,
): string | null {
  if (!Number.isFinite(pesewas) || pesewas <= 0) return "Enter an amount.";
  if (pesewas % account.dailyAmount !== 0) {
    return "The amount has to be a whole number of days.";
  }
  if (accountsCarried(account, pesewas) > MAX_CARRY_ACCOUNTS) {
    return "That is more than two full cycles at once — check the amount.";
  }
  return null;
}

/** The most new accounts one payment may open. Mirrors the API's own limit. */
export const MAX_CARRY_ACCOUNTS = 1;

/**
 * What will happen to a payment that runs past the end of the cycle, in the
 * words the collector should say to the customer. Null when it simply fits.
 */
export function carryNotice(account: SusuAccount, pesewas: number): string | null {
  if (!Number.isFinite(pesewas) || pesewas <= 0) return null;
  if (pesewas % account.dailyAmount !== 0) return null;
  if (accountsCarried(account, pesewas) !== 1) return null;
  const remaining = daysRemaining(account);
  const carried = Math.floor(pesewas / account.dailyAmount) - remaining;
  return (
    `${remaining} day${remaining === 1 ? "" : "s"} finishes this cycle; the ` +
    `other ${carried} day${carried === 1 ? "" : "s"} will start a new account.`
  );
}

/** How many days a given amount covers, for the "3 days" line under the box. */
export function daysCovered(account: SusuAccount, pesewas: number): number {
  if (!account.dailyAmount) return 0;
  return Math.floor(pesewas / account.dailyAmount);
}
