import { apiFetch, apiFetchRaw } from "~/api/client";
import { queryOf, type ExportFormat, type Paginated } from "~/api/query";
import type {
  ImportOutcome,
  ImportPreview,
  ImportRow,
} from "~/lib/customer-import";
import type {
  CreateCustomerInput,
  Customer,
  CustomerStatement,
  CustomerStatus,
  TrashedCustomer,
  UpdateCustomerInput,
} from "~/lib/customers";

/**
 * The `/customers` endpoints. This module imports the API client, so it is
 * server-only — call it from loaders and actions. Types and display constants
 * live in the client-safe `~/lib/customers`.
 */

/** `json` is the default; `csv` and `xlsx` come back as a binary download. */
export type { ExportFormat, Paginated };

export interface CustomerListParams {
  page?: number;
  limit?: number;
  /** Omit for both. */
  status?: CustomerStatus;
  /** Fuzzy across name and phone, in relevance order. */
  search?: string;
  /** One collector's round. */
  assignedCollectorId?: string;
  /** `true` for the customers nobody is due to visit. */
  unassigned?: "true" | "false";
  /** Inclusive Accra day, `YYYY-MM-DD`, on the registration date. */
  from?: string;
  to?: string;
}

export interface CustomerListResult {
  items: Customer[];
  page: number;
  limit: number;
  total: number;
}

export interface TrashListResult {
  items: TrashedCustomer[];
  page: number;
  limit: number;
  total: number;
}

/** GET /customers */
export function listCustomers(
  accessToken: string,
  params: CustomerListParams = {},
): Promise<CustomerListResult> {
  return apiFetch(`/customers${queryOf({ ...params })}`, { accessToken });
}

/**
 * GET /customers?format=csv|xlsx — the same listing as a spreadsheet.
 * Pagination is ignored and the API caps the download at 10,000 rows, so the
 * page/limit of the on-screen listing are deliberately not forwarded.
 */
