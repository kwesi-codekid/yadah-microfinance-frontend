import type { PaymentChannel } from "~/lib/channel";
import type {
  SavingsAccount,
  SavingsAccountStatus,
  SavingsCloseResult,
  SavingsTxn,
  SavingsTxnResult,
} from "~/lib/savings-client";
import { apiFetch } from "~/lib/api/client";

/**
 * Savings (`/savings`) endpoint wrappers.
 *
 * Access splits on which way the money is going. **All roles see all accounts**
 * and any collector or office staff may pay *in*; taking money *out* —
 * withdrawals and closure — is office-only, as is opening an account. Each call
 * takes the caller's access token and returns the parsed success body; failures
 * throw `ApiError`.
 *
 * Amounts in and out are integer pesewas. See [money.ts](app/lib/money.ts).
 */

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
  /**
   * Optional opening balance, pesewas, ≥ `SAVINGS_MIN_DEPOSIT`. Recorded
   * atomically with the opening — there is no window where the account exists
   * empty — so it comes back as `initialTxn` beside the account.
   */
  initialDeposit?: number;
  /** Required only when `initialDeposit` is sent; it is the deposit's key. */
  idempotencyKey?: string;
  channel?: PaymentChannel;
}

/**
 * POST /savings/accounts (office only)
 *
 * 422 `CUSTOMER_INACTIVE` when the customer has been deactivated. Unlike susu
 * there is no reason to open a second account — the balance is open-ended and
 * nothing about it is fixed at opening — but the API doesn't forbid it.
 */
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

/**
 * POST /savings/accounts/{id}/deposits — any collector or office staff.
 *
 * Answers `201` for a new deposit and `200` for a replay of the same
 * idempotency key; both bodies carry `replayed`, so branch on that rather than
 * on the status — `apiFetch` doesn't surface it.
 *
 * 422 `ACCOUNT_NOT_ACTIVE` means the account is closed, so there is nothing to
 * pay into. There is no ceiling: unlike a susu cycle, a savings balance has
 * nothing to fill up.
 */
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
  /**
   * Pesewas — **what the customer receives**. The flat GHS 10 fee is debited on
   * top, so the balance falls by `amount + SAVINGS_FEE`. Sending the figure the
   * customer asked for is therefore correct; sending the total to debit would
   * short them by ten cedis.
   */
  amount: number;
  /** 8–128 chars, from `newIdempotencyKey()`. Required. */
  idempotencyKey: string;
}

/**
 * POST /savings/accounts/{id}/withdrawals (office only) — the cash-out.
 *
 * Three separate refusals, and they need different answers on screen:
 *
 * - 422 `EXCEEDS_AVAILABLE` carries `details.available` — read it with
 *   `readExceedsAvailable` and say what could have been taken. The balance may
 *   look ample and still fail: the GHS 50 minimum and the fee are both held
 *   back out of it.
 * - 409 `WITHDRAWAL_LIMIT` — one cash-out per Accra day, and a closure counts.
 *   Not retryable today; `hasCashedOutOn` catches it before the submit.
 * - 422 `ACCOUNT_NOT_ACTIVE` — already closed.
 *
 * No `channel`: the API takes none here. Money going out is cash over the
 * counter.
 */
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

/**
 * POST /savings/accounts/{id}/close (office only) — the final withdrawal.
 *
 * Releases the GHS 50 minimum, which nothing else can touch, and charges the
 * flat fee one last time: a GHS 200 balance pays out GHS 190. `flagged` comes
 * back true when the balance didn't cover the fee — that account needs a human
 * before the cash drawer opens.
 *
 * 409 `ALREADY_CLOSED` if someone got there first, or `WITHDRAWAL_LIMIT` if the
 * account has already been cashed out today — closing is a payout too, and the
 * one-per-day rule counts it.
 */
export function closeSavingsAccount(
  accessToken: string,
  id: string,
): Promise<SavingsCloseResult> {
  return apiFetch(`/savings/accounts/${id}/close`, {
    method: "POST",
    accessToken,
  });
}
