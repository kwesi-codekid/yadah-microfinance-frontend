import { apiFetch, apiFetchRaw } from "~/api/client";
import {
  queryOf,
  type ExportFormat,
  type Paginated,
  type StatementFormat,
} from "~/api/query";
import type {
  AssetCategory,
  AssetStatus,
  BalanceSheet,
  CapitalEntry,
  CapitalKind,
  CashAccount,
  CashAccountKind,
  CashChannel,
  CashPosition,
  CashPositionAccount,
  Expense,
  ExpenseCategory,
  ExpenseStatus,
  FixedAsset,
  ProfitAndLoss,
  WriteOffEntityType,
} from "~/lib/accounting";

/**
 * The `/accounting` endpoints — the company's own books. This module imports
 * the API client, so it is server-only: call it from loaders and actions.
 * Types and display constants live in the client-safe `~/lib/accounting`.
 *
 * Office reads all of it. Opening an account, registering or disposing of an
 * asset and recording capital are admin only; recording, approving and paying
 * an expense are office actions, with the one rule that nobody approves what
 * they recorded themselves.
 *
 * Four of these endpoints are undocumented in the spec beyond `any` — the
 * account list, the cash position, the asset register and the capital list —
 * so their readers below normalise whatever envelope comes back rather than
 * trusting one shape.
 */

export type { ExportFormat, Paginated, StatementFormat };

/* -------------------------------------------------------------- envelopes --- */

/**
 * A list that may arrive as `{ items }`, `{ accounts }`, `{ entries }`, or a
 * bare array. The spec does not say which; the screen must not care.
 */
function itemsOf<T>(payload: unknown, ...keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of [...keys, "items", "data"]) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  return [];
}

/** A paginated envelope, tolerating a bare array for the undocumented lists. */
function paginatedOf<T>(payload: unknown, ...keys: string[]): Paginated<T> {
  const items = itemsOf<T>(payload, ...keys);
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  return {
    items,
    page: Number(record.page ?? 1) || 1,
    limit: Number(record.limit ?? items.length) || items.length,
    total: Number(record.total ?? items.length) || items.length,
  };
}

/* ---------------------------------------------------------- cash accounts --- */

/** GET /accounting/cash-accounts — the company's own accounts. */
export async function listCashAccounts(accessToken: string): Promise<CashAccount[]> {
  const payload = await apiFetch<unknown>("/accounting/cash-accounts", { accessToken });
  return itemsOf<CashAccount>(payload, "accounts");
}

/**
 * POST /accounting/cash-accounts — open one with its opening balance (admin).
 *
 * At most one active account per channel: customer money is tied to an account
 * by the channel it was recorded on, so two accounts on one channel would each
 * claim the same transactions and double the cash position. The API answers a
 * second with `409`. The opening balance is where every statement starts
 * counting from — set it once, from a reconciled figure — and record the
 * matching opening capital too, or the balance sheet reports the unmatched
 * cash as a non-zero `checkDifference`.
 */
