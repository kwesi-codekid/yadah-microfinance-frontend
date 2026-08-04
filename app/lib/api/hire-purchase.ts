import { apiFetch } from "~/lib/api/client";
import type {
  HpAgreement,
  HpAgreementStatus,
  HpChannel,
  HpItem,
  HpItemStatus,
} from "~/lib/hp-client";

export interface HpItemListResult {
  items: HpItem[];
  page: number;
  limit: number;
  total: number;
}

export interface ListHpItemsParams {
  page?: number;
  limit?: number;
  status?: HpItemStatus;
  search?: string;
  /** Hides anything at zero, for the signing flow. */
  inStockOnly?: boolean;
}

/** GET /hire-purchase/items */
export function listHpItems(
  accessToken: string,
  params: ListHpItemsParams = {},
): Promise<HpItemListResult> {
  const q = new URLSearchParams();
  if (params.page) q.set("page", String(params.page));
  if (params.limit) q.set("limit", String(params.limit));
  if (params.status) q.set("status", params.status);
  if (params.search) q.set("search", params.search);
  if (params.inStockOnly) q.set("inStockOnly", "true");
  const qs = q.toString();
  return apiFetch<HpItemListResult>(
    `/hire-purchase/items${qs ? `?${qs}` : ""}`,
    { accessToken },
  );
}

export interface CreateHpItemInput {
  name: string;
  description?: string;
  quantityInStock: number;
  /** Both prices are pesewas. Cost is stored for profit reporting. */
  costPrice: number;
  sellingPrice: number;
}

/** POST /hire-purchase/items */
export function createHpItem(
  accessToken: string,
  input: CreateHpItemInput,
): Promise<{ item: HpItem }> {
  return apiFetch("/hire-purchase/items", {
    method: "POST",
    json: input,
    accessToken,
  });
}

export interface UpdateHpItemInput {
  name?: string;
  description?: string;
  costPrice?: number;
  sellingPrice?: number;
  status?: HpItemStatus;
}

/**
 * PATCH /hire-purchase/items/{id} — never touches signed agreements, which
 * snapshot their prices at signing. Stock moves through `adjustHpStock`.
 */
export function updateHpItem(
  accessToken: string,
  id: string,
  input: UpdateHpItemInput,
): Promise<{ item: HpItem }> {
  return apiFetch(`/hire-purchase/items/${id}`, {
    method: "PATCH",
    json: input,
    accessToken,
  });
}