export function exportCustomers(
  accessToken: string,
  params: Omit<CustomerListParams, "page" | "limit">,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/customers${queryOf({ ...params }, format)}`, { accessToken });
}

/** GET /customers/trash — soft-deleted customers, newest first (office). */
export function listTrashedCustomers(
  accessToken: string,
  params: { page?: number; limit?: number } = {},
): Promise<TrashListResult> {
  return apiFetch(`/customers/trash${queryOf({ ...params })}`, { accessToken });
}

/** GET /customers/{id} */
export function getCustomer(
  accessToken: string,
  id: string,
): Promise<{ customer: Customer }> {
  return apiFetch(`/customers/${id}`, { accessToken });
}

/** POST /customers — register a customer (office). */
export function createCustomer(
  accessToken: string,
  input: CreateCustomerInput,
): Promise<{ customer: Customer }> {
  return apiFetch("/customers", { method: "POST", json: input, accessToken });
}

/**
 * PATCH /customers/{id} — update the profile (office). Only the keys you send
 * are touched; `null` clears an ID scan. Rejected with `CUSTOMER_INACTIVE`
 * while the customer is deactivated, so reactivate before editing, and with
 * `ID_DOCUMENT_IN_USE` when a scan would come off a customer who has a loan
 * or hire-purchase agreement open.
 */
export function updateCustomer(
  accessToken: string,
  id: string,
  input: UpdateCustomerInput,
): Promise<{ customer: Customer }> {
  return apiFetch(`/customers/${id}`, { method: "PATCH", json: input, accessToken });
}

/**
 * DELETE /customers/{id} — soft delete into the trash (office). Refused with
 * `CANNOT_TRASH` while the customer still holds an open susu account, savings
 * account, loan or hire-purchase agreement; the counts arrive in `details`.
 */
export function trashCustomer(
  accessToken: string,
  id: string,
  reason?: string,
): Promise<{ customer: TrashedCustomer }> {
  return apiFetch(`/customers/${id}`, {
    method: "DELETE",
    json: reason ? { reason } : {},
    accessToken,
  });
}

/** POST /customers/{id}/restore — bring one back out of the trash (office). */
export function restoreCustomer(
  accessToken: string,
  id: string,
): Promise<{ customer: Customer }> {
  return apiFetch(`/customers/${id}/restore`, { method: "POST", accessToken });
}

/** POST /customers/{id}/deactivate — blocks edits, stays visible (office). */
export function deactivateCustomer(
  accessToken: string,
  id: string,
): Promise<{ customer: Customer }> {
  return apiFetch(`/customers/${id}/deactivate`, { method: "POST", accessToken });
}

/** POST /customers/{id}/activate — reverse of deactivate (office). */
export function activateCustomer(
  accessToken: string,
  id: string,
): Promise<{ customer: Customer }> {
  return apiFetch(`/customers/${id}/activate`, { method: "POST", accessToken });
}

/* ------------------------------------------------------------- collectors --- */

/**
 * PATCH /customers/{id}/collector — move one customer to another collector
 * (admin).
 *
 * The only route that changes `assignedCollectorId`: a plain profile update
 * ignores the field. A manager may edit a customer but must not quietly move
 * who collects from them, which is why this is admin-only and audited.
 * Idempotent when the customer is already on that collector.
 */
export function reassignCustomerCollector(
  accessToken: string,
  id: string,
  input: { collectorId: string; reason?: string },
): Promise<{ customer: Customer }> {
  return apiFetch(`/customers/${id}/collector`, {
    method: "PATCH",
    json: input,
    accessToken,
  });
}

/**
 * POST /customers/reassign-collector — hand a collector's whole round to
 * someone else (admin).
 *
 * For when a collector leaves or swaps zones. Transactional: either every
 * customer moves or none does, and one audit entry is written per customer, so
 * the books can still answer who owned a customer on any given day.
 */
export function reassignCollectorRound(
  accessToken: string,
  input: { fromCollectorId: string; toCollectorId: string; reason?: string },
): Promise<{ fromCollectorId: string; toCollectorId: string; reassigned: number }> {
  return apiFetch("/customers/reassign-collector", {
    method: "POST",
    json: input,
    accessToken,
  });
}

export interface StatementParams {
  /** Inclusive Accra days, `YYYY-MM-DD`. Defaults to the last 30 days. */
  from?: string;
  to?: string;
}

/**
 * GET /customers/{id}/statement — every product the customer holds with its
 * opening and closing position for the period, plus the unified ledger for the
 * range (office). All amounts are integer pesewas.
 */
export function getCustomerStatement(
  accessToken: string,
  id: string,
  params: StatementParams = {},
): Promise<CustomerStatement> {
  return apiFetch(`/customers/${id}/statement${queryOf({ ...params })}`, {
    accessToken,
  });
}

/** GET /customers/{id}/statement?format=csv|xlsx — the transaction rows. */
export function exportCustomerStatement(
  accessToken: string,
  id: string,
  params: StatementParams,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/customers/${id}/statement${queryOf({ ...params }, format)}`, {
    accessToken,
  });
}

/* ---------------------------------------------------------- bulk import --- */

/**
 * GET /customers/import/template — the blank sheet, as csv or xlsx.
 *
 * Returns the raw response: the browser holds no access token, so the download
 * is proxied through a resource route rather than linked to directly.
 */
export function importTemplate(
  accessToken: string,
  format: "csv" | "xlsx",
): Promise<Response> {
  return apiFetchRaw(`/customers/import/template?format=${format}`, { accessToken });
}

/**
 * POST /customers/import/preview — check a filled sheet. Writes nothing.
 *
 * Every row is held to the rules a single registration is held to, and the
 * answer comes back cell by cell. It also catches the two things only the API
 * can see: a number already on a customer, and one used twice in the sheet.
 */
export function previewImport(
  accessToken: string,
  file: File,
): Promise<ImportPreview> {
  const body = new FormData();
  body.append("file", file);
  return apiFetch("/customers/import/preview", {
    method: "POST",
    formData: body,
    accessToken,
  });
}

/**
 * POST /customers/import — register the rows the office accepted.
 *
 * Row by row, so one bad row does not throw away the sheet. What failed comes
 * back with its reason and can be corrected and sent again; what succeeded is
 * simply absent from the retry.
 */
export function runImport(
  accessToken: string,
  rows: Pick<ImportRow, "row" | "values">[],
): Promise<ImportOutcome> {
  return apiFetch("/customers/import", {
    method: "POST",
    json: { rows },
    accessToken,
  });
}

/** GET /customers/{id}/registration-form — the A4 PDF. Returns the raw response. */
export function registrationFormPdf(
  accessToken: string,
  id: string,
): Promise<Response> {
  return apiFetchRaw(`/customers/${id}/registration-form`, { accessToken });
}
