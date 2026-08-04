/**
 * One customer's money in one list. Client-safe: the page reads these labels to
 * build its tabs and badges, while [transactions.server.ts](app/lib/transactions.server.ts)
 * assembles the rows.
 */

export type TxnProduct = "susu" | "savings" | "loan" | "hire-purchase";

export type TxnKind =
  | "susu-deposit"
  | "savings-deposit"
  | "savings-withdrawal"
  | "savings-closure"
  | "loan-repayment"
  | "hp-payment";

/** In is money the customer paid; out is money handed back to them. */
export type TxnDirection = "in" | "out";

export const TXN_KIND_LABELS: Record<TxnKind, string> = {
  "susu-deposit": "Susu deposit",
  "savings-deposit": "Savings deposit",
  "savings-withdrawal": "Withdrawal",
  "savings-closure": "Closure",
  "loan-repayment": "Loan repayment",
  "hp-payment": "HP payment",
};

export const TXN_DIRECTIONS: Record<TxnKind, TxnDirection> = {
  "susu-deposit": "in",
  "savings-deposit": "in",
  "savings-withdrawal": "out",
  "savings-closure": "out",
  "loan-repayment": "in",
  "hp-payment": "in",
};

export const TXN_PRODUCT_LABELS: Record<TxnProduct, string> = {
  susu: "Susu",
  savings: "Savings",
  loan: "Loans",
  "hire-purchase": "Hire purchase",
};

/** One line of the timeline, whichever product it came off. */
export interface TxnRow {
  id: string;
  kind: TxnKind;
  product: TxnProduct;
  /** ISO timestamp or `YYYY-MM-DD`. What the list sorts on, newest first. */
  at: string;
  /** Pesewas, always positive — `TXN_DIRECTIONS` says which way it moved. */
  amount: number;
  /** The savings fee, where one was taken. */
  fee?: number;
  /** Whose money it is. Joined by the API on every list response. */
  customerName: string;
  /** The account, loan or agreement it belongs to. */
  accountLabel: string;
  /** Where clicking the row goes. */
  to: string;
  detail?: string;
  recordedById?: string;
}

export function isTxnProduct(value: unknown): value is TxnProduct {
  return (
    value === "susu" ||
    value === "savings" ||
    value === "loan" ||
    value === "hire-purchase"
  );
}

export interface TxnTotals {
  in: number;
  out: number;
  /** What the business is holding: paid in less handed back. */
  net: number;
}

export function totalsOf(rows: TxnRow[]): TxnTotals {
  let paidIn = 0;
  let paidOut = 0;
  for (const row of rows) {
    if (TXN_DIRECTIONS[row.kind] === "in") paidIn += row.amount;
    else paidOut += row.amount;
  }
  return { in: paidIn, out: paidOut, net: paidIn - paidOut };
}
