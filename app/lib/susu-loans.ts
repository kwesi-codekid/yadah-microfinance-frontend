/**
 * The susu loan account (client decision, 23 Oct 2026): the customer's loan
 * passbook. It replaced loan savings and sits with susu, but none of susu's
 * rules apply — no plans, no cycles, no commission. Any amount is paid in, at
 * the office only; nothing is ever withdrawn. Its money goes to the loan on
 * the loan's own monthly dates by itself, and once a loan is paid off what is
 * left moves to the customer's savings. One per customer, kept across loans.
 *
 * Client-safe: types and labels only. The endpoints are in `~/api/susu-loans`.
 */

export type SusuLoanStatus = "active" | "closed";

export interface SusuLoanAccount {
  id: string;
  /** `SL` + YYMM + sequence, e.g. SL26100001. */
  accountNumber: string;
  customerId: string;
  customerName?: string;
  balance: number;
  status: SusuLoanStatus;
  openedAt: string;
  closedAt?: string;
}

export type SusuLoanTxnType = "deposit" | "repayment" | "leftover" | "refund";

export interface SusuLoanTxn {
  id: string;
  accountId: string;
  customerId: string;
  type: SusuLoanTxnType;
  amount: number;
  balanceAfter: number;
  channel: string;
  loanId?: string;
  loanNumber?: string;
  savingsAccountId?: string;
  accraDay: string;
  recordedById: string;
  createdAt: string;
}

export const TXN_LABELS: Record<SusuLoanTxnType, string> = {
  deposit: "Deposit",
  repayment: "Paid to loan",
  leftover: "Moved to savings",
  refund: "Repayment returned",
};

/** Money in, read from the account's side. */
export function isCredit(type: SusuLoanTxnType): boolean {
  return type === "deposit" || type === "refund";
}
