import type {
  Customer,
  CustomerInput,
  CustomerStatus,
} from "~/lib/customer-client";
import { apiFetch } from "~/lib/api/client";

export type { CustomerInput };

/**
 * Customer (`/customers`) endpoint wrappers.
 *
 * Access differs from staff: listing is open to every role, but collectors only
 * ever see the customers assigned to them (the API scopes it, not us). Writes
 * are office-only (admin + manager) with one exception — the assigned collector
 * may upload a customer's photo. Each call takes the caller's access token and
 * returns the parsed success body; failures throw `ApiError`.
 */

export interface CustomerListResult {
  items: Customer[];
  page: number;
  limit: number;
  total: number;
}

export interface ListCustomersParams {
  page?: number;
  limit?: number;
  status?: CustomerStatus;
  assignedCollectorId?: string;
  search?: string;
}

/** GET /customers */
export function listCustomers(
  accessToken: string,
  params: ListCustomersParams = {},
): Promise<CustomerListResult> {
  const q = new URLSearchParams();
  if (params.page) q.set("page", String(params.page));
  if (params.limit) q.set("limit", String(params.limit));
  if (params.status) q.set("status", params.status);
  if (params.assignedCollectorId)
    q.set("assignedCollectorId", params.assignedCollectorId);
  if (params.search) q.set("search", params.search);
  const qs = q.toString();
  return apiFetch<CustomerListResult>(`/customers${qs ? `?${qs}` : ""}`, {
    accessToken,
  });
}

/** GET /customers/{id} */
export function getCustomer(
  accessToken: string,
  id: string,
): Promise<{ customer: Customer }> {
  return apiFetch(`/customers/${id}`, { accessToken });
}

/** POST /customers (office only) */
export function createCustomer(
  accessToken: string,
  input: CustomerInput,
): Promise<{ customer: Customer }> {
  return apiFetch("/customers", { method: "POST", json: input, accessToken });
}

/**
 * PATCH /customers/{id} (office only)
 *
 * Send only what changed. Setting `assignedCollectorId` is the reassignment
 * flow and is audited as such by the API.
 */
export function updateCustomer(
  accessToken: string,
  id: string,
  input: Partial<CustomerInput>,
): Promise<{ customer: Customer }> {
  return apiFetch(`/customers/${id}`, {
    method: "PATCH",
    json: input,
    accessToken,
  });
}

/**
 * POST /customers/{id}/photo — office roles or the assigned collector.
 * JPEG/PNG/WebP, max 5 MB; replaces any existing photo.
 *
 * The field name is `photo` for both upload endpoints — including the ID
 * document one, where it reads like a misnomer. It is what the API expects.
 */
export function uploadCustomerPhoto(
  accessToken: string,
  id: string,
  file: File,
): Promise<{ customer: Customer }> {
  const body = new FormData();
  body.set("photo", file);
  return apiFetch(`/customers/${id}/photo`, {
    method: "POST",
    formData: body,
    accessToken,
  });
}

/** POST /customers/{id}/id-document (office only). Same limits as the photo. */
export function uploadCustomerIdDocument(
  accessToken: string,
  id: string,
  file: File,
): Promise<{ customer: Customer }> {
  const body = new FormData();
  body.set("photo", file);
  return apiFetch(`/customers/${id}/id-document`, {
    method: "POST",
    formData: body,
    accessToken,
  });
}

/**
 * POST /customers/{id}/deactivate (office only). Idempotent — and the only
 * removal there is: no delete endpoint exists, so history stays intact.
 */
export function deactivateCustomer(
  accessToken: string,
  id: string,
): Promise<{ customer: Customer }> {
  return apiFetch(`/customers/${id}/deactivate`, {
    method: "POST",
    accessToken,
  });
}

/** POST /customers/{id}/activate (office only) */
export function activateCustomer(
  accessToken: string,
  id: string,
): Promise<{ customer: Customer }> {
  return apiFetch(`/customers/${id}/activate`, { method: "POST", accessToken });
}
