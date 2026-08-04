import type { PaymentChannel } from "~/lib/channel";
import type {
  SavingsAccount,
  SavingsAccountStatus,
  SavingsCloseResult,
  SavingsTxn,
  SavingsTxnResult,
} from "~/lib/savings-client";
import { apiFetch } from "~/lib/api/client";

export interface SavingsAccountListResult {
  items: SavingsAccount[];
  page: number;
  limit: number;
  total: number;
}

export interface SavingsTxnListResult {
  items: SavingsTxn[];
  page: number;
  limit: number;
  total: number;
}

export interface ListSavingsAccountsParams {
  page?: number;
  limit?: number;
  customerId?: string;
  status?: SavingsAccountStatus;
  /** Exactly ten digits — a savings number, not a susu one, which is six. */
  accountNumber?: string;
  /** Fuzzy and typo-tolerant: customer name, phone, or account-number prefix. */
  search?: string;
}

/** GET /savings/accounts */
export function listSavingsAccounts(
  accessToken: string,
  params: ListSavingsAccountsParams = {},
): Promise<SavingsAccountListResult> {
  const q = new URLSearchParams();
  if (params.page) q.set("page", String(params.page));
  if (params.limit) q.set("limit", String(params.limit));
  if (params.customerId) q.set("customerId", params.customerId);
  if (params.status) q.set("status", params.status);
  if (params.accountNumber) q.set("accountNumber", params.accountNumber);
  if (params.search) q.set("search", params.search);
  const qs = q.toString();
  return apiFetch<SavingsAccountListResult>(
    `/savings/accounts${qs ? `?${qs}` : ""}`,
    { accessToken },
  );
}

/** GET /savings/accounts/{id} — includes `availableToWithdraw`. */
export function getSavingsAccount(
  accessToken: string,
  id: string,
): Promise<{ account: SavingsAccount }> {
  return apiFetch(`/savings/accounts/${id}`, { accessToken });
}

export interface OpenSavingsAccountInput {
  customerId: string;
  initialDeposit?: number;
  /** Required only when `initialDeposit` is sent; it is the deposit's key. */
  idempotencyKey?: string;
  channel?: PaymentChannel;
}

export function openSavingsAccount(
  accessToken: string,
  input: OpenSavingsAccountInput,
): Promise<{ account: SavingsAccount; initialTxn?: SavingsTxn }> {
  return apiFetch("/savings/accounts", {
    method: "POST",
    json: input,
    accessToken,
  });
}

export interface ListSavingsTxnsParams {
  page?: number;
  limit?: number;
}

/** GET /savings/accounts/{id}/transactions — the statement, newest first. */
export function listSavingsTxns(
  accessToken: string,
  id: string,
  params: ListSavingsTxnsParams = {},
): Promise<SavingsTxnListResult> {
  const q = new URLSearchParams();
  if (params.page) q.set("page", String(params.page));
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return apiFetch<SavingsTxnListResult>(
    `/savings/accounts/${id}/transactions${qs ? `?${qs}` : ""}`,
    { accessToken },
  );
}

export interface RecordSavingsDepositInput {
  /** Pesewas, ≥ `SAVINGS_MIN_DEPOSIT` (1000 — GHS 10). */
  amount: number;
  /** 8–128 chars, from `newIdempotencyKey()`. Required. */
  idempotencyKey: string;
  channel?: PaymentChannel;
}

export function recordSavingsDeposit(
  accessToken: string,
  id: string,
  input: RecordSavingsDepositInput,
): Promise<SavingsTxnResult> {
  return apiFetch(`/savings/accounts/${id}/deposits`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

export interface RecordSavingsWithdrawalInput {
  amount: number;
  /** 8–128 chars, from `newIdempotencyKey()`. Required. */
  idempotencyKey: string;
}

export function recordSavingsWithdrawal(
  accessToken: string,
  id: string,
  input: RecordSavingsWithdrawalInput,
): Promise<SavingsTxnResult> {
  return apiFetch(`/savings/accounts/${id}/withdrawals`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

export function closeSavingsAccount(
  accessToken: string,
  id: string,
): Promise<SavingsCloseResult> {
  return apiFetch(`/savings/accounts/${id}/close`, {
    method: "POST",
    accessToken,
  });
}
