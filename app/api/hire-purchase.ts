import { apiFetch, apiFetchRaw } from "~/api/client";
import { queryOf, type ExportFormat, type Paginated } from "~/api/query";
import type {
  AgreementStatus,
  HpAgreement,
  HpConfig,
  HpEligibility,
  HpItem,
  HpPayment,
  ItemStatus,
  PaymentChannel,
  TrashedHpAgreement,
  TrashedHpItem,
} from "~/lib/hire-purchase";

/**
 * The `/hire-purchase` endpoints — the largest module in the API by count, and
 * two separate things behind one prefix: the inventory on the shelf, and the
 * agreements written against it. This module imports the API client, so it is
 * server-only. Types and display constants live in `~/lib/hire-purchase`.
 *
 * Office only throughout. Nothing here is a field errand.
 */

export type { ExportFormat, Paginated };

/* --------------------------------------------------------------- inventory --- */

export interface ItemListParams {
  page?: number;
  limit?: number;
  status?: ItemStatus;
  search?: string;
  /** Hide anything with nothing left on the shelf. */
  inStockOnly?: boolean;
  from?: string;
  to?: string;
}

/** GET /hire-purchase/items — the shelf. */
export function listItems(
  accessToken: string,
  params: ItemListParams = {},
): Promise<Paginated<HpItem>> {
  return apiFetch(`/hire-purchase/items${queryOf({ ...params })}`, {
    accessToken,
  });
}

