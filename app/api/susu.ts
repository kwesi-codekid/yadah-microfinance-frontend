import { apiFetch, apiFetchRaw } from "~/api/client";
import { queryOf, type ExportFormat, type Paginated } from "~/api/query";
import type {
  CycleMonth,
  DepositChannel,
  SusuAccount,
  SusuDeposit,
  SusuStatus,
  SusuSummary,
  TrashedSusuAccount,
  TrashedSusuDeposit,
} from "~/lib/susu";
import type { DepositResult } from "~/lib/susu";

/**
 * The `/susu` endpoints. This module imports the API client, so it is
 * server-only: call it from loaders and actions. Types and display constants
 * live in the client-safe `~/lib/susu`.
 *
 * Recording money is open to collectors as well as the office; everything that
 * changes an account's shape — opening, closing, paying out, correcting — is
 * office only and the API answers a collector with `403 FORBIDDEN`.
 */

export type { ExportFormat, Paginated };

export interface AccountListParams {
  page?: number;
  limit?: number;
  customerId?: string;
  status?: SusuStatus;
  /** The full `SU` number, or the bare six digits: `^(SU\d{8}|\d{6})$`. */
  accountNumber?: string;
  /** Fuzzy and typo-tolerant: customer name, phone, or account-number prefix. */
  search?: string;
  /** Inclusive Accra day, `YYYY-MM-DD`, on when the account was opened. */
  from?: string;
  to?: string;
}


/* ---------------------------------------------------------------- accounts --- */

/** GET /susu/accounts — every role sees every account. */
export function listAccounts(
  accessToken: string,
  params: AccountListParams = {},
): Promise<Paginated<SusuAccount>> {
  return apiFetch(`/susu/accounts${queryOf({ ...params })}`, { accessToken });
}