/** POST /hire-purchase/items/{id}/adjust-stock — audited, so a reason is required. */
export function adjustHpStock(
  accessToken: string,
  id: string,
  input: { delta: number; reason: string },
): Promise<{ item: HpItem }> {
  return apiFetch(`/hire-purchase/items/${id}/adjust-stock`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/** GET /hire-purchase/config — shape undeclared in the spec, like the loans one. */
export function getHpConfig(accessToken: string): Promise<{ config: unknown }> {
  return apiFetch("/hire-purchase/config", { accessToken });
}

/** PUT /hire-purchase/config */
export function updateHpConfig(
  accessToken: string,
  input: { interestRatePercent: number },
): Promise<{ config: unknown }> {
  return apiFetch("/hire-purchase/config", {
    method: "PUT",
    json: input,
    accessToken,
  });
}

/** GET /hire-purchase/eligibility/{customerId} — undeclared shape; read defensively. */
export function getHpEligibility(
  accessToken: string,
  customerId: string,
): Promise<unknown> {
  return apiFetch(`/hire-purchase/eligibility/${customerId}`, { accessToken });
}

export interface HpAgreementListResult {
  items: HpAgreement[];
  page: number;
  limit: number;
  total: number;
}

export interface ListHpAgreementsParams {
  page?: number;
  limit?: number;
  customerId?: string;
  status?: HpAgreementStatus;
  search?: string;
}

/** GET /hire-purchase/agreements */
export function listHpAgreements(
  accessToken: string,
  params: ListHpAgreementsParams = {},
): Promise<HpAgreementListResult> {
  const q = new URLSearchParams();
  if (params.page) q.set("page", String(params.page));
  if (params.limit) q.set("limit", String(params.limit));
  if (params.customerId) q.set("customerId", params.customerId);
  if (params.status) q.set("status", params.status);
  if (params.search) q.set("search", params.search);
  const qs = q.toString();
  return apiFetch<HpAgreementListResult>(
    `/hire-purchase/agreements${qs ? `?${qs}` : ""}`,
    { accessToken },
  );
}

/** GET /hire-purchase/agreements/{id} — undeclared shape; `agreement` is what it holds. */
export function getHpAgreement(
  accessToken: string,
  id: string,
): Promise<{ agreement?: HpAgreement } & Record<string, unknown>> {
  return apiFetch(`/hire-purchase/agreements/${id}`, { accessToken });
}

/** POST /hire-purchase/agreements — decrements stock and snapshots prices. */
export function signHpAgreement(
  accessToken: string,
  input: { customerId: string; itemId: string; durationMonths: number },
): Promise<{ agreement: HpAgreement }> {
  return apiFetch("/hire-purchase/agreements", {
    method: "POST",
    json: input,
    accessToken,
  });
}

export interface HpPaymentInput {
  amount: number;
  /** 8–128 chars, from `newIdempotencyKey()`. Required. */
  idempotencyKey: string;
  channel?: HpChannel;
}

export interface HpPaymentResult {
  agreement: HpAgreement;
  /** True when the API replayed an earlier identical request. */
  replayed: boolean;
}

/** POST /hire-purchase/agreements/{id}/deposit — the 50% that releases the item. */
export function recordHpDeposit(
  accessToken: string,
  id: string,
  input: HpPaymentInput,
): Promise<HpPaymentResult> {
  return apiFetch(`/hire-purchase/agreements/${id}/deposit`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/** POST /hire-purchase/agreements/{id}/payments — a monthly payment. */
export function recordHpPayment(
  accessToken: string,
  id: string,
  input: HpPaymentInput,
): Promise<HpPaymentResult> {
  return apiFetch(`/hire-purchase/agreements/${id}/payments`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/** POST /hire-purchase/agreements/{id}/reject — restores the stock. */
export function rejectHpAgreement(
  accessToken: string,
  id: string,
  input: { reason: string },
): Promise<{ agreement: HpAgreement }> {
  return apiFetch(`/hire-purchase/agreements/${id}/reject`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/** POST /hire-purchase/agreements/{id}/mark-arrears — sends the warning SMS. */
export function markHpArrears(
  accessToken: string,
  id: string,
): Promise<{ agreement: HpAgreement }> {
  return apiFetch(`/hire-purchase/agreements/${id}/mark-arrears`, {
    method: "POST",
    accessToken,
  });
}

/** POST /hire-purchase/agreements/{id}/repossess — starts the one-month window. */
export function repossessHpAgreement(
  accessToken: string,
  id: string,
  input: { reason: string },
): Promise<{ agreement: HpAgreement }> {
  return apiFetch(`/hire-purchase/agreements/${id}/repossess`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * POST /hire-purchase/agreements/{id}/redeem — pays the whole remaining
 * balance and transfers ownership. The amount is the API's to compute.
 */
export function redeemHpAgreement(
  accessToken: string,
  id: string,
  input: { idempotencyKey: string; channel?: HpChannel },
): Promise<HpPaymentResult> {
  return apiFetch(`/hire-purchase/agreements/${id}/redeem`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

export interface HpRestockInput {
  name?: string;
  description?: string;
  costPrice: number;
  sellingPrice: number;
}

/** POST /hire-purchase/agreements/{id}/forfeit — refused while the window is open. */
export function forfeitHpAgreement(
  accessToken: string,
  id: string,
  input: { restock?: HpRestockInput } = {},
): Promise<{ agreement: HpAgreement }> {
  return apiFetch(`/hire-purchase/agreements/${id}/forfeit`, {
    method: "POST",
    json: input,
    accessToken,
  });
}
