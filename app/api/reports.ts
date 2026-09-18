import { apiFetch, apiFetchRaw } from "~/api/client";
import { queryOf, type ExportFormat } from "~/api/query";
import type {
  AgingReport,
  CollectionsReport,
  CommissionReport,
  OutstandingReport,
  TransactionFeed,
  TxnModule,
  WorkersReport,
} from "~/lib/reports";

/**
 * The `/reports` endpoints — the read-only half of the API, and the only place
 * that sees across modules. This module imports the API client, so it is
 * server-only. Types live in the client-safe `~/lib/reports`.
 *
 * Office only, except `/reports/workers`, which is admin only.
 */

export type { ExportFormat };

/* --------------------------------------------------------------- dashboard --- */

/*
 * `GET /reports/dashboard` used to live here. The API replaced it with
 * `GET /dashboard/summary` and keeps the old path only as a deprecated alias,
 * so the call moved to `~/api/dashboard`, alongside the four other reads that
 * screen needs.
 */

/* ------------------------------------------------------------- the ledger --- */

export interface TransactionParams {
  page?: number;
  limit?: number;
  /** Inclusive Accra days. Defaults to the last 30 on the API's side. */
  from?: string;
  to?: string;
  module?: TxnModule;
  customerId?: string;
  /**
   * `"true"` to also list Paystack charges not yet applied — money still in
   * flight, as `status: "pending"` or `"failed"` rows that are never in
   * `totals`. The API's default is `"false"`, so omit it for the ledger proper.
   */
  includePending?: "true" | "false";
}

/**
 * GET /reports/transactions — every money event in the business as one list,
 * newest first.
 *
 * A transfer arrives as its per-module legs *and* a row for the transfer
 * itself, all marked `direction=internal`, so the totals only ever count cash
 * that actually crossed the counter. The screen has to draw that distinction
 * or the figures read as double-counted.
 */
export function listTransactions(
  accessToken: string,
  params: TransactionParams = {},
): Promise<TransactionFeed> {
  return apiFetch(`/reports/transactions${queryOf({ ...params })}`, { accessToken });
}

/** GET /reports/transactions?format=csv|xlsx — capped at 10,000 rows. */
export function exportTransactions(
  accessToken: string,
  params: Omit<TransactionParams, "page" | "limit">,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/reports/transactions${queryOf({ ...params }, format)}`, {
    accessToken,
  });
}

/* ----------------------------------------------------------- reconciliation --- */

export interface RangeParams {
  from?: string;
  to?: string;
}

/**
 * GET /reports/collections — susu and savings deposits grouped by whoever
 * recorded them. This is the reconciliation report: who brought in what, over
 * a range that defaults to the last 30 Accra days.
 */
export function getCollections(
  accessToken: string,
  params: RangeParams = {},
): Promise<CollectionsReport> {
  return apiFetch(`/reports/collections${queryOf({ ...params })}`, { accessToken });
}

export function exportCollections(
  accessToken: string,
  params: RangeParams,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/reports/collections${queryOf({ ...params }, format)}`, {
    accessToken,
  });
}

/** GET /reports/loans/outstanding — every open loan, soonest due first. */
/**
 * The loan book. `from`/`to` narrow it to loans DISBURSED in that range — how
 * much was put out in a period and what is still owed on it. Unlike the other
 * report windows, leaving them off means the whole book rather than 30 days.
 */
export function getOutstandingLoans(
  accessToken: string,
  range: { from?: string; to?: string } = {},
): Promise<OutstandingReport> {
  return apiFetch(`/reports/loans/outstanding${queryOf(range)}`, { accessToken });
}

export function exportOutstandingLoans(
  accessToken: string,
  format: ExportFormat,
  range: { from?: string; to?: string } = {},
): Promise<Response> {
  return apiFetchRaw(`/reports/loans/outstanding${queryOf(range, format)}`, {
    accessToken,
  });
}

/** GET /reports/loans/aging — arrears in the 1–30 / 31–90 / 90+ buckets. */
export function getLoanAging(
  accessToken: string,
  range: { from?: string; to?: string } = {},
): Promise<AgingReport> {
  return apiFetch(`/reports/loans/aging${queryOf(range)}`, { accessToken });
}

export function exportLoanAging(
  accessToken: string,
  format: ExportFormat,
  range: { from?: string; to?: string } = {},
): Promise<Response> {
  return apiFetchRaw(`/reports/loans/aging${queryOf(range, format)}`, { accessToken });
}

/**
 * GET /reports/commission — what the branch actually earned in a range: susu
 * closure commissions plus savings withdrawal and closure fees. Everything else
 * on the dashboard is money passing through; this is the part that stays.
 */
export function getCommission(
  accessToken: string,
  params: RangeParams = {},
): Promise<CommissionReport> {
  return apiFetch(`/reports/commission${queryOf({ ...params })}`, { accessToken });
}

export function exportCommission(
  accessToken: string,
  params: RangeParams,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/reports/commission${queryOf({ ...params }, format)}`, {
    accessToken,
  });
}

/**
 * GET /reports/workers — the last run, outcome and change counters for the SMS,
 * loan-escalation, HP-arrears and debt-recovery workers. Admin only.
 *
 * The counters live in the API's memory and reset when it restarts, and every
 * worker runs a pass at startup. A panel of zeroes means the API was recently
 * restarted — the screen has to label it that way, or an empty panel reads as
 * four dead workers.
 */
export function getWorkers(accessToken: string): Promise<WorkersReport> {
  return apiFetch("/reports/workers", { accessToken });
}
