import { apiFetch, apiFetchRaw } from "~/api/client";
import { queryOf, type ExportFormat, type Paginated } from "~/api/query";
import type {
  AgreementStatus,
  DamageCause,
  DamageStatus,
  DamageSummary,
  HpAgreement,
  HpDamage,
  HpConfig,
  HpEligibility,
  HpItem,
  HpPayment,
  ItemCondition,
  ItemLabel,
  ItemStatus,
  LabelKind,
  PaymentChannel,
  PriceChange,
  PriceKind,
  TrashedHpAgreement,
  TrashedHpDamage,
  TrashedHpItem,
} from "~/lib/hire-purchase";
import type {
  ImportOutcome as ItemImportOutcome,
  ImportPreview as ItemImportPreview,
  ImportRow as ItemImportRow,
} from "~/lib/inventory-import";

/**
 * The `/hire-purchase` endpoints — the largest module in the API by count, and
 * two separate things behind one prefix: the inventory on the shelf, and the
 * agreements written against it. This module imports the API client, so it is
 * server-only. Types and display constants live in `~/lib/hire-purchase`.
 *
 * The counter's throughout — the shelf, the sales and the agreements — with
 * the decisions behind an office check on the API's side. Nothing here is a
 * field errand.
 */

export type { ExportFormat, Paginated };

/* --------------------------------------------------------------- inventory --- */

