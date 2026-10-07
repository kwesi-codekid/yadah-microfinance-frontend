import { apiFetch, apiFetchRaw } from "~/api/client";
import { queryOf, type ExportFormat, type Paginated } from "~/api/query";
import type { RenumberReport } from "~/api/savings";
import type {
  DepositChannel,
  DepositResult,
  DepositSplit,
  SusuAccount,
  SusuCycle,
  SusuDeposit,
  SusuPayout,
  SusuPlan,
  WithdrawalLine,
  SusuStatus,
  SusuSummary,
  TrashedSusuAccount,
  TrashedSusuDeposit,
} from "~/lib/susu";

/**
 * The `/susu` endpoints. This module imports the API client, so it is
 * server-only: call it from loaders and actions. Types and display constants
 * live in the client-safe `~/lib/susu`.
 *
 * Recording money is open to collectors as well as the office; everything that
 * changes an account's shape — opening it, its plans, withdrawing, closing,
 * correcting — is counter or office work and the API answers a collector with
 * `403 FORBIDDEN`.
 */

export type { ExportFormat, Paginated };

export interface AccountListParams {
  page?: number;
  limit?: number;
  customerId?: string;
  status?: SusuStatus;
  /** The full `SU` number, or the bare six digits of a grandfathered one. */
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

/** GET /susu/accounts/{id} — the account with its plans. */
export function getAccount(
  accessToken: string,
  id: string,
): Promise<{ account: SusuAccount }> {
  return apiFetch(`/susu/accounts/${id}`, { accessToken });
}

/**
 * POST /susu/accounts — open the customer's one account with its first plan
 * (counter). A customer whose account was closed gets it reopened, same
 * number and history; one with an account open is refused with `ALREADY_OPEN`
 * and the account to use in `details.accountId`.
 */
export function openAccount(
  accessToken: string,
  input: { customerId: string; dailyAmount: number },
): Promise<{ account: SusuAccount; reopened: boolean }> {
  return apiFetch("/susu/accounts", { method: "POST", json: input, accessToken });
}

/**
 * DELETE /susu/accounts/{id} — trash an account that never held money
 * (office). Refused with `CANNOT_TRASH` otherwise; a used account is closed.
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

/* ------------------------------------------------------------------- plans --- */

/** POST /susu/accounts/{id}/plans — another daily amount, on its own cycle (counter). */
export function addPlan(
  accessToken: string,
  id: string,
  input: { dailyAmount: number },
): Promise<{ account: SusuAccount; plan: SusuPlan }> {
  return apiFetch(`/susu/accounts/${id}/plans`, { method: "POST", json: input, accessToken });
}

/**
 * PATCH /susu/accounts/{id}/plans/{planId} — change the daily amount, only
 * between cycles (counter). Mid-cycle the API answers `PLAN_MID_CYCLE`.
 */
export function changePlanAmount(
  accessToken: string,
  id: string,
  planId: string,
  input: { dailyAmount: number },
): Promise<{ account: SusuAccount; plan: SusuPlan }> {
  return apiFetch(`/susu/accounts/${id}/plans/${planId}`, {
    method: "PATCH",
    json: input,
    accessToken,
  });
}

/**
 * POST /susu/accounts/{id}/plans/{planId}/stop — stop a plan (counter).
 * Mid-cycle this charges its one payment; the money stays in the balance.
 */
export function stopPlan(
  accessToken: string,
  id: string,
  planId: string,
): Promise<{ account: SusuAccount; plan: SusuPlan; commission: number }> {
  return apiFetch(`/susu/accounts/${id}/plans/${planId}/stop`, {
    method: "POST",
    accessToken,
  });
}

/** GET /susu/accounts/{id}/cycles — ended cycles, newest first. */
export function listCycles(
  accessToken: string,
  id: string,
  params: { page?: number; limit?: number; planId?: string } = {},
): Promise<Paginated<SusuCycle>> {
  return apiFetch(`/susu/accounts/${id}/cycles${queryOf({ ...params })}`, { accessToken });
}

/** GET /susu/accounts/{id}/payouts — money out, newest first; `planId` narrows to one plan's shares. */
export function listPayouts(
  accessToken: string,
  id: string,
  params: { page?: number; limit?: number; planId?: string } = {},
): Promise<Paginated<SusuPayout>> {
  return apiFetch(`/susu/accounts/${id}/payouts${queryOf({ ...params })}`, { accessToken });
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
 * POST /susu/accounts/{id}/deposits — record the cash handed over. `split`
 * says how many whole payments go to each plan; omitted, it is one on every
 * running plan. Whatever the split does not use stays in the balance. The
 * idempotency key is what makes a retry safe: the same key returns the
 * original deposit with `200` rather than recording it twice.
 */
export function recordDeposit(
  accessToken: string,
  id: string,
  input: {
    amount: number;
    split?: DepositSplit[];
    idempotencyKey: string;
    channel?: DepositChannel;
    /**
     * The Accra day the money changed hands, for history typed in after the
     * fact. Omitted on an ordinary same-day collection; refused by the API
     * unless backdating is switched on for the data-population stage.
     */
    occurredOn?: string;
  },
): Promise<DepositResult> {
  return apiFetch(`/susu/accounts/${id}/deposits`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/** DELETE — trash the most recent deposit, un-crediting the plans (office). */
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
 * POST — re-credit a trashed deposit (office). Only while every plan it paid
 * still stands where it found it: anything recorded since has taken its place.
 */
export function restoreDeposit(
  accessToken: string,
  id: string,
  depositId: string,
): Promise<DepositResult> {
  return apiFetch(`/susu/accounts/${id}/deposits/${depositId}/restore`, {
    method: "POST",
    accessToken,
  });
}

/* --------------------------------------------------------------- lifecycle --- */

/**
 * POST /susu/accounts/{id}/close — the customer leaves (counter). Every plan
 * mid-cycle is charged its one payment and the rest of the balance is paid
 * out in cash. The account keeps its number and can be reopened.
 */
export function closeAccount(
  accessToken: string,
  id: string,
): Promise<{ account: SusuAccount; commission: number; payout: number; payoutId: string }> {
  return apiFetch(`/susu/accounts/${id}/close`, { method: "POST", accessToken });
}

/**
 * POST /susu/accounts/{id}/withdraw — money out, account open (counter). Like
 * a savings withdrawal: any amount up to `availableToWithdraw`. No commission,
 * and every cycle is untouched. A replay comes back as `200 {}` — an empty
 * body — so the absence of `account` is what says nothing new was paid.
 */
export function withdraw(
  accessToken: string,
  id: string,
  input: { amount: number; idempotencyKey: string },
): Promise<{
  account?: SusuAccount;
  amount?: number;
  payoutId?: string;
  /** What came off which plan, in the order the money walked them. */
  lines?: WithdrawalLine[];
  /** The part that sat on no plan. */
  loose?: number;
  /** Moved to Yadah because the withdrawal left only commission behind; usually 0. */
  commission?: number;
  replayed?: boolean;
}> {
  return apiFetch(`/susu/accounts/${id}/withdraw`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * POST /susu/accounts/{id}/withdraw-all — everything out, account open
 * (counter). Each plan with a cycle in progress ends it and gives one payment
 * of its own amount to Yadah's commission account; the rest is the cash.
 * A replay comes back as `200 {}`, like `withdraw`.
 */
export function withdrawAll(
  accessToken: string,
  id: string,
  input: { idempotencyKey: string },
): Promise<{
  account?: SusuAccount;
  /** Cash handed over. */
  amount?: number;
  /** Moved to Yadah's commission account. */
  commission?: number;
  payoutId?: string;
  lines?: WithdrawalLine[];
  loose?: number;
  replayed?: boolean;
}> {
  return apiFetch(`/susu/accounts/${id}/withdraw-all`, {
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

/** GET /susu/accounts/{id}/withdrawals/{payoutId}/receipt — a withdrawal or the closing payout. */
export function withdrawalReceiptPdf(
  accessToken: string,
  id: string,
  payoutId: string,
): Promise<Response> {
  return apiFetchRaw(`/susu/accounts/${id}/withdrawals/${payoutId}/receipt`, {
    accessToken,
  });
}

/** What the susu data update did, or would do. */
export interface SusuMigrationReport {
  apply: boolean;
  migration: {
    customers: number;
    books: number;
    plans: number;
    deposits: number;
    payoutsLabelled: number;
    balanceBefore: number;
    balanceAfter: number;
    commissionTakenNow: number;
  };
  backfill: { accounts: number; payouts: number; loose: number };
  /** Commissions already taken, filed into Yadah's commission account. */
  commissions: { entries: number; amount: number };
  /** Zero when the money reconciles. */
  drift: number;
}

/**
 * POST /susu/renumber — bring this month's susu numbers into the continuing
 * sequence. `apply: false` previews; `apply: true` writes. Office only.
 */
export function renumberThisMonth(
  accessToken: string,
  input: { apply: boolean },
): Promise<RenumberReport> {
  return apiFetch(`/susu/renumber`, { method: "POST", json: input, accessToken });
}

/**
 * POST /susu/migrate — the susu data update. `apply: false` is a dry run that
 * reports and writes nothing; `apply: true` writes. Admin only.
 */
export function runSusuMigration(
  accessToken: string,
  input: { apply: boolean },
): Promise<SusuMigrationReport> {
  return apiFetch(`/susu/migrate`, { method: "POST", json: input, accessToken });
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