/** GET /susu/accounts?format=csv|xlsx — pagination ignored, capped at 10,000. */
export function exportAccounts(
  accessToken: string,
  params: Omit<AccountListParams, "page" | "limit">,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/susu/accounts${queryOf({ ...params }, format)}`, {
    accessToken,
  });
}

/** GET /susu/accounts/trash — soft-deleted accounts, newest first (office). */
export function listTrashedAccounts(
  accessToken: string,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<TrashedSusuAccount>> {
  return apiFetch(`/susu/accounts/trash${queryOf({ ...params })}`, { accessToken });
}

/** GET /susu/accounts/{id} — the account, with its cycle progress. */
export function getAccount(
  accessToken: string,
  id: string,
): Promise<{ account: SusuAccount }> {
  return apiFetch(`/susu/accounts/${id}`, { accessToken });
}

/**
 * POST /susu/accounts — open one cycle (office). The daily amount is fixed for
 * the life of the account; a customer may hold several concurrently.
 */
export function openAccount(
  accessToken: string,
  input: { customerId: string; dailyAmount: number; cycleMonth?: CycleMonth },
): Promise<{ account: SusuAccount }> {
  return apiFetch("/susu/accounts", { method: "POST", json: input, accessToken });
}

/**
 * DELETE /susu/accounts/{id} — trash an account that was never used (office).
 * Refused with `CANNOT_TRASH` once anything has been deposited; a used account
 * has to be closed or terminated instead.
 */
export function trashAccount(
  accessToken: string,
  id: string,
  reason?: string,
): Promise<{ account: TrashedSusuAccount }> {
  return apiFetch(`/susu/accounts/${id}`, {
    method: "DELETE",
    json: reason ? { reason } : {},
    accessToken,
  });
}

/** POST /susu/accounts/{id}/restore — bring one back out of the trash (office). */
export function restoreAccount(
  accessToken: string,
  id: string,
): Promise<{ account: SusuAccount }> {
  return apiFetch(`/susu/accounts/${id}/restore`, { method: "POST", accessToken });
}

/* ---------------------------------------------------------------- deposits --- */

export interface DepositListParams {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
}

/** GET /susu/accounts/{id}/deposits — the statement, newest first. */
export function listDeposits(
  accessToken: string,
  id: string,
  params: DepositListParams = {},
): Promise<Paginated<SusuDeposit>> {
  return apiFetch(`/susu/accounts/${id}/deposits${queryOf({ ...params })}`, {
    accessToken,
  });
}

/** GET /susu/accounts/{id}/deposits?format=csv|xlsx */
export function exportDeposits(
  accessToken: string,
  id: string,
  params: Omit<DepositListParams, "page" | "limit">,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(
    `/susu/accounts/${id}/deposits${queryOf({ ...params }, format)}`,
    { accessToken },
  );
}

/** GET /susu/accounts/{id}/deposits/trash (office). */
export function listTrashedDeposits(
  accessToken: string,
  id: string,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<TrashedSusuDeposit>> {
  return apiFetch(`/susu/accounts/${id}/deposits/trash${queryOf({ ...params })}`, {
    accessToken,
  });
}

/**
 * POST /susu/accounts/{id}/deposits — record the cash handed over. The days
 * covered are derived from the amount, so it must be a whole multiple of the
 * daily amount. The idempotency key is what makes a retry safe: the same key
 * returns the original deposit with `200` rather than recording it twice.
 */
export function recordDeposit(
  accessToken: string,
  id: string,
  input: { amount: number; idempotencyKey: string; channel?: DepositChannel },
): Promise<DepositResult> {
  return apiFetch(`/susu/accounts/${id}/deposits`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * PATCH — correct the most recent deposit's amount (office). Data-entry fixes
 * only: the days covered are re-derived and the cycle counters adjust with it,
 * including un-completing a cycle. Transfer-created deposits are immutable.
 */
export function correctDeposit(
  accessToken: string,
  id: string,
  depositId: string,
  amount: number,
): Promise<{ deposit: SusuDeposit; account: SusuAccount; replayed?: boolean }> {
  return apiFetch(`/susu/accounts/${id}/deposits/${depositId}`, {
    method: "PATCH",
    json: { amount },
    accessToken,
  });
}

/** DELETE — trash the most recent deposit, reversing the counters (office). */
export function trashDeposit(
  accessToken: string,
  id: string,
  depositId: string,
  reason?: string,
): Promise<{ deposit: TrashedSusuDeposit; account: SusuAccount }> {
  return apiFetch(`/susu/accounts/${id}/deposits/${depositId}`, {
    method: "DELETE",
    json: reason ? { reason } : {},
    accessToken,
  });
}

/**
 * POST — re-apply a trashed deposit (office). Only while its positions in the
 * cycle are still free: anything recorded since has taken them.
 */
export function restoreDeposit(
  accessToken: string,
  id: string,
  depositId: string,
): Promise<{ deposit: SusuDeposit; account: SusuAccount }> {
  return apiFetch(`/susu/accounts/${id}/deposits/${depositId}/restore`, {
    method: "POST",
    accessToken,
  });
}

/**
 * POST /susu/collect-all — one day into every active account the customer
 * holds, all or nothing. The amount must equal the sum of those accounts'
 * daily amounts; a mismatch comes back with the required total and the
 * per-account breakdown, which the UI shows rather than swallows.
 */
export function collectAll(
  accessToken: string,
  input: {
    customerId: string;
    amount: number;
    idempotencyKey: string;
    channel?: DepositChannel;
  },
): Promise<{
  batchId: string;
  totalAmount: number;
  deposits: SusuDeposit[];
  accounts: SusuAccount[];
  replayed: boolean;
}> {
  return apiFetch("/susu/collect-all", { method: "POST", json: input, accessToken });
}

/* --------------------------------------------------------------- lifecycle --- */

/**
 * POST /susu/accounts/{id}/close — pay out and close (office). The customer
 * receives everything deposited less exactly one day's commission, whatever
 * day they leave on. Refused with `COMMISSION_NOT_COVERED` when the deposits
 * do not reach one day; that account can only be terminated.
 */
export function closeAccount(
  accessToken: string,
  id: string,
): Promise<{
  account: SusuAccount;
  commission: number;
  payout: number;
  flagged: boolean;
}> {
  return apiFetch(`/susu/accounts/${id}/close`, { method: "POST", accessToken });
}

/**
 * POST /susu/accounts/{id}/terminate — refund everything, take no commission
 * (office). The escape hatch for accounts holding less than one day's deposit,
 * including empty ones. Accounts that can cover the commission must be closed.
 */
export function terminateAccount(
  accessToken: string,
  id: string,
): Promise<{ account: SusuAccount; refund: number }> {
  return apiFetch(`/susu/accounts/${id}/terminate`, { method: "POST", accessToken });
}

/**
 * POST /susu/accounts/{id}/withdraw — hand part of the balance back and leave
 * the account open (office).
 *
 * Client decision of 2026-08-21, replacing the rule that any withdrawal closed
 * the account. Nothing about the cycle moves: days already paid stay paid, so
 * `depositsCount` and the 31-day target are untouched, and **no commission is
 * taken here** — the commission is one cycle-day's amount, charged once, at
 * closure. Which is why one day's amount stays reserved: `availableToWithdraw`
 * is `balance − dailyAmount`, so the closing commission is still collectible.
 *
 * Idempotent on the key, and the customer gets an SMS saying the account is
 * still open — the part they would otherwise ring the branch about. A replay
 * comes back as `200 {}` — an empty body, not the original figures — so the
 * absence of `account` is what says nothing new was paid.
 */
export function withdraw(
  accessToken: string,
  id: string,
  input: { amount: number; idempotencyKey: string },
): Promise<{ account?: SusuAccount; amount?: number; replayed?: boolean }> {
  return apiFetch(`/susu/accounts/${id}/withdraw`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * POST /susu/accounts/{id}/payout — hand over cash still owed on a
 * `pending-payout` account (office). Omit the amount to pay out everything;
 * the account closes when nothing is left.
 */
export function payoutAccount(
  accessToken: string,
  id: string,
  input: { idempotencyKey: string; amount?: number },
): Promise<{ account: SusuAccount; amount: number; replayed: boolean }> {
  return apiFetch(`/susu/accounts/${id}/payout`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/* --------------------------------------------------------------- receipts --- */

/**
 * GET /susu/accounts/{id}/deposits/{depositId}/receipt — the printable PDF.
 * Raw response: the browser holds no access token, so a resource route proxies
 * the body through with the session's.
 */
export function depositReceiptPdf(
  accessToken: string,
  id: string,
  depositId: string,
): Promise<Response> {
  return apiFetchRaw(`/susu/accounts/${id}/deposits/${depositId}/receipt`, {
    accessToken,
  });
}

/**
 * GET /susu/accounts/{id}/withdrawals/{payoutId}/receipt — the printable PDF
 * for a partial withdrawal or a payout. Both go through this one endpoint.
 */
export function withdrawalReceiptPdf(
  accessToken: string,
  id: string,
  payoutId: string,
): Promise<Response> {
  return apiFetchRaw(`/susu/accounts/${id}/withdrawals/${payoutId}/receipt`, {
    accessToken,
  });
}

/**
 * GET /susu/summary — one Accra day's collection, for cashing up. Collectors
 * see only their own; the office may name a collector or omit it for everyone.
 */
export function getSummary(
  accessToken: string,
  params: { date?: string; collectorId?: string } = {},
): Promise<SusuSummary> {
  return apiFetch(`/susu/summary${queryOf({ ...params })}`, { accessToken });
}
