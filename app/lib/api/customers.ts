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
 * Access differs from staff: **all roles see all customers** — the API used to
 * narrow a collector's list to the customers assigned to them, and no longer
 * does. Writes stay office-only (admin + manager). Each call takes the caller's
 * access token and returns the parsed success body; failures throw `ApiError`.
 *
 * Collector assignment is gone from the API entirely: there is no
 * `assignedCollectorId` on the record, in either write body, or as a list
 * filter. Any collector may collect from any customer, so there is nothing left
 * to assign — see [susu.ts](app/lib/api/susu.ts), which was relaxed the same way.
 *
 * There are no upload endpoints here any more. `POST /customers/{id}/photo` and
 * `POST /customers/{id}/id-document` were withdrawn in favour of a general
 * [`/uploads/images`](app/lib/api/uploads.ts); the customer record now just
 * holds the URLs those uploads return.
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

/**
 * POST /customers (office only)
 *
 * 409 `PHONE_TAKEN` / `ID_TAKEN` when the number or the ID already belongs to
 * someone — the two collisions worth catching, since both mean the person is
 * probably already registered.
 *
 * Pictures are not sent here. Upload them with
 * [uploadImage](app/lib/api/uploads.ts) and put the URLs it returns in
 * `photoUrl` / `idDocumentFrontUrl` / `idDocumentBackUrl`.
 */
export function createCustomer(
  accessToken: string,
  input: CustomerInput,
): Promise<{ customer: Customer }> {
  return apiFetch("/customers", { method: "POST", json: input, accessToken });
}

/**
 * PATCH /customers/{id} (office only)
 *
 * Send only what changed. Same 409s as create, and the same route for pictures
 * — a replacement photo is an uploaded URL written here, not a multipart body.
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
