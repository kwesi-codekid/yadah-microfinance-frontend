import { apiFetch } from "~/api/client";
import { queryOf, type Paginated } from "~/api/query";
import type { PayoutRequest, PayoutRequestStatus } from "~/lib/payout-requests";

/**
 * The `/payout-requests` endpoints — withdrawals the customer asked for from
 * the portal, waiting on the office. This module imports the API client, so it
 * is server-only: call it from loaders and actions. Types and the status
 * vocabulary live in the client-safe `~/lib/payout-requests`.
 *
 * Office only, all of it. The customer's half — raising a request and watching
 * it — is the portal's `/portal/requests`, which this app never calls.
 */

export type { Paginated };

export interface PayoutRequestListParams {
  page?: number;
  limit?: number;
  status?: PayoutRequestStatus;
}

/**
 * GET /payout-requests — the queue. The API answers `{ items }` only, without
 * the `page`/`limit`/`total` the other listings carry, so the envelope is
 * filled in here from what was asked for and what came back. A full page means
 * there may be another; a short one means this is the last.
 */
export async function listPayoutRequests(
  accessToken: string,
  params: PayoutRequestListParams = {},
): Promise<Paginated<PayoutRequest>> {
  const page = params.page ?? 1;
  const limit = params.limit ?? 20;
  const result = await apiFetch<Partial<Paginated<PayoutRequest>> & { items: PayoutRequest[] }>(
    `/payout-requests${queryOf({ ...params })}`,
    { accessToken },
  );
  return {
    items: result.items,
    page: result.page ?? page,
    limit: result.limit ?? limit,
    total:
      result.total ??
      (page - 1) * limit + result.items.length + (result.items.length === limit ? 1 : 0),
  };
}

/** GET /payout-requests/{id} — one request. */
export function getPayoutRequest(
  accessToken: string,
  id: string,
): Promise<{ request: PayoutRequest }> {
  return apiFetch(`/payout-requests/${id}`, { accessToken });
}

/**
 * POST /payout-requests/{id}/approve — execute the withdrawal, then send the
 * money.
 *
 * **Order matters and is deliberate.** The ledger write is committed before any
 * external call. If the Paystack transfer later fails the account is already
 * debited and the request moves to `failed` — never auto-reversed. `409` when
 * the request has already been decided; `503` when Paystack transfers are not
 * configured.
 */
export function approvePayoutRequest(
  accessToken: string,
  id: string,
): Promise<{ request: PayoutRequest }> {
  return apiFetch(`/payout-requests/${id}/approve`, {
    method: "POST",
    accessToken,
  });
}

/** POST /payout-requests/{id}/reject — decline. Nothing moves. */
export function rejectPayoutRequest(
  accessToken: string,
  id: string,
  reason: string,
): Promise<{ request: PayoutRequest }> {
  return apiFetch(`/payout-requests/${id}/reject`, {
    method: "POST",
    json: { reason },
    accessToken,
  });
}

/**
 * POST /payout-requests/{id}/verify-transfer — the missed-webhook fallback.
 * Asks Paystack directly and applies the outcome, like the charge fallback.
 */
export function verifyPayoutTransfer(
  accessToken: string,
  id: string,
): Promise<{ request: PayoutRequest }> {
  return apiFetch(`/payout-requests/${id}/verify-transfer`, {
    method: "POST",
    accessToken,
  });
}
