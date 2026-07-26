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

/**
 * Susu (`/susu`) endpoint wrappers.
 *
 * Access follows the customer the account hangs off: collectors see and collect
 * on their own assigned customers only (the API scopes it, not us), while
 * opening and closing accounts — the two ends that move real money — are
 * office-only. Each call takes the caller's access token and returns the parsed
 * success body; failures throw `ApiError`.
 *
 * Amounts in and out are integer pesewas. See [money.ts](app/lib/money.ts).
 */

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
  /**
   * Exactly six digits — the number printed on the customer's card. This is
   * the only way to go from a quoted account number to an account, so it is
   * what a counter search should send.
   */
  accountNumber?: string;
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
  /** Pesewas, ≥ 1. Immutable once the cycle starts. */
  dailyAmount: number;
}

/**
 * POST /susu/accounts (office only)
 *
 * 422 `CUSTOMER_INACTIVE` when the customer has been deactivated. A customer
 * may hold several concurrent accounts, so this never conflicts with an
 * existing one — opening a second account is the supported way to "change" a
 * daily amount, since the first one's is fixed for its cycle.
 */
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
  /**
   * 1–31. Anything above 1 is a catch-up for missed days; the API computes the
   * amount as `dailyAmount × daysCovered`, which is why no amount is sent.
   */
  daysCovered?: number;
  /** 8–128 chars, from `newIdempotencyKey()`. Required. */
  idempotencyKey: string;
  channel?: DepositChannel;
}

/**
 * POST /susu/accounts/{id}/deposits — collectors (own customers) and office.
 *
 * Answers `201` for a new deposit and `200` for a replay of the same
 * idempotency key; both bodies carry `replayed`, so branch on that rather than
 * on the status — `apiFetch` doesn't surface it. Reaching 31 deposits completes
 * the cycle, and the customer gets an SMS receipt either way.
 *
 * 422 `EXCEEDS_REMAINING` carries `details.remaining` — read it with
 * `readExceedsRemaining` and tell the collector how many days are actually
 * left. 422 `ACCOUNT_NOT_ACTIVE` means the cycle is already completed or
 * closed, so there is nothing to pay into. 409 means a concurrent update;
 * retrying with the same key is safe, and is exactly what the key is for.
 */
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
  /** Pesewas. Must equal the sum of the active accounts' daily amounts. */
  amount: number;
  /** 8–128 chars, from `newIdempotencyKey()`. Required. */
  idempotencyKey: string;
  channel?: DepositChannel;
}

/**
 * POST /susu/collect-all
 *
 * One handful of cash, split across every active account the customer holds, in
 * a single all-or-nothing transaction — the field flow, where a customer paying
 * into three accounts hands over one amount rather than three.
 *
 * The amount must equal the sum exactly: compute it with `collectAllTotal` and
 * show it, don't make anyone add it up. On a mismatch the 422 carries the
 * required total and a per-account breakdown (`readAmountMismatch`); 422
 * `NO_ACTIVE_ACCOUNTS` means there was nothing to collect into.
 */
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

/**
 * POST /susu/accounts/{id}/close (office only) — the withdrawal.
 *
 * Payout is total deposits minus exactly one day's commission, whatever day the
 * customer exits on, and never negative. `flagged` comes back true when the
 * deposits didn't cover the commission — that account needs a human before the
 * cash drawer opens. 409 `ALREADY_CLOSED` if someone got there first.
 */
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

/**
 * GET /susu/summary — end-of-day reconciliation.
 *
 * What a collector should be holding in cash, and what the office counts it
 * against. Collectors see only their own; office roles omit `collectorId` for
 * the whole operation.
 */
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