export interface ItemListParams {
  page?: number;
  limit?: number;
  status?: ItemStatus;
  brandId?: string;
  categoryId?: string;
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
    brandId?: string;
    categoryId?: string;
    description?: string;
    quantityInStock: number;
    costPrice: number;
    sellingPrice: number;
    condition?: ItemCondition;
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
    /** Null takes the item off the label. */
    brandId?: string | null;
    categoryId?: string | null;
    description?: string;
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

/**
 * `POST /hire-purchase/items/{id}/receive` — book a delivery.
 *
 * Takes the invoice's unit cost every time. The invoice is the only place the
 * real figure exists, and a delivery is the one moment somebody is holding it;
 * when it disagrees with the shelf, the shelf moves and the move goes on the
 * item's price history with the supplier and invoice that carried it.
 */
export function receiveStock(
  accessToken: string,
  id: string,
  input: {
    quantity: number;
    unitCost: number;
    /** Only when the delivery is also a repricing. */
    sellingPrice?: number;
    supplier?: string;
    invoiceRef?: string;
    receivedOn?: string;
    note?: string;
  },
): Promise<{ item: HpItem; changes: PriceChange[] }> {
  return apiFetch(`/hire-purchase/items/${id}/receive`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/** `GET /hire-purchase/items/{id}/price-changes` — why this item's prices moved. */
export function listPriceChanges(
  accessToken: string,
  id: string,
  params: { page?: number; limit?: number; kind?: PriceKind } = {},
): Promise<Paginated<PriceChange>> {
  return apiFetch(`/hire-purchase/items/${id}/price-changes${queryOf(params)}`, {
    accessToken,
  });
}

/* ---------------------------------------------------------------- damages --- */

export interface DamageList extends Paginated<HpDamage> {
  /** Cost of the APPROVED reports matching the filters. Pending ones are not losses yet. */
  totalCostValue: number;
  pendingCount: number;
}

/**
 * `POST /hire-purchase/damages` — report damaged or missing stock.
 *
 * Counter and office. Writes nothing off: the shelf is untouched until the
 * office approves, so a mistaken report costs only a rejection.
 */
export function reportDamage(
  accessToken: string,
  input: {
    itemId: string;
    quantity: number;
    cause: DamageCause;
    description: string;
    occurredOn?: string;
    photoUrls?: string[];
  },
): Promise<{ damage: HpDamage }> {
  return apiFetch("/hire-purchase/damages", {
    method: "POST",
    json: input,
    accessToken,
  });
}

export function listDamages(
  accessToken: string,
  params: {
    page?: number;
    limit?: number;
    status?: DamageStatus;
    cause?: DamageCause;
    itemId?: string;
    search?: string;
    from?: string;
    to?: string;
  } = {},
): Promise<DamageList> {
  return apiFetch(`/hire-purchase/damages${queryOf(params)}`, { accessToken });
}

export function exportDamages(
  accessToken: string,
  params: Record<string, string | undefined>,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/hire-purchase/damages${queryOf(params, format)}`, { accessToken });
}

export function getDamageSummary(
  accessToken: string,
  range: { from?: string; to?: string } = {},
): Promise<DamageSummary> {
  return apiFetch(`/hire-purchase/damages/summary${queryOf(range)}`, { accessToken });
}

export function getDamage(accessToken: string, id: string): Promise<{ damage: HpDamage }> {
  return apiFetch(`/hire-purchase/damages/${id}`, { accessToken });
}

/** Only while pending — once decided, the report is what was decided on. */
export function updateDamage(
  accessToken: string,
  id: string,
  input: {
    quantity?: number;
    cause?: DamageCause;
    description?: string;
    occurredOn?: string;
    photoUrls?: string[];
  },
): Promise<{ damage: HpDamage }> {
  return apiFetch(`/hire-purchase/damages/${id}`, {
    method: "PATCH",
    json: input,
    accessToken,
  });
}

/**
 * Approve: take the stock off the shelf and strike the loss (office). Refused
 * with `SELF_APPROVAL` when the approver is the person who reported it.
 */
export function approveDamage(
  accessToken: string,
  id: string,
): Promise<{ damage: HpDamage }> {
  return apiFetch(`/hire-purchase/damages/${id}/approve`, {
    method: "POST",
    accessToken,
  });
}

export function rejectDamage(
  accessToken: string,
  id: string,
  reason: string,
): Promise<{ damage: HpDamage }> {
  return apiFetch(`/hire-purchase/damages/${id}/reject`, {
    method: "POST",
    json: { reason },
    accessToken,
  });
}

/** Pending or rejected only — an approved write-off stays on the record. */
export function trashDamage(
  accessToken: string,
  id: string,
  reason?: string,
): Promise<{ damage: TrashedHpDamage }> {
  return apiFetch(`/hire-purchase/damages/${id}`, {
    method: "DELETE",
    json: reason ? { reason } : {},
    accessToken,
  });
}

export function restoreDamage(
  accessToken: string,
  id: string,
): Promise<{ damage: HpDamage }> {
  return apiFetch(`/hire-purchase/damages/${id}/restore`, {
    method: "POST",
    accessToken,
  });
}

/* ------------------------------------------------------ brands, categories --- */

const LABEL_PATH: Record<LabelKind, string> = {
  brand: "/hire-purchase/brands",
  category: "/hire-purchase/categories",
};

/** GET /hire-purchase/{brands|categories} — alphabetical, with item counts. */
export function listLabels(
  accessToken: string,
  kind: LabelKind,
  params: { page?: number; limit?: number; search?: string } = {},
): Promise<Paginated<ItemLabel>> {
  return apiFetch(`${LABEL_PATH[kind]}${queryOf({ ...params })}`, { accessToken });
}

/** Every label of a kind, for a picker. The whole list is short. */
export async function allLabels(
  accessToken: string,
  kind: LabelKind,
): Promise<ItemLabel[]> {
  const page = await listLabels(accessToken, kind, { page: 1, limit: 100 });
  return page.items;
}

/** GET /hire-purchase/{brands|categories}/{id} */
export function getLabel(
  accessToken: string,
  kind: LabelKind,
  id: string,
): Promise<{ label: ItemLabel }> {
  return apiFetch(`${LABEL_PATH[kind]}/${id}`, { accessToken });
}

/** POST — names are unique within a kind, whatever the capitals. `LABEL_TAKEN` otherwise. */
export function createLabel(
  accessToken: string,
  kind: LabelKind,
  input: { name: string; description?: string },
): Promise<{ label: ItemLabel }> {
  return apiFetch(LABEL_PATH[kind], { method: "POST", json: input, accessToken });
}

/** PATCH — a rename reaches every item filed under it. `description: null` clears it. */
export function updateLabel(
  accessToken: string,
  kind: LabelKind,
  id: string,
  input: { name?: string; description?: string | null },
): Promise<{ label: ItemLabel }> {
  return apiFetch(`${LABEL_PATH[kind]}/${id}`, { method: "PATCH", json: input, accessToken });
}

/** DELETE — refused with `LABEL_IN_USE` while any item is still filed under it. */
export function deleteLabel(accessToken: string, kind: LabelKind, id: string): Promise<void> {
  return apiFetch(`${LABEL_PATH[kind]}/${id}`, { method: "DELETE", accessToken });
}

/* ------------------------------------------------------------ bulk import --- */

/** GET /hire-purchase/items/import/template — the blank sheet. Returns the raw response. */
export function itemImportTemplate(
  accessToken: string,
  format: "csv" | "xlsx",
): Promise<Response> {
  return apiFetchRaw(`/hire-purchase/items/import/template?format=${format}`, {
    accessToken,
  });
}

/** POST /hire-purchase/items/import/preview — check a filled sheet. Writes nothing. */
export function previewItemImport(
  accessToken: string,
  file: File,
): Promise<ItemImportPreview> {
  const body = new FormData();
  body.append("file", file);
  return apiFetch("/hire-purchase/items/import/preview", {
    method: "POST",
    formData: body,
    accessToken,
  });
}

/**
 * POST /hire-purchase/items/import — stock the accepted rows, one at a time,
 * so one bad row does not throw away the sheet.
 */
export function runItemImport(
  accessToken: string,
  rows: Pick<ItemImportRow, "row" | "values">[],
): Promise<ItemImportOutcome> {
  return apiFetch("/hire-purchase/items/import", {
    method: "POST",
    json: { rows },
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
 * signed at all: both sides of the ID document on the profile, an active susu
 * or savings account, three months of saving history, no active loan, and no
 * agreement already open. Loans and hire purchase block each other, which is
 * the condition people forget. The customer edit screen reads the same answer
 * to know when the ID scans must stay on the record.
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
  input: {
    customerId: string;
    itemId: string;
    durationMonths: number;
    /** From POST /uploads?kind=signature. */
    signatureUrl: string;
  },
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

/**
 * POST /hire-purchase/agreements/{id}/approve — a manager lets a counter-signed
 * agreement stand.
 *
 * Only an agreement a teller raised is ever in `awaiting-approval`; approving
 * moves it to `pending`, which is where an agreement signed by the office starts,
 * and only then may its deposit be taken. The signing SMS goes out here rather
 * than at signing, so the customer is not told to bring 50% of something a
 * manager has yet to see.
 */
export function approveAgreement(
  accessToken: string,
  id: string,
): Promise<{ agreement: HpAgreement }> {
  return apiFetch(`/hire-purchase/agreements/${id}/approve`, {
    method: "POST",
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

/* --------------------------------------------------------------- receipts --- */

/**
 * GET /hire-purchase/agreements/{id}/payments/{paymentId}/receipt — the
 * printable PDF for a deposit, an instalment or a redemption payment. One
 * endpoint for all three: the same document under a different title. Balances
 * are rebuilt as at that payment, so a reprint does not rewrite history.
 *
 * Raw response: the browser holds no access token, so a resource route proxies
 * the body through with the session's.
 */
export function paymentReceiptPdf(
  accessToken: string,
  id: string,
  paymentId: string,
): Promise<Response> {
  return apiFetchRaw(
    `/hire-purchase/agreements/${id}/payments/${paymentId}/receipt`,
    { accessToken },
  );
}
