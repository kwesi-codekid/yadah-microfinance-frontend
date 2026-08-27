/**
 * Transfer types shared by the server and the browser. Nothing here may import
 * a `.server` module or the API client. The fetch function lives in
 * `~/api/transfers`.
 *
 * One endpoint, and more rules behind it than any other in the API. A transfer
 * moves money between two accounts belonging to the *same* customer, atomically
 * — and each side keeps every rule it would have kept on its own:
 *
 *   - A **savings source is a real withdrawal**: the flat GH₵ 10 fee comes off,
 *     it uses up the one withdrawal that account may take today, and it cannot
 *     dip into the GH₵ 50 minimum.
 *   - A **susu source stops the account** with the usual one-day commission —
 *     or draws down a `pending-payout` balance, which is the only case in the
 *     whole endpoint where a partial amount is allowed.
 *   - A **loan or hire-purchase destination takes at most what it still owes**.
 *     Anything over that stays in the susu account pending withdrawal.
 *   - An **internal savings credit skips the GH₵ 10 minimum deposit** — the
 *     floor is there to stop pointless counter deposits, not to block a move.
 *
 * `amount` is optional, and omitting it means "the whole balance". That is a
 * genuinely different instruction from any number, and the screen has to make
 * which one is being given unmistakable.
 */

export type TransferSourceType = "susu" | "savings";

export type TransferDestinationType = "susu" | "savings" | "loan" | "hire-purchase";

export type TransferSource =
  | { type: "susu"; accountId: string }
  | { type: "savings"; accountId: string };

export type TransferDestination =
  | { type: "susu"; accountId: string }
  | { type: "savings"; accountId: string }
  | { type: "loan"; loanId: string }
  | { type: "hire-purchase"; agreementId: string };

/** What the API did, in the four figures that matter. */
export interface TransferResult {
  id: string;
  fromType: string;
  toType: string;
  /** What left the source. */
  amountMoved: number;
  /** The savings withdrawal fee, when the source was savings. */
  fee: number;
  /** What actually landed on the destination. */
  amountCredited: number;
  /** What the destination could not take, left pending in the susu account. */
  excessPending: number;
}

/* ------------------------------------------------------------------ labels --- */

export const SOURCE_LABELS: Record<TransferSourceType, string> = {
  susu: "Susu account",
  savings: "Savings account",
};

export const DESTINATION_LABELS: Record<TransferDestinationType, string> = {
  susu: "Susu account",
  savings: "Savings account",
  loan: "Loan",
  "hire-purchase": "Hire purchase agreement",
};

/** The routes the API supports. A source may never send to its own kind twice. */
export const ROUTES: Record<TransferSourceType, TransferDestinationType[]> = {
  susu: ["savings", "loan", "hire-purchase"],
  savings: ["susu", "loan", "hire-purchase"],
};

/** Whether a pair is one the API will accept, checked before the round trip. */
export function isSupportedRoute(
  from: TransferSourceType,
  to: TransferDestinationType,
): boolean {
  return ROUTES[from].includes(to);
}

/* ---------------------------------------------------------------- previews --- */

/**
 * What a savings-sourced transfer costs before anything lands. The fee is
 * charged on top of what moves, exactly as it is at the counter, so the
 * customer's balance falls by more than the amount transferred.
 */
export function savingsSourceCost(amount: number, fee: number): number {
  return amount + fee;
}

/**
 * What a destination can actually take, and what would be left over. Loans and
 * hire-purchase agreements cap at their remaining balance; a savings or susu
 * destination takes everything.
 */
export function splitAtCap(
  amount: number,
  cap: number | null,
): { credited: number; excess: number } {
  if (cap == null) return { credited: amount, excess: 0 };
  const credited = Math.min(amount, Math.max(0, cap));
  return { credited, excess: amount - credited };
}
