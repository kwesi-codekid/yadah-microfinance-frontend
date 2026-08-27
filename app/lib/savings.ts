/**
 * Savings types and display constants shared by the server and the browser.
 * Nothing here may import a `.server` module or the API client — it is bundled
 * into the client. The fetch functions live in `~/api/savings`.
 *
 * A savings account is an open balance rather than a cycle: money goes in from
 * GHS 5 upwards, comes out once a day at a flat GHS 10 fee, and GHS 50 has to
 * stay behind until the account is closed. Those three numbers are the whole
 * module — every figure on every savings screen is derived from them.
 */

/** The API's floor on a deposit: GHS 5, in pesewas. Lowered API-side, Aug 2026. */
export const MIN_DEPOSIT = 500;

/** What must stay in the account. Released only by closing it. */
export const MIN_BALANCE = 5000;

/** Flat, charged on every withdrawal and on the closing payout. */
export const WITHDRAWAL_FEE = 1000;

export type SavingsStatus = "active" | "closed";

/**
 * Label only — the money rules are identical. A student account records the
 * minor as the customer, with the guardian's ID in the identification fields
 * and the guardian as next of kin. That is office procedure, not something the
 * API enforces, so the opening form is where it has to be said.
 */
export type SavingsAccountType = "standard" | "student";

/** How the cash physically arrived. `transfer` is only ever set by the API. */
export type SavingsChannel = "cash" | "paystack" | "momo";

export type SavingsTxnType = "deposit" | "withdrawal" | "closure";

export interface SavingsAccount {
  id: string;
  /** 10 digits, randomised and unique. What the branch calls the account. */
  accountNumber: string;
  customerId: string;
  /** Present on list responses, for display. */
  customerName?: string;
  accountType: SavingsAccountType;
  /** Pesewas. */
  balance: number;
  /** Pesewas, floored at zero: balance − the minimum − the fee. */
  availableToWithdraw: number;
  status: SavingsStatus;
  openedAt: string;
  closedAt?: string;
}

/** An account in the trash. `deletedAt` is what separates it from a live one. */
export interface TrashedSavingsAccount extends SavingsAccount {
  deletedAt: string;
  deletedById?: string;
  deleteReason?: string;
}

export interface SavingsTxn {
  id: string;
  accountId: string;
  customerId: string;
  type: SavingsTxnType;
  /** On a withdrawal or a closure this is what the customer receives. */
  amount: number;
  /** The flat fee, on withdrawals and closures. */
  fee?: number;
  balanceAfter: number;
  channel: SavingsChannel | "transfer";
  /** The Accra calendar day it belongs to, `YYYY-MM-DD`. */
  accraDay: string;
  recordedById: string;
  createdAt: string;
}

export interface TrashedSavingsTxn extends SavingsTxn {
  deletedAt: string;
  deletedById?: string;
  deleteReason?: string;
}

/* ------------------------------------------------------------------ labels --- */

export const SAVINGS_STATUS_LABELS: Record<SavingsStatus, string> = {
  active: "Active",
  closed: "Closed",
};

/** What the state means at the counter, in one line. */
export const SAVINGS_STATUS_BLURBS: Record<SavingsStatus, string> = {
  active: "Taking deposits and withdrawals.",
  closed: "Paid out and shut. Nothing more moves through it.",
};

export const SAVINGS_STATUS_TONE: Record<SavingsStatus, "success" | "muted"> = {
  active: "success",
  closed: "muted",
};

export const ACCOUNT_TYPE_LABELS: Record<SavingsAccountType, string> = {
  standard: "Standard",
  student: "Student",
};

export const TXN_TYPE_LABELS: Record<SavingsTxnType, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  closure: "Closure",
};

/**
 * The vocabulary the API uses for how money arrived. `transfer` is on the read
 * side only — the API sets it when another module moved the money, and nothing
 * at the counter may claim it.
 */
export const CHANNEL_LABELS: Record<string, string> = {
  cash: "Cash",
  momo: "MoMo",
  paystack: "Paystack",
  transfer: "Transfer",
};

export const CHANNEL_OPTIONS: { value: SavingsChannel; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "momo", label: "MoMo" },
  { value: "paystack", label: "Paystack" },
];

/* ------------------------------------------------------------------- rules --- */

/** True while the account can still take a deposit or a withdrawal. */
export function isOpen(account: Pick<SavingsAccount, "status">): boolean {
  return account.status === "active";
}

/**
 * The API's floor is GHS 10 and it applies to every deposit, not just the
 * first. Returns the fault, or null.
 */
export function checkDepositAmount(pesewas: number | null): string | null {
  if (pesewas == null || !Number.isFinite(pesewas) || pesewas <= 0) {
    return "Enter the cash received.";
  }
  if (pesewas < MIN_DEPOSIT) return "Deposits start at GH₵ 5.00.";
  return null;
}

/**
 * A withdrawal is checked against `availableToWithdraw` rather than the
 * balance: the fee comes off on top of what the customer receives, and GHS 50
 * has to survive it. The API sends that figure with every account, so this
 * refuses exactly what `EXCEEDS_AVAILABLE` would — before the round trip.
 */
export function checkWithdrawalAmount(
  account: SavingsAccount,
  pesewas: number | null,
): string | null {
  if (pesewas == null || !Number.isFinite(pesewas) || pesewas <= 0) {
    return "Enter what the customer is taking.";
  }
  if (account.availableToWithdraw <= 0) {
    return "Nothing can be withdrawn without dropping below the GH₵ 50 minimum.";
  }
  if (pesewas > account.availableToWithdraw) {
    return "More than this account can give up today.";
  }
  return null;
}

/** What the account holds once a withdrawal of this size and its fee come off. */
export function balanceAfterWithdrawal(
  account: SavingsAccount,
  pesewas: number,
): number {
  return account.balance - pesewas - WITHDRAWAL_FEE;
}

/**
 * What the customer receives when the account is closed. Closing releases the
 * minimum balance, but the flat fee still applies — GHS 200 pays out GHS 190.
 */
export function closurePayout(account: SavingsAccount): number {
  return Math.max(0, account.balance - WITHDRAWAL_FEE);
}

/**
 * True when the balance cannot cover the closing fee. The API closes the
 * account anyway and comes back with `flagged: true`, which the branch has to
 * see rather than have folded into a cheerful "closed" message.
 */
export function closureFlagged(account: SavingsAccount): boolean {
  return account.balance < WITHDRAWAL_FEE;
}

/**
 * Whether today's one withdrawal has already been taken. Worked out from the
 * statement rather than asked for: every transaction carries the Accra day it
 * belongs to, and the API refuses the second one with `WITHDRAWAL_LIMIT`.
 */
export function withdrawnToday(
  txns: Pick<SavingsTxn, "type" | "accraDay">[],
  today: string,
): boolean {
  return txns.some((t) => t.type === "withdrawal" && t.accraDay === today);
}
