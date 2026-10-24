import { apiFetch, apiFetchRaw } from "~/api/client";
import { queryOf, type Paginated } from "~/api/query";
import type { SavingsChannel } from "~/lib/savings";
import type {
  SusuLoanAccount,
  SusuLoanStatus,
  SusuLoanTxn,
  SusuLoanTxnType,
} from "~/lib/susu-loans";

/**
 * The `/susu-loans` endpoints. Server-only: call it from loaders and actions.
 * Types and labels live in the client-safe `~/lib/susu-loans`.
 *
 * Office only, every endpoint — collectors do not take susu loan deposits on
 * their rounds (client decision, 23 Oct 2026), and the API answers them with
 * `403 FORBIDDEN`. There is no withdrawal: money leaves only to the loan.
 */

export type { Paginated };

export interface AccountListParams {
  page?: number;
  limit?: number;
  customerId?: string;
  status?: SusuLoanStatus;
  /** Fuzzy: customer name, phone, or account-number prefix. */
  search?: string;
}

/** GET /susu-loans/accounts */
export function listAccounts(
  accessToken: string,
  params: AccountListParams = {},
): Promise<Paginated<SusuLoanAccount>> {
  return apiFetch(`/susu-loans/accounts${queryOf({ ...params })}`, { accessToken });
}

/** GET /susu-loans/accounts/{id} */
export function getAccount(
  accessToken: string,
  id: string,
): Promise<{ account: SusuLoanAccount }> {
  return apiFetch(`/susu-loans/accounts/${id}`, { accessToken });
}

/**
 * POST /susu-loans/accounts — open one. Refused with `SUSU_LOAN_EXISTS`
 * (details.accountId) when the customer already has one open.
 */
export function openAccount(
  accessToken: string,
  input: { customerId: string; initialDeposit?: number; idempotencyKey?: string },
): Promise<{ account: SusuLoanAccount; initialTxn?: SusuLoanTxn }> {
  return apiFetch("/susu-loans/accounts", { method: "POST", json: input, accessToken });
}

/** GET /susu-loans/accounts/{id}/txns — newest first. */
export function listTxns(
  accessToken: string,
  id: string,
  params: { page?: number; limit?: number; type?: SusuLoanTxnType } = {},
): Promise<Paginated<SusuLoanTxn>> {
  return apiFetch(`/susu-loans/accounts/${id}/txns${queryOf({ ...params })}`, {
    accessToken,
  });
}

/**
 * POST /susu-loans/accounts/{id}/deposits — any amount. A loan that is behind
 * takes it at once, so the account returned is the balance after that.
 */
export function recordDeposit(
  accessToken: string,
  id: string,
  input: { amount: number; idempotencyKey: string; channel?: SavingsChannel },
): Promise<{ txn: SusuLoanTxn; account: SusuLoanAccount; replayed: boolean }> {
  return apiFetch(`/susu-loans/accounts/${id}/deposits`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/** POST /susu-loans/accounts/{id}/close — only when empty (`SUSU_LOAN_NOT_EMPTY`). */
export function closeAccount(
  accessToken: string,
  id: string,
): Promise<{ account: SusuLoanAccount }> {
  return apiFetch(`/susu-loans/accounts/${id}/close`, { method: "POST", accessToken });
}

/** GET /susu-loans/accounts/{id}/txns/{txnId}/receipt — the PDF, raw. */
export function txnReceiptPdf(
  accessToken: string,
  id: string,
  txnId: string,
): Promise<Response> {
  return apiFetchRaw(`/susu-loans/accounts/${id}/txns/${txnId}/receipt`, { accessToken });
}