/** GET /hire-purchase/items?format=csv|xlsx */
export function exportItems(
  accessToken: string,
  params: Omit<ItemListParams, "page" | "limit">,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/hire-purchase/items${queryOf({ ...params }, format)}`, {
    accessToken,
  });
}

/** GET /hire-purchase/items/trash — newest-trashed first. */
export function listTrashedItems(
  accessToken: string,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<TrashedHpItem>> {
  return apiFetch(`/hire-purchase/items/trash${queryOf({ ...params })}`, {
    accessToken,
  });
}

/**
 * POST /hire-purchase/items — put something on the shelf.
 *
 * Both prices are stored so the branch can report profit per item. When an item
 * is sold at cost, the same figure goes in twice — the API has no shorthand for
 * it and neither should the form.
 */
export function createItem(
  accessToken: string,
  input: {
    name: string;
    description?: string;
    barcode?: string;
    quantityInStock: number;
    costPrice: number;
    sellingPrice: number;
  },
): Promise<{ item: HpItem }> {
  return apiFetch("/hire-purchase/items", {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * PATCH /hire-purchase/items/{id} — change the prices, the name or the status.
 *
 * Agreements snapshot their prices at signing, so nothing here reaches back
 * into a contract that has already been written. Stock is not editable through
 * this route; it moves through `adjustStock`, which demands a reason.
 */
export function updateItem(
  accessToken: string,
  id: string,
  input: {
    name?: string;
    description?: string;
    barcode?: string;
    costPrice?: number;
    sellingPrice?: number;
    status?: ItemStatus;
  },
): Promise<{ item: HpItem }> {
  return apiFetch(`/hire-purchase/items/${id}`, {
    method: "PATCH",
    json: input,
    accessToken,
  });
}

/**
 * DELETE /hire-purchase/items/{id} — only an item no agreement has ever used.
 * Anything that has been sold on hire purchase stays, because the agreements
 * that reference it stay.
 */
export function trashItem(
  accessToken: string,
  id: string,
  reason?: string,
): Promise<{ item: TrashedHpItem }> {
  return apiFetch(`/hire-purchase/items/${id}`, {
    method: "DELETE",
    json: reason ? { reason } : {},
    accessToken,
  });
}

/** POST /hire-purchase/items/{id}/restore — back onto the shelf. */
export function restoreItem(
  accessToken: string,
  id: string,
): Promise<{ item: HpItem }> {
  return apiFetch(`/hire-purchase/items/${id}/restore`, {
    method: "POST",
    accessToken,
  });
}

/**
 * POST /hire-purchase/items/{id}/adjust-stock — move the count, on the record.
 *
 * `delta` is signed: `+5` for a delivery, `-1` for breakage. The reason is
 * required and audited, because a stock count that can be changed silently is
 * not a stock count. A result below zero is refused with `STOCK_UNDERFLOW`.
 */
export function adjustStock(
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

/* ------------------------------------------------------------------ config --- */

/** GET /hire-purchase/config — the interest rate new agreements are signed at. */
export function getConfig(accessToken: string): Promise<{ config: HpConfig }> {
  return apiFetch("/hire-purchase/config", { accessToken });
}

/**
 * PUT /hire-purchase/config — change that rate. Signed agreements snapshotted
 * theirs and are untouched.
 */
export function updateConfig(
  accessToken: string,
  input: { interestRatePercent: number },
): Promise<{ config: HpConfig }> {
  return apiFetch("/hire-purchase/config", {
    method: "PUT",
    json: input,
    accessToken,
  });
}

/**
 * GET /hire-purchase/eligibility/{customerId} — whether an agreement can be
 * signed at all: an active susu or savings account, three months of saving
 * history, no active loan, and no agreement already open. Loans and hire
 * purchase block each other, which is the condition people forget.
 */
export function getEligibility(
  accessToken: string,
  customerId: string,
): Promise<HpEligibility> {
  return apiFetch(`/hire-purchase/eligibility/${customerId}`, { accessToken });
}

/* -------------------------------------------------------------- agreements --- */

export interface AgreementListParams {
  page?: number;
  limit?: number;
  customerId?: string;
  status?: AgreementStatus;
  search?: string;
  from?: string;
  to?: string;
}

/** GET /hire-purchase/agreements — the contract book. */
export function listAgreements(
  accessToken: string,
  params: AgreementListParams = {},
): Promise<Paginated<HpAgreement>> {
  return apiFetch(`/hire-purchase/agreements${queryOf({ ...params })}`, {
    accessToken,
  });
}

/** GET /hire-purchase/agreements?format=csv|xlsx */
export function exportAgreements(
  accessToken: string,
  params: Omit<AgreementListParams, "page" | "limit">,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(
    `/hire-purchase/agreements${queryOf({ ...params }, format)}`,
    {
      accessToken,
    },
  );
}

/** GET /hire-purchase/agreements/trash — newest-trashed first. */
export function listTrashedAgreements(
  accessToken: string,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<TrashedHpAgreement>> {
  return apiFetch(`/hire-purchase/agreements/trash${queryOf({ ...params })}`, {
    accessToken,
  });
}

/**
 * GET /hire-purchase/agreements/{id} — the agreement with everything paid
 * against it. The spec leaves the envelope open, so the payments array is
 * optional here and the page renders without it rather than breaking.
 */
export function getAgreement(
  accessToken: string,
  id: string,
): Promise<{ agreement: HpAgreement; payments?: HpPayment[] }> {
  return apiFetch(`/hire-purchase/agreements/${id}`, { accessToken });
}

/**
 * POST /hire-purchase/agreements — sign one.
 *
 * A unit comes off the shelf immediately and the prices are snapshotted, but
 * the item does not leave the shop until the 50% deposit is paid. Refused with
 * `OUT_OF_STOCK` when the shelf is empty, and with `NOT_ELIGIBLE` when the
 * customer does not clear the history and no-other-credit conditions.
 */
export function signAgreement(
  accessToken: string,
  input: { customerId: string; itemId: string; durationMonths: number },
): Promise<{ agreement: HpAgreement }> {
  return apiFetch("/hire-purchase/agreements", {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * POST /hire-purchase/agreements/{id}/deposit — the 50%, and the moment the
 * item goes out of the door.
 *
 * The amount must equal `depositRequired` exactly; anything else is
 * `DEPOSIT_MISMATCH`. The idempotency key makes a retry safe. An SMS receipt
 * goes to the customer.
 */
export function recordDeposit(
  accessToken: string,
  id: string,
  input: { amount: number; idempotencyKey: string; channel?: PaymentChannel },
): Promise<{ agreement: HpAgreement; replayed: boolean }> {
  return apiFetch(`/hire-purchase/agreements/${id}/deposit`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/** POST /hire-purchase/agreements/{id}/reject — turn it down; the unit restocks. */
export function rejectAgreement(
  accessToken: string,
  id: string,
  reason: string,
): Promise<{ agreement: HpAgreement }> {
  return apiFetch(`/hire-purchase/agreements/${id}/reject`, {
    method: "POST",
    json: { reason },
    accessToken,
  });
}

/**
 * POST /hire-purchase/agreements/{id}/payments — a monthly instalment.
 *
 * Interest is flat and was applied once at activation, so paying early costs
 * the same as paying to term. Allocated oldest-first; an overpayment is refused
 * with the exact remaining. Settling transfers ownership, and clearing every
 * month-overdue instalment lifts an arrears flag on its own.
 */
export function recordPayment(
  accessToken: string,
  id: string,
  input: { amount: number; idempotencyKey: string; channel?: PaymentChannel },
): Promise<{ agreement: HpAgreement; replayed: boolean }> {
  return apiFetch(`/hire-purchase/agreements/${id}/payments`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * POST /hire-purchase/agreements/{id}/mark-arrears — flag it by hand, and send
 * the warning SMS. Automatic flagging arrives with the Stage B schedules; until
 * then this is an office judgement, which is why it asks for confirmation.
 */
export function markArrears(
  accessToken: string,
  id: string,
): Promise<{ agreement: HpAgreement }> {
  return apiFetch(`/hire-purchase/agreements/${id}/mark-arrears`, {
    method: "POST",
    accessToken,
  });
}

/**
 * POST /hire-purchase/agreements/{id}/repossess — record that the item came
 * back, and start the one-month clock.
 *
 * Everything paid so far is kept. `redemptionDeadline` is the repossession plus
 * exactly one month, and the customer can buy the item back in full until it
 * passes. The reason is required and appears on the agreement from here on.
 */
export function repossess(
  accessToken: string,
  id: string,
  reason: string,
): Promise<{ agreement: HpAgreement }> {
  return apiFetch(`/hire-purchase/agreements/${id}/repossess`, {
    method: "POST",
    json: { reason },
    accessToken,
  });
}

/**
 * POST /hire-purchase/agreements/{id}/redeem — buy it back.
 *
 * The amount is not sent: it is the full remaining balance, computed by the API
 * and returned in the response, so no one at the counter has to work out what
 * redemption costs. Refused once the window has lapsed.
 */
export function redeem(
  accessToken: string,
  id: string,
  input: { idempotencyKey: string; channel?: PaymentChannel },
): Promise<{ agreement: HpAgreement; amount: number; replayed: boolean }> {
  return apiFetch(`/hire-purchase/agreements/${id}/redeem`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * POST /hire-purchase/agreements/{id}/forfeit — close it for good, once the
 * window has lapsed. Refused while it is still open.
 *
 * The item and every payment are forfeited to Yadah. `restock` puts the unit
 * back on the shelf as **used**, at a price the office sets now — a returned
 * fridge is not worth what a new one is, and the API will not guess.
 */
export function forfeit(
  accessToken: string,
  id: string,
  restock?: {
    name?: string;
    description?: string;
    costPrice: number;
    sellingPrice: number;
  },
): Promise<{ agreement: HpAgreement; restockedItem?: HpItem }> {
  return apiFetch(`/hire-purchase/agreements/${id}/forfeit`, {
    method: "POST",
    json: restock ? { restock } : {},
    accessToken,
  });
}

/**
 * DELETE /hire-purchase/agreements/{id} — trash an unpaid pending or rejected
 * agreement. A pending one restocks its unit on the way out.
 */
export function trashAgreement(
  accessToken: string,
  id: string,
  reason?: string,
): Promise<{ agreement: TrashedHpAgreement }> {
  return apiFetch(`/hire-purchase/agreements/${id}`, {
    method: "DELETE",
    json: reason ? { reason } : {},
    accessToken,
  });
}

/**
 * POST /hire-purchase/agreements/{id}/restore — bring it back. A pending one
 * re-reserves a unit, so this is refused when the shelf has emptied meanwhile.
 */
export function restoreAgreement(
  accessToken: string,
  id: string,
): Promise<{ agreement: HpAgreement }> {
  return apiFetch(`/hire-purchase/agreements/${id}/restore`, {
    method: "POST",
    accessToken,
  });
}
