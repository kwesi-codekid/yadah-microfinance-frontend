import { apiFetch } from "~/api/client";
import { queryOf, type Paginated } from "~/api/query";
import type {
  CorrectionKind,
  CorrectionStatus,
  TxnCorrection,
} from "~/lib/corrections";

/**
 * Correcting a figure already on the ledger. This module imports the API
 * client, so it is server-only: call it from loaders and actions. Types and
 * the vocabulary live in the client-safe `~/lib/corrections`.
 *
 * Asking and correcting live with the transaction being asked about — each
 * module's own `PATCH .../{txnId}` and `POST .../{txnId}/corrections` — so
 * the two calls below build the module's path from the kind. The queue and
 * the decisions live under `/corrections`.
 */

/** Where each kind's transaction lives in the API. */
function txnPath(kind: CorrectionKind, targetId: string, txnId: string): string {
  switch (kind) {
    case "susu-deposit":
      return `/susu/accounts/${targetId}/deposits/${txnId}`;
    case "savings-txn":
      return `/savings/accounts/${targetId}/transactions/${txnId}`;
    case "loan-repayment":
      return `/loans/${targetId}/repayments/${txnId}`;
    case "hp-payment":
      return `/hire-purchase/agreements/${targetId}/payments/${txnId}`;
  }
}

/**
 * PATCH — the office corrects the amount outright. Every rule the module has
 * runs: the newest entry only, and whatever the kind refuses (a susu deposit
 * that is not a whole number of days, a withdrawal past what the account
 * held, a repayment past what was owed). Transfer legs, Paystack charges,
 * closures, HP deposits and redemptions cannot be corrected at all.
 */
export function correctTransaction(
  accessToken: string,
  kind: CorrectionKind,
  targetId: string,
  txnId: string,
  amount: number,
): Promise<unknown> {
  return apiFetch(txnPath(kind, targetId, txnId), {
    method: "PATCH",
    json: { amount },
    accessToken,
  });
}

/**
 * POST .../corrections — a teller asks the office to correct the amount.
 * Nothing moves; the request waits for a decision. Refused on the spot for
 * anything the correction itself would refuse, and `409 CORRECTION_PENDING`
 * when one is already waiting on this entry.
 */
export function proposeCorrection(
  accessToken: string,
  kind: CorrectionKind,
  targetId: string,
  txnId: string,
  input: { amount: number; reason: string },
): Promise<{ correction: TxnCorrection }> {
  return apiFetch(`${txnPath(kind, targetId, txnId)}/corrections`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

export interface CorrectionListParams {
  page?: number;
  limit?: number;
  status?: CorrectionStatus;
  kind?: CorrectionKind;
  /** The account, loan or agreement whose requests to list. */
  targetId?: string;
}

/** GET /corrections — the queue, newest first (counter). */
export function listCorrections(
  accessToken: string,
  params: CorrectionListParams = {},
): Promise<Paginated<TxnCorrection>> {
  return apiFetch(`/corrections${queryOf({ ...params })}`, { accessToken });
}

/**
 * POST /corrections/{id}/approve — apply it (office). The same correction as
 * `correctTransaction`, checked against the record as it stands now; a rule
 * that refuses it leaves the request pending with that refusal.
 */
export function approveCorrection(
  accessToken: string,
  correctionId: string,
): Promise<{ correction: TxnCorrection; target: unknown; txn: unknown }> {
  return apiFetch(`/corrections/${correctionId}/approve`, {
    method: "POST",
    accessToken,
  });
}

/** POST /corrections/{id}/reject — decline (office). */
export function rejectCorrection(
  accessToken: string,
  correctionId: string,
  reason: string,
): Promise<{ correction: TxnCorrection }> {
  return apiFetch(`/corrections/${correctionId}/reject`, {
    method: "POST",
    json: { reason },
    accessToken,
  });
}

/** POST /corrections/{id}/cancel — whoever asked takes it back. */
export function cancelCorrection(
  accessToken: string,
  correctionId: string,
): Promise<{ correction: TxnCorrection }> {
  return apiFetch(`/corrections/${correctionId}/cancel`, {
    method: "POST",
    accessToken,
  });
}
