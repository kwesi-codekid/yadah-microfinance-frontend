import type {
  CollectAllResult,
  DepositChannel,
  RecordDepositResult,
  SusuAccount,
  SusuAccountStatus,
  SusuCloseResult,
  SusuDeposit,
  SusuSummary,
} from "~/lib/susu-client";
import { apiFetch } from "~/lib/api/client";

export interface SusuAccountListResult {
  items: SusuAccount[];
  page: number;
  limit: number;
  total: number;
}

export interface SusuDepositListResult {
  items: SusuDeposit[];
  page: number;
  limit: number;
  total: number;
}

export interface ListSusuAccountsParams {
  page?: number;
  limit?: number;
  customerId?: string;
  status?: SusuAccountStatus;
  /** Exact match. For part of a number, or a name or phone, use `search`. */
  accountNumber?: string;
  /** Fuzzy and typo-tolerant: customer name, phone, or account-number prefix. */
  search?: string;
}

/** GET /susu/accounts */
export function listSusuAccounts(
  accessToken: string,
  params: ListSusuAccountsParams = {},
): Promise<SusuAccountListResult> {
  const q = new URLSearchParams();
  if (params.page) q.set("page", String(params.page));
  if (params.limit) q.set("limit", String(params.limit));
  if (params.customerId) q.set("customerId", params.customerId);
  if (params.status) q.set("status", params.status);
  if (params.accountNumber) q.set("accountNumber", params.accountNumber);
  if (params.search) q.set("search", params.search);
  const qs = q.toString();
  return apiFetch<SusuAccountListResult>(`/susu/accounts${qs ? `?${qs}` : ""}`, {
    accessToken,
  });
}

/** GET /susu/accounts/{id} — includes cycle progress. */
export function getSusuAccount(
  accessToken: string,
  id: string,
): Promise<{ account: SusuAccount }> {
  return apiFetch(`/susu/accounts/${id}`, { accessToken });
}

export interface OpenSusuAccountInput {
  customerId: string;
  dailyAmount: number;
}

export function openSusuAccount(
  accessToken: string,
  input: OpenSusuAccountInput,
): Promise<{ account: SusuAccount }> {
  return apiFetch("/susu/accounts", {
    method: "POST",
    json: input,
    accessToken,
  });
}

export interface ListSusuDepositsParams {
  page?: number;
  limit?: number;
}

/** GET /susu/accounts/{id}/deposits — the statement, newest first. */
export function listSusuDeposits(
  accessToken: string,
  id: string,
  params: ListSusuDepositsParams = {},
): Promise<SusuDepositListResult> {
  const q = new URLSearchParams();
  if (params.page) q.set("page", String(params.page));
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return apiFetch<SusuDepositListResult>(
    `/susu/accounts/${id}/deposits${qs ? `?${qs}` : ""}`,
    { accessToken },
  );
}

export interface RecordDepositInput {
  daysCovered?: number;
  /** 8–128 chars, from `newIdempotencyKey()`. Required. */
  idempotencyKey: string;
  channel?: DepositChannel;
}

export function recordSusuDeposit(
  accessToken: string,
  id: string,
  input: RecordDepositInput,
): Promise<RecordDepositResult> {
  return apiFetch(`/susu/accounts/${id}/deposits`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

export interface CollectAllInput {
  customerId: string;
  /** Must equal the sum of the active accounts' daily amounts, in pesewas. */
  amount: number;
  /** 8–128 chars, from `newIdempotencyKey()`. Required. */
  idempotencyKey: string;
  channel?: DepositChannel;
}

/** POST /susu/collect-all — one cash amount split across every active cycle. */
export function collectAll(
  accessToken: string,
  input: CollectAllInput,
): Promise<CollectAllResult> {
  return apiFetch("/susu/collect-all", {
    method: "POST",
    json: input,
    accessToken,
  });
}

export interface SusuPayoutInput {
  /** Omit to hand over everything that is left. */
  amount?: number;
  /** 8–128 chars, from `newIdempotencyKey()`. Required. */
  idempotencyKey: string;
}

export interface SusuPayoutResult {
  account: SusuAccount;
  /** What was actually handed over. */
  amount: number;
  /** True when the API replayed an earlier identical request. */
  replayed: boolean;
}

/**
 * POST /susu/accounts/{id}/payout — hands over a pending-payout balance in
 * cash. The account closes when nothing is left owing.
 */
export function payoutSusuAccount(
  accessToken: string,
  id: string,
  input: SusuPayoutInput,
): Promise<SusuPayoutResult> {
  return apiFetch(`/susu/accounts/${id}/payout`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

export function closeSusuAccount(
  accessToken: string,
  id: string,
): Promise<SusuCloseResult> {
  return apiFetch(`/susu/accounts/${id}/close`, { method: "POST", accessToken });
}

export interface SusuSummaryParams {
  /** Accra calendar day, `YYYY-MM-DD`. Defaults to today, server-side. */
  date?: string;
  /** Office roles only — collectors always get their own figures. */
  collectorId?: string;
}

export function getSusuSummary(
  accessToken: string,
  params: SusuSummaryParams = {},
): Promise<SusuSummary> {
  const q = new URLSearchParams();
  if (params.date) q.set("date", params.date);
  if (params.collectorId) q.set("collectorId", params.collectorId);
  const qs = q.toString();
  return apiFetch<SusuSummary>(`/susu/summary${qs ? `?${qs}` : ""}`, {
    accessToken,
  });
}
