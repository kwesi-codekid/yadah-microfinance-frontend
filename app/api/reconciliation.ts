import { apiFetch, apiFetchRaw } from "~/api/client";
import { queryOf, type ExportFormat, type Paginated } from "~/api/query";
import type {
  ExpectedCash,
  Reconciliation,
  ReconciliationStatus,
  VarianceReport,
} from "~/lib/reconciliation";

/**
 * The `/reconciliation` endpoints — the end-of-day cash handover. This module
 * imports the API client, so it is server-only: call it from loaders and
 * actions. Types and the variance vocabulary live in the client-safe
 * `~/lib/reconciliation`.
 *
 * The one part of the app where a collector and the office each hold half. A
 * collector may read their own expected total and declare against it; only the
 * office confirms, and **a collector cannot confirm their own cash** — the API
 * refuses it, and so must every screen that offers the button.
 */

export type { ExportFormat, Paginated };

export interface ReconciliationListParams {
  page?: number;
  limit?: number;
  collectorId?: string;
  status?: ReconciliationStatus;
  /** `true` to see only the days that did not balance. */
  varianceOnly?: "true" | "false";
  /** Inclusive Accra day, `YYYY-MM-DD`. */
  from?: string;
  to?: string;
}

/**
 * GET /reconciliation/expected — the cross-check before anyone counts.
 *
 * Cash channel only: a Paystack or momo deposit never passed through the
 * collector's hands and a transfer leg is not cash. Loans and hire purchase are
 * excluded outright, being office business.
 *
 * Collectors are pinned to themselves whatever they pass; office roles **must**
 * name a `collectorId`.
 */
export function getExpected(
  accessToken: string,
  params: { accraDay?: string; collectorId?: string } = {},
): Promise<ExpectedCash> {
  return apiFetch(`/reconciliation/expected${queryOf({ ...params })}`, {
    accessToken,
  });
}

/**
 * POST /reconciliation/declare — step one, by the collector.
 *
 * The declared figure is recorded exactly as given. A mismatch with the system
 * total is information for whoever receives the cash, not an error to be fixed
 * here — which is the whole point of having two steps.
 *
 * One reconciliation per collector per Accra day. Closing a late day is
 * allowed; closing a future one is not.
 */
export function declare(
  accessToken: string,
  input: { accraDay?: string; declaredAmount: number; declaredNote?: string },
): Promise<{ reconciliation: Reconciliation }> {
  return apiFetch("/reconciliation/declare", {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * POST /reconciliation/{id}/confirm — step two, by the office.
 *
 * The expected total is **recomputed here** rather than reused from the
 * declaration, so a deposit corrected in between is reflected in the variance.
 * A shortage is recorded, never blocked: the collector keeps working and the
 * gap surfaces in `getVariances`.
 */
export function confirm(
  accessToken: string,
  id: string,
  input: { receivedAmount: number; varianceReason?: string },
): Promise<{ reconciliation: Reconciliation }> {
  return apiFetch(`/reconciliation/${id}/confirm`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * GET /reconciliation — the handover book. Collectors see only their own days;
 * office roles see everyone and may filter.
 */
export function listReconciliations(
  accessToken: string,
  params: ReconciliationListParams = {},
): Promise<Paginated<Reconciliation>> {
  return apiFetch(`/reconciliation${queryOf({ ...params })}`, { accessToken });
}

/** GET /reconciliation?format=csv|xlsx — pagination ignored. */
export function exportReconciliations(
  accessToken: string,
  params: Omit<ReconciliationListParams, "page" | "limit">,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/reconciliation${queryOf({ ...params }, format)}`, {
    accessToken,
  });
}

/** GET /reconciliation/{id} — one day's handover. */
export function getReconciliation(
  accessToken: string,
  id: string,
): Promise<{ reconciliation: Reconciliation }> {
  return apiFetch(`/reconciliation/${id}`, { accessToken });
}

/**
 * GET /reconciliation/variances — who is short, how often, and by how much,
 * worst first.
 *
 * Shortfalls and overages are reported separately as well as netted, and the
 * screen has to keep them apart: a collector short GHS 50 one day and over
 * GHS 50 the next nets to zero, and is not the same person as one who always
 * balances.
 */
export function getVariances(
  accessToken: string,
  params: { from?: string; to?: string; collectorId?: string } = {},
): Promise<VarianceReport> {
  return apiFetch(`/reconciliation/variances${queryOf({ ...params })}`, {
    accessToken,
  });
}

/** GET /reconciliation/variances?format=csv|xlsx */
export function exportVariances(
  accessToken: string,
  params: { from?: string; to?: string; collectorId?: string },
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/reconciliation/variances${queryOf({ ...params }, format)}`, {
    accessToken,
  });
}
