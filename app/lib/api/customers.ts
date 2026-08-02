import type {
  Customer,
  CustomerInput,
  CustomerStatus,
} from "~/lib/customer-client";
import { apiFetch } from "~/lib/api/client";

export type { CustomerInput };

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

export function createCustomer(
  accessToken: string,
  input: CustomerInput,
): Promise<{ customer: Customer }> {
  return apiFetch("/customers", { method: "POST", json: input, accessToken });
}

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
