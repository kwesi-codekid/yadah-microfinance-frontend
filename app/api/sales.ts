import { apiFetch, apiFetchRaw } from "~/api/client";
import { queryOf, type ExportFormat } from "~/api/query";
import type { Sale, SaleChannel, SaleStatus, SaleTotals } from "~/lib/sales";

/**
 * The `/hire-purchase/sales` endpoints — the till. This module imports the API
 * client, so it is server-only: call it from loaders and actions. Types and the
 * basket arithmetic live in the client-safe `~/lib/sales`.
 *
 * They live under the hire-purchase prefix because they draw down the same
 * shelf, but a sale is not an agreement and shares none of its lifecycle, so it
 * gets a module of its own rather than four more functions in an already large
 * one. Office only.
 */

export type { ExportFormat };

export interface SaleListParams {
  page?: number;
  limit?: number;
  customerId?: string;
  status?: SaleStatus;
  /** Fuzzy: buyer name, phone, or receipt number. */
  search?: string;
  /** `true` for sales with nobody on the books behind them. */
  walkInOnly?: "true" | "false";
  /** Inclusive Accra day, `YYYY-MM-DD`. */
  from?: string;
  to?: string;
}

/**
 * The listing envelope. Unlike every other list in this API it carries
 * `totals`, and they cover the **whole filter** rather than the page — so the
 * screen must not present them as a page summary.
 */
export interface SaleListResult {
  items: Sale[];
  page: number;
  limit: number;
  total: number;
  totals: SaleTotals;
}

/** GET /hire-purchase/sales — the day book, newest first. */
export function listSales(
  accessToken: string,
  params: SaleListParams = {},
): Promise<SaleListResult> {
  return apiFetch(`/hire-purchase/sales${queryOf({ ...params })}`, { accessToken });
}

/**
 * GET /hire-purchase/sales?format=csv|xlsx — the same listing as a spreadsheet.
 *
 * The download carries cost and profit per sale, which the JSON deliberately
 * never exposes. Pagination is ignored, so the page/limit on screen are not
 * forwarded.
 */
export function exportSales(
  accessToken: string,
  params: Omit<SaleListParams, "page" | "limit">,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/hire-purchase/sales${queryOf({ ...params }, format)}`, {
    accessToken,
  });
}

/** GET /hire-purchase/sales/{id} — one sale with its basket. */
export function getSale(accessToken: string, id: string): Promise<{ sale: Sale }> {
  return apiFetch(`/hire-purchase/sales/${id}`, { accessToken });
}

/**
 * POST /hire-purchase/sales — ring up a basket.
 *
 * Pass `customerId` for someone on the books, or `buyerName` for a walk-in;
 * one or the other, not both required. Per-line `unitPrice` is optional and
 * defaults to the item's selling price — send it only to record a haggled
 * price, which then prints against the list price on the receipt.
 *
 * Stock comes off inside the transaction under a guard, so two tills cannot
 * sell the same unit, and `OUT_OF_STOCK` names the line that failed. Idempotent
 * on the key: a retry after a dropped connection returns the original sale
 * rather than selling the basket twice.
 */
export function createSale(
  accessToken: string,
  input: {
    customerId?: string;
    buyerName?: string;
    buyerPhone?: string;
    lines: { itemId: string; quantity: number; unitPrice?: number }[];
    idempotencyKey: string;
    channel?: SaleChannel;
  },
): Promise<{ sale: Sale; replayed: boolean }> {
  return apiFetch("/hire-purchase/sales", {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * POST /hire-purchase/sales/{id}/void — reverse a sale.
 *
 * The stock goes back and the sale stops counting toward revenue, but the row
 * stays and records who voided it and why: a ledger never forgets, it
 * annotates. Voided sales drop out of the transactions feed and the revenue
 * report. There is no un-void.
 */
export function voidSale(
  accessToken: string,
  id: string,
  reason: string,
): Promise<{ sale: Sale }> {
  return apiFetch(`/hire-purchase/sales/${id}/void`, {
    method: "POST",
    json: { reason },
    accessToken,
  });
}

/**
 * GET /hire-purchase/sales/{id}/receipt — the A4 PDF, one line per basket item.
 *
 * A discounted line shows the list price beside what was charged. A voided sale
 * still prints, stamped VOIDED with its reason. Raw response: the browser holds
 * no access token, so a resource route proxies the body through with the
 * session's.
 */
export function saleReceiptPdf(
  accessToken: string,
  id: string,
): Promise<Response> {
  return apiFetchRaw(`/hire-purchase/sales/${id}/receipt`, { accessToken });
}
