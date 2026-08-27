import { apiFetch, apiFetchRaw } from "~/api/client";
import { queryOf, type ExportFormat } from "~/api/query";
import type {
  AgingReport,
  CollectionsReport,
  CommissionReport,
  DashboardMetrics,
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

/**
 * GET /reports/dashboard — today's cash, this month's revenue, and what the
 * branch is currently holding.
 *
 * This endpoint is the source of truth. Socket.io money events to the admin
 * room say *when* to read it again; nothing is ever rendered off a socket
 * payload. JSON only — there is no export.
 */
export function getDashboard(accessToken: string): Promise<DashboardMetrics> {
  return apiFetch("/reports/dashboard", { accessToken });
}

/* ------------------------------------------------------------- the ledger --- */

export interface TransactionParams {
  page?: number;
  limit?: number;
  /** Inclusive Accra days. Defaults to the last 30 on the API's side. */
  from?: string;
  to?: string;
  module?: TxnModule;
  customerId?: string;
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
export function getOutstandingLoans(
  accessToken: string,
): Promise<OutstandingReport> {
  return apiFetch("/reports/loans/outstanding", { accessToken });
}

export function exportOutstandingLoans(
  accessToken: string,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/reports/loans/outstanding${queryOf({}, format)}`, {
    accessToken,
  });
}

/** GET /reports/loans/aging — arrears in the 1–30 / 31–90 / 90+ buckets. */
export function getLoanAging(accessToken: string): Promise<AgingReport> {
  return apiFetch("/reports/loans/aging", { accessToken });
}

export function exportLoanAging(
  accessToken: string,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/reports/loans/aging${queryOf({}, format)}`, { accessToken });
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
