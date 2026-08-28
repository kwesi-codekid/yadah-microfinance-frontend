import { apiFetch, apiFetchRaw } from "~/api/client";
import { queryOf, type ExportFormat, type Paginated } from "~/api/query";
import type {
  SavingsAccount,
  SavingsAccountType,
  SavingsChannel,
  SavingsStatus,
  SavingsTxn,
  TrashedSavingsAccount,
  TrashedSavingsTxn,
} from "~/lib/savings";

/**
 * The `/savings` endpoints. This module imports the API client, so it is
 * server-only: call it from loaders and actions. Types and display constants
 * live in the client-safe `~/lib/savings`.
 *
 * Taking money in is open to collectors as well as the office. Everything that
 * hands money back or changes the account's shape — withdrawing, closing,
 * trashing, correcting — is office only, and the API answers a collector with
 * `403 FORBIDDEN`.
 */

export type { ExportFormat, Paginated };

export interface AccountListParams {
  page?: number;
  limit?: number;
  customerId?: string;
  accountType?: SavingsAccountType;
  status?: SavingsStatus;
  /** The full `SV` number, or the bare ten digits: `^(SV\d{8}|\d{10})$`. */
  accountNumber?: string;
  /** Fuzzy and typo-tolerant: customer name, phone, or account-number prefix. */
  search?: string;
  /** Inclusive Accra day, `YYYY-MM-DD`, on when the account was opened. */
  from?: string;
  to?: string;
}


/* ---------------------------------------------------------------- accounts --- */

/** GET /savings/accounts — every role sees every account. */
export function listAccounts(
  accessToken: string,
  params: AccountListParams = {},
): Promise<Paginated<SavingsAccount>> {
  return apiFetch(`/savings/accounts${queryOf({ ...params })}`, { accessToken });
}

