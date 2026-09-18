import { apiFetch, apiFetchRaw } from "~/api/client";
import { queryOf, type ExportFormat, type Paginated } from "~/api/query";
import type { AuditLog } from "~/lib/audit";

/**
 * The `/audit-logs` endpoint — the trail, read-only. This module imports the
 * API client, so it is server-only: call it from loaders. Types and the
 * vocabulary live in the client-safe `~/lib/audit`.
 *
 * Office only. There is no write: entries are written by the API alongside
 * the change they record, inside the same transaction.
 */

export interface AuditListParams {
  page?: number;
  limit?: number;
  /** The staff account that made the change. */
  actorId?: string;
  /** Kebab-case, as the API records it: `susu-account`, `customer`. */
  entityType?: string;
  entityId?: string;
  /**
   * Action prefixes, comma-separated: `susu` reaches every susu action,
   * `susu.deposit.record` exactly that one.
   */
  action?: string;
  /** Inclusive Accra days, `YYYY-MM-DD`. */
  from?: string;
  to?: string;
}

/** GET /audit-logs — newest first (office). */
export function listAuditLogs(
  accessToken: string,
  params: AuditListParams = {},
): Promise<Paginated<AuditLog>> {
  return apiFetch(`/audit-logs${queryOf({ ...params })}`, { accessToken });
}

/**
 * GET /audit-logs?format=csv|xlsx — the same set as a spreadsheet. Pagination
 * is ignored and the API caps the download at 10,000 rows.
 */
export function exportAuditLogs(
  accessToken: string,
  params: Omit<AuditListParams, "page" | "limit">,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/audit-logs${queryOf({ ...params }, format)}`, { accessToken });
}