export function openCashAccount(
  accessToken: string,
  input: {
    name: string;
    kind: CashAccountKind;
    channel: CashChannel;
    openingBalance: number;
    openingDate: string;
    bankName?: string;
    accountNumber?: string;
  },
): Promise<{ account: CashAccount }> {
  return apiFetch("/accounting/cash-accounts", {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * GET /accounting/cash-position — what each account holds, and the total.
 *
 * Derived on every read from the opening balance and every movement since;
 * nothing keeps a running total. `asOf` reads the position on a past day.
 */
export async function getCashPosition(
  accessToken: string,
  params: { asOf?: string } = {},
): Promise<CashPosition> {
  const payload = await apiFetch<unknown>(
    `/accounting/cash-position${queryOf({ ...params })}`,
    { accessToken },
  );
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const accounts = itemsOf<CashPositionAccount>(payload, "accounts", "positions").map(
    (a) => ({ ...a, balance: Number(a.balance ?? 0) }),
  );
  const total =
    typeof record.total === "number"
      ? record.total
      : accounts.reduce((sum, a) => sum + a.balance, 0);
  return {
    asOf: String(record.asOf ?? params.asOf ?? ""),
    accounts,
    total,
  };
}

/* ---------------------------------------------------------------- expenses --- */

export interface ExpenseListParams {
  page?: number;
  limit?: number;
  category?: ExpenseCategory;
  status?: ExpenseStatus;
  cashAccountId?: string;
  search?: string;
  /** Inclusive Accra day, `YYYY-MM-DD`, on when the cost was incurred. */
  from?: string;
  to?: string;
}

/** GET /accounting/expenses — filtered by category, status, account or date. */
export async function listExpenses(
  accessToken: string,
  params: ExpenseListParams = {},
): Promise<Paginated<Expense>> {
  const payload = await apiFetch<unknown>(
    `/accounting/expenses${queryOf({ ...params })}`,
    { accessToken },
  );
  return paginatedOf<Expense>(payload, "expenses");
}

/** GET /accounting/expenses?format=csv|xlsx — the same list as a download. */
export function exportExpenses(
  accessToken: string,
  params: Omit<ExpenseListParams, "page" | "limit">,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/accounting/expenses${queryOf({ ...params }, format)}`, {
    accessToken,
  });
}

/**
 * POST /accounting/expenses — record a cost.
 *
 * Recording does not move money; only paying does, which is why paying is the
 * step that names an account. `incurredOn` is the day the cost belongs to,
 * which is not always the day it is paid: August salaries settled in September
 * are an August cost.
 */
export function recordExpense(
  accessToken: string,
  input: {
    category: ExpenseCategory;
    description: string;
    amount: number;
    payee?: string;
    incurredOn: string;
    receiptUrl?: string;
    reference?: string;
    writeOffEntityType?: WriteOffEntityType;
    writeOffEntityId?: string;
  },
): Promise<{ expense: Expense }> {
  return apiFetch("/accounting/expenses", {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * POST /accounting/expenses/{id}/approve — refused with `403` when the approver
 * is the person who recorded it, and `409` once it has already been decided.
 */
export function approveExpense(
  accessToken: string,
  id: string,
): Promise<{ expense: Expense }> {
  return apiFetch(`/accounting/expenses/${id}/approve`, {
    method: "POST",
    json: {},
    accessToken,
  });
}

/** POST /accounting/expenses/{id}/reject — decline it. Nothing moves. */
export function rejectExpense(
  accessToken: string,
  id: string,
  reason: string,
): Promise<{ expense: Expense }> {
  return apiFetch(`/accounting/expenses/${id}/reject`, {
    method: "POST",
    json: { reason },
    accessToken,
  });
}

/**
 * POST /accounting/expenses/{id}/pay — the only step that moves money. Until
 * it runs the expense sits as a liability on the balance sheet. `422` when it
 * is not approved, or when `paidOn` is before the account opened.
 */
export function payExpense(
  accessToken: string,
  id: string,
  input: { cashAccountId: string; paidOn?: string },
): Promise<{ expense: Expense }> {
  return apiFetch(`/accounting/expenses/${id}/pay`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/* ------------------------------------------------------------ fixed assets --- */

export interface AssetListParams {
  page?: number;
  limit?: number;
  category?: AssetCategory;
  status?: AssetStatus;
  /** The day depreciation is computed as at. Defaults to today. */
  asOf?: string;
}

/** GET /accounting/fixed-assets — the register, depreciated as at `asOf`. */
export async function listAssets(
  accessToken: string,
  params: AssetListParams = {},
): Promise<Paginated<FixedAsset> & { asOf?: string }> {
  const payload = await apiFetch<unknown>(
    `/accounting/fixed-assets${queryOf({ ...params })}`,
    { accessToken },
  );
  const page = paginatedOf<FixedAsset>(payload, "assets");
  const asOf =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as { asOf?: string }).asOf
      : undefined;
  return { ...page, asOf };
}

/** GET /accounting/fixed-assets?format=csv|xlsx — the register as a download. */
export function exportAssets(
  accessToken: string,
  params: Omit<AssetListParams, "page" | "limit">,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/accounting/fixed-assets${queryOf({ ...params }, format)}`, {
    accessToken,
  });
}

/**
 * POST /accounting/fixed-assets — register one (admin).
 *
 * A motorbike or a computer is an asset, not an expense: buying one converts
 * cash into something of equal value, and only the monthly depreciation
 * reaches profit and loss. Name `cashAccountId` when the purchase left a
 * company account, so the cash position drops by the cost. `422` when the
 * salvage value is not below cost.
 */
export function registerAsset(
  accessToken: string,
  input: {
    name: string;
    category: AssetCategory;
    cost: number;
    acquiredOn: string;
    usefulLifeMonths: number;
    salvageValue?: number;
    cashAccountId?: string;
    serialNumber?: string;
    assignedToId?: string;
  },
): Promise<{ asset: FixedAsset }> {
  return apiFetch("/accounting/fixed-assets", {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * POST /accounting/fixed-assets/{id}/dispose — off the balance sheet from that
 * day (admin). Proceeds are money back in, never a negative expense.
 */
export function disposeAsset(
  accessToken: string,
  id: string,
  input: {
    disposedOn?: string;
    disposalProceeds?: number;
    cashAccountId?: string;
    note?: string;
  },
): Promise<{ asset: FixedAsset }> {
  return apiFetch(`/accounting/fixed-assets/${id}/dispose`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/* ----------------------------------------------------------------- capital --- */

/** GET /accounting/capital — owner contributions and drawings. */
export async function listCapital(accessToken: string): Promise<CapitalEntry[]> {
  const payload = await apiFetch<unknown>("/accounting/capital", { accessToken });
  return itemsOf<CapitalEntry>(payload, "entries", "capital");
}

/**
 * POST /accounting/capital — owner money in or out (admin). Neither is income
 * or an expense: both move equity, not profit. The opening capital at go-live
 * is simply the first contribution.
 */
export function recordCapital(
  accessToken: string,
  input: {
    kind: CapitalKind;
    amount: number;
    occurredOn: string;
    cashAccountId?: string;
    note?: string;
  },
): Promise<{ entry: CapitalEntry }> {
  return apiFetch("/accounting/capital", {
    method: "POST",
    json: input,
    accessToken,
  });
}

/* -------------------------------------------------------------- statements --- */

/** GET /accounting/balance-sheet — what the business owns, owes and is worth on one day. */
export function getBalanceSheet(
  accessToken: string,
  params: { asOf?: string } = {},
): Promise<BalanceSheet> {
  return apiFetch(`/accounting/balance-sheet${queryOf({ ...params })}`, {
    accessToken,
  });
}

/**
 * GET /accounting/balance-sheet?format=csv|xlsx|pdf. The PDF is a laid-out A4
 * statement on Yadah letterhead, ready to hand to the client.
 */
export function exportBalanceSheet(
  accessToken: string,
  params: { asOf?: string },
  format: StatementFormat,
): Promise<Response> {
  return apiFetchRaw(`/accounting/balance-sheet${queryOf({ ...params }, format)}`, {
    accessToken,
  });
}

/**
 * GET /accounting/profit-loss — income and expenses over a period. Defaults to
 * the current Accra month when no range is given.
 */
export function getProfitAndLoss(
  accessToken: string,
  params: { from?: string; to?: string } = {},
): Promise<ProfitAndLoss> {
  return apiFetch(`/accounting/profit-loss${queryOf({ ...params })}`, {
    accessToken,
  });
}

/** GET /accounting/profit-loss?format=csv|xlsx|pdf. */
export function exportProfitAndLoss(
  accessToken: string,
  params: { from?: string; to?: string },
  format: StatementFormat,
): Promise<Response> {
  return apiFetchRaw(`/accounting/profit-loss${queryOf({ ...params }, format)}`, {
    accessToken,
  });
}
