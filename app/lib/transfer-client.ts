/**
 * Moving money between a customer's own products, in one transaction.
 *
 * Each side keeps its own rules. A **savings source** is a real withdrawal —
 * the GHS 10 fee, one per Accra day, and the available-balance limit all still
 * apply. A **susu source** stops the account with the usual one-day commission,
 * or draws down a pending-payout balance, which is the only case where a
 * partial amount is allowed. **Loan and hire-purchase destinations** take at
 * most what they still owe; a susu-source excess stays in the susu account
 * awaiting withdrawal. An internal savings credit skips the GHS 10 deposit
 * minimum. One SMS covers the whole move.
 */

export type TransferSourceType = "susu" | "savings";

export type TransferTargetType = "susu" | "savings" | "loan" | "hire-purchase";

export const TRANSFER_SOURCE_LABELS: Record<TransferSourceType, string> = {
  susu: "Susu account",
  savings: "Savings account",
};

export const TRANSFER_TARGET_LABELS: Record<TransferTargetType, string> = {
  susu: "Susu account",
  savings: "Savings account",
  loan: "Loan",
  "hire-purchase": "Hire purchase",
};

export type TransferSource =
  | { type: "susu"; accountId: string }
  | { type: "savings"; accountId: string };

export type TransferTarget =
  | { type: "susu"; accountId: string }
  | { type: "savings"; accountId: string }
  | { type: "loan"; loanId: string }
  | { type: "hire-purchase"; agreementId: string };

/** One destination a transfer can land on, flattened for the drawer's list. */
export interface TransferEndpoint {
  /** `susu:<id>`, `savings:<id>`, `loan:<id>` or `hire-purchase:<id>`. */
  key: string;
  kind: TransferTargetType;
  title: string;
  detail: string;
  /** What it can still take, or 0 when it has no ceiling. */
  amount: number;
}

/** The account a drawer is standing on, as the source of the move. */
export interface TransferSourceInfo {
  key: string;
  kind: TransferSourceType;
  title: string;
  /** What it can give. */
  amount: number;
  /** Only a savings source or a pending-payout susu balance takes a part. */
  partial: boolean;
}

/** `susu:abc` → the typed shape the API wants for the sending side. */
export function readTransferSource(raw: string): TransferSource | null {
  const [kind, id] = raw.split(":");
  if (!id) return null;
  if (kind === "susu" || kind === "savings") return { type: kind, accountId: id };
  return null;
}

/** `susu:abc` → the typed shape the API wants for the destination side. */
export function readTransferTarget(raw: string): TransferTarget | null {
  const [kind, id] = raw.split(":");
  if (!id) return null;
  if (kind === "susu" || kind === "savings") return { type: kind, accountId: id };
  if (kind === "loan") return { type: "loan", loanId: id };
  if (kind === "hire-purchase") return { type: "hire-purchase", agreementId: id };
  return null;
}

export interface Transfer {
  id: string;
  fromType: string;
  toType: string;
  /** Taken from the source, before any fee. */
  amountMoved: number;
  /** The savings withdrawal fee, when the source was savings. */
  fee: number;
  /** What actually reached the destination. */
  amountCredited: number;
  /** Left in a susu source because the destination couldn't take it all. */
  excessPending: number;
}

export interface TransferResult {
  transfer: Transfer;
  /** True when the API replayed an earlier identical request. */
  replayed: boolean;
}

/** Which errors this screen can explain better than the API's own wording. */
export const TRANSFER_ERRORS: Record<string, string> = {
  CUSTOMER_MISMATCH:
    "Those two accounts belong to different people. A transfer only moves money within one customer's own products.",
  EXCEEDS_AVAILABLE:
    "The savings account can't spare that much — the GHS 50 minimum balance and the GHS 10 fee both come out of it.",
  EXCEEDS_PAYOUT:
    "That is more than the susu account is still holding for them.",
  EXCEEDS_REMAINING:
    "That is more than the destination still owes. Send the balance instead.",
  AMOUNT_MISMATCH:
    "A whole susu account moves in one piece — leave the amount blank to send all of it.",
  NO_PAYOUT:
    "That susu account has nothing to give: its deposits don't cover the commission.",
  LOAN_NOT_OPEN: "That loan isn't open, so nothing can be paid into it.",
  AGREEMENT_NOT_OPEN:
    "That agreement isn't open, so nothing can be paid into it.",
  WITHDRAWAL_LIMIT:
    "That savings account has already had a withdrawal today, and a transfer out of savings counts as one.",
  ALREADY_CLOSED: "That account has already been closed.",
};

/** A partial amount is only meaningful when drawing a pending-payout balance. */
export function allowsPartialAmount(
  source: { type: TransferSourceType; status?: string } | null,
): boolean {
  if (!source) return false;
  if (source.type === "savings") return true;
  return source.status === "pending-payout";
}