/** GET /savings/accounts?format=csv|xlsx — pagination ignored, capped at 10,000. */
export function exportAccounts(
  accessToken: string,
  params: Omit<AccountListParams, "page" | "limit">,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/savings/accounts${queryOf({ ...params }, format)}`, {
    accessToken,
  });
}

/** GET /savings/accounts/trash — soft-deleted accounts, newest first (office). */
export function listTrashedAccounts(
  accessToken: string,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<TrashedSavingsAccount>> {
  return apiFetch(`/savings/accounts/trash${queryOf({ ...params })}`, {
    accessToken,
  });
}

/** GET /savings/accounts/{id} — the account, including `availableToWithdraw`. */
export function getAccount(
  accessToken: string,
  id: string,
): Promise<{ account: SavingsAccount }> {
  return apiFetch(`/savings/accounts/${id}`, { accessToken });
}

/**
 * POST /savings/accounts — open one (office). An `initialDeposit` is recorded
 * in the same transaction as the opening, so the account is never briefly open
 * and empty; it obeys the GHS 5 floor like any other deposit and therefore
 * needs an idempotency key of its own.
 */
export function openAccount(
  accessToken: string,
  input: {
    customerId: string;
    accountType?: SavingsAccountType;
    initialDeposit?: number;
    idempotencyKey?: string;
    channel?: SavingsChannel;
  },
): Promise<{ account: SavingsAccount; initialTxn?: SavingsTxn }> {
  return apiFetch("/savings/accounts", {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * DELETE /savings/accounts/{id} — trash an account that was never used
 * (office). Refused with `CANNOT_TRASH` once it holds a balance, has ever had a
 * transaction, or has been closed; a used account is closed, not trashed.
 */
export function trashAccount(
  accessToken: string,
  id: string,
  reason?: string,
): Promise<{ account: TrashedSavingsAccount }> {
  return apiFetch(`/savings/accounts/${id}`, {
    method: "DELETE",
    json: reason ? { reason } : {},
    accessToken,
  });
}

/** POST /savings/accounts/{id}/restore — bring one back out of the trash (office). */
export function restoreAccount(
  accessToken: string,
  id: string,
): Promise<{ account: SavingsAccount }> {
  return apiFetch(`/savings/accounts/${id}/restore`, {
    method: "POST",
    accessToken,
  });
}

/* ------------------------------------------------------------ transactions --- */

export interface TxnListParams {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
}

/** GET /savings/accounts/{id}/transactions — the statement, newest first. */
export function listTxns(
  accessToken: string,
  id: string,
  params: TxnListParams = {},
): Promise<Paginated<SavingsTxn>> {
  return apiFetch(`/savings/accounts/${id}/transactions${queryOf({ ...params })}`, {
    accessToken,
  });
}

/** GET /savings/accounts/{id}/transactions?format=csv|xlsx */
export function exportTxns(
  accessToken: string,
  id: string,
  params: Omit<TxnListParams, "page" | "limit">,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(
    `/savings/accounts/${id}/transactions${queryOf({ ...params }, format)}`,
    { accessToken },
  );
}

/** GET /savings/accounts/{id}/transactions/trash (office). */
export function listTrashedTxns(
  accessToken: string,
  id: string,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<TrashedSavingsTxn>> {
  return apiFetch(
    `/savings/accounts/${id}/transactions/trash${queryOf({ ...params })}`,
    { accessToken },
  );
}

/**
 * DELETE — trash the newest live deposit or withdrawal, reversing its effect on
 * the balance atomically (office). Closures and transfer-created rows are
 * immutable. Trashing a withdrawal gives its one-a-day slot back.
 */
export function trashTxn(
  accessToken: string,
  id: string,
  txnId: string,
  reason?: string,
): Promise<{ txn: TrashedSavingsTxn; account: SavingsAccount }> {
  return apiFetch(`/savings/accounts/${id}/transactions/${txnId}`, {
    method: "DELETE",
    json: reason ? { reason } : {},
    accessToken,
  });
}

/**
 * POST — re-apply a trashed transaction (office). Only while nothing newer is
 * live; restoring a withdrawal re-claims its day, and is refused with
 * `WITHDRAWAL_LIMIT` if another one has taken that day meanwhile.
 */
export function restoreTxn(
  accessToken: string,
  id: string,
  txnId: string,
): Promise<{ txn: SavingsTxn; account: SavingsAccount }> {
  return apiFetch(`/savings/accounts/${id}/transactions/${txnId}/restore`, {
    method: "POST",
    accessToken,
  });
}

/* ----------------------------------------------------------------- tellers --- */

/**
 * POST /savings/accounts/{id}/deposits — record the cash handed over, from
 * GHS 5 up. Any collector or office staff. The idempotency key is what makes a
 * retry safe: the same key returns the original transaction with `200` rather
 * than crediting the account twice.
 */
export function recordDeposit(
  accessToken: string,
  id: string,
  input: { amount: number; idempotencyKey: string; channel?: SavingsChannel },
): Promise<{ txn: SavingsTxn; account: SavingsAccount; replayed: boolean }> {
  return apiFetch(`/savings/accounts/${id}/deposits`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * POST /savings/accounts/{id}/withdrawals — hand cash over (office). `amount`
 * is what the customer receives; the flat GHS 10 fee is debited on top of it.
 * One per account per Accra day (`WITHDRAWAL_LIMIT`), and the balance may never
 * fall below the GHS 50 minimum (`EXCEEDS_AVAILABLE`, whose details carry the
 * figure that was available).
 */
export function recordWithdrawal(
  accessToken: string,
  id: string,
  input: { amount: number; idempotencyKey: string },
): Promise<{ txn: SavingsTxn; account: SavingsAccount; replayed: boolean }> {
  return apiFetch(`/savings/accounts/${id}/withdrawals`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * GET /savings/accounts/{id}/txns/{txnId}/receipt — the printable PDF for a
 * deposit, a withdrawal or a closure. Raw response: the browser holds no access
 * token, so a resource route proxies the body through with the session's.
 *
 * Note the path segment is `txns`, not the `transactions` the listing uses.
 */
export function txnReceiptPdf(
  accessToken: string,
  id: string,
  txnId: string,
): Promise<Response> {
  return apiFetchRaw(`/savings/accounts/${id}/txns/${txnId}/receipt`, {
    accessToken,
  });
}

/**
 * POST /savings/accounts/{id}/close — pay the balance out and shut the account
 * (office). The minimum balance is released, the flat fee still applies, and
 * `flagged` comes back true when the balance could not cover it.
 */
export function closeAccount(
  accessToken: string,
  id: string,
): Promise<{
  account: SavingsAccount;
  fee: number;
  payout: number;
  flagged: boolean;
}> {
  return apiFetch(`/savings/accounts/${id}/close`, {
    method: "POST",
    accessToken,
  });
}
