import { apiFetch, apiFetchRaw } from "~/api/client";
import type {
  TransferDestination,
  TransferResult,
  TransferSource,
} from "~/lib/transfers";

/**
 * `POST /transfers` and its receipt — the whole module. This imports the API client, so it is
 * server-only. Types and the rules behind them live in `~/lib/transfers`.
 *
 * Office only, and atomic: either both halves happen or neither does. One SMS
 * summarises the move to the customer.
 */

/**
 * Move money between two of one customer's own accounts.
 *
 * `amount` is what leaves the source: at most what a savings or susu account
 * can give up, and at most what a loan or agreement still owes.
 *
 * The idempotency key is minted once when the wizard opens and reused on every
 * retry; regenerating it per submit would defeat the point and could move the
 * money twice.
 */
export function createTransfer(
  accessToken: string,
  input: {
    from: TransferSource;
    to: TransferDestination;
    /** Pesewas. */
    amount: number;
    idempotencyKey: string;
  },
): Promise<{ transfer: TransferResult; replayed: boolean }> {
  return apiFetch("/transfers", { method: "POST", json: input, accessToken });
}

/**
 * GET /transfers/{id}/receipt — the printable PDF. No cash crossed the counter,
 * so the headline reads AMOUNT MOVED and both legs are named explicitly; money
 * the destination could not absorb shows as excess held pending.
 *
 * Raw response: the browser holds no access token, so a resource route proxies
 * the body through with the session's.
 */
export function transferReceiptPdf(
  accessToken: string,
  id: string,
): Promise<Response> {
  return apiFetchRaw(`/transfers/${id}/receipt`, { accessToken });
}
