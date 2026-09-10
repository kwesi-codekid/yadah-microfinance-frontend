import { apiFetch, apiFetchRaw } from "~/api/client";
import { queryOf, type ExportFormat, type Paginated } from "~/api/query";
import type {
  ExcessDestination,
  Installment,
  Loan,
  LoanConfig,
  LoanEligibility,
  LoanStatus,
  Repayment,
  RepaymentChannel,
  SusuClosureResult,
  TrashedLoan,
} from "~/lib/loans";

/**
 * The `/loans` endpoints. This module imports the API client, so it is
 * server-only: call it from loaders and actions. Types and display constants
 * live in the client-safe `~/lib/loans`.
 *
 * The whole module is documented office-only. Individual operations do not
 * repeat the marker, so every route here re-checks with `requireOffice` rather
 * than trusting the tag — and the API has the final word either way.
 */

export type { ExportFormat, Paginated };

export interface LoanListParams {
  page?: number;
  limit?: number;
  customerId?: string;
  status?: LoanStatus;
  /** Fuzzy and typo-tolerant: customer name or phone. */
  search?: string;
  /** Inclusive Accra day, `YYYY-MM-DD`, on when the loan was applied for. */
  from?: string;
  to?: string;
}

/* ------------------------------------------------------------------ config --- */

/**
 * GET /loans/config — the tiers, rates and durations in force.
 *
 * The spec types the payload as an opaque object, so nothing here is trusted to
 * be present; `withDefaults` in `~/lib/loans` fills the gaps from the published
 * figures. Read it as advisory until the real shape is confirmed on staging.
 */
export function getConfig(accessToken: string): Promise<{ config: LoanConfig }> {
  return apiFetch("/loans/config", { accessToken });
}

/**
 * PUT /loans/config — change the parameters new lending runs on.
 *
 * New applications and approvals only. A loan that has already been approved
 * locked its rate and its schedule at that moment and is untouched by this,
 * which is the sentence the form has to say out loud before it saves.
 */
export function updateConfig(
  accessToken: string,
  input: {
    ratePercent3: number;
    ratePercent6: number;
    ratePercent12: number;
    smallMinPesewas: number;
    smallMaxPesewas: number;
    bigMaxPesewas: number;
  },
): Promise<{ config: LoanConfig }> {
  return apiFetch("/loans/config", { method: "PUT", json: input, accessToken });
}

/* ------------------------------------------------------------- eligibility --- */

/**
 * GET /loans/eligibility/{customerId} — four months of history, summarised.
 *
 * There is no auto-approval anywhere in this API. This endpoint exists to put
 * the facts in front of a person: how long they have been saving, what they
 * have paid in, whether the Ghana Card is on file, whether a loan is already
 * open, and whether the big tier has been earned.
 */
export function getEligibility(
  accessToken: string,
  customerId: string,
): Promise<LoanEligibility> {
  return apiFetch(`/loans/eligibility/${customerId}`, { accessToken });
}

/* -------------------------------------------------------------------- loans --- */

/** GET /loans — the loan book, newest application first. */
export function listLoans(
  accessToken: string,
  params: LoanListParams = {},
): Promise<Paginated<Loan>> {
  return apiFetch(`/loans${queryOf({ ...params })}`, { accessToken });
}

/** GET /loans?format=csv|xlsx — pagination ignored, capped at 10,000 rows. */
export function exportLoans(
  accessToken: string,
  params: Omit<LoanListParams, "page" | "limit">,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/loans${queryOf({ ...params }, format)}`, { accessToken });
}

/** GET /loans/trash — soft-deleted applications, newest first. */
export function listTrashedLoans(
  accessToken: string,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<TrashedLoan>> {
  return apiFetch(`/loans/trash${queryOf({ ...params })}`, { accessToken });
}

/**
 * GET /loans/{id} — the loan with its instalment schedule and every repayment
 * against it. The schedule is empty until approval generates it.
 */
export function getLoan(
  accessToken: string,
  id: string,
): Promise<{ loan: Loan; schedule: Installment[]; repayments: Repayment[] }> {
  return apiFetch(`/loans/${id}`, { accessToken });
}

/**
 * POST /loans/applications — record what the customer asked for.
 *
 * Refused with `GHANA_CARD_REQUIRED` unless the card is on the profile, with
 * `ID_DOCUMENT_REQUIRED` until both sides of the ID are uploaded, with
 * `LOAN_EXISTS` when one is already open, and with `BIG_TIER_LOCKED` for a big
 * principal from someone who has not repaid a small one on time. Nothing is
 * disbursed here — the application waits for a person.
 */
export function apply(
  accessToken: string,
  input: {
    customerId: string;
    principal: number;
    durationMonths: number;
    /** From POST /uploads?kind=signature. */
    signatureUrl: string;
  },
): Promise<{ loan: Loan }> {
  return apiFetch("/loans/applications", {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * POST /loans/{id}/approve — the decision, and the only place money starts.
 *
 * Locks the rate and the interest from the config in force right now, builds
 * the monthly schedule with the remainder folded into the last instalment, and
 * sends the approval SMS.
 */
export function approve(accessToken: string, id: string): Promise<{ loan: Loan }> {
  return apiFetch(`/loans/${id}/approve`, { method: "POST", accessToken });
}

/** POST /loans/{id}/reject — turn it down. The reason is recorded and shown. */
export function reject(
  accessToken: string,
  id: string,
  reason: string,
): Promise<{ loan: Loan }> {
  return apiFetch(`/loans/${id}/reject`, {
    method: "POST",
    json: { reason },
    accessToken,
  });
}

/**
 * DELETE /loans/{id} — trash a pending or rejected application. Anything that
 * has been approved is money history and is refused with `CANNOT_TRASH`.
 */
export function trashLoan(
  accessToken: string,
  id: string,
  reason?: string,
): Promise<{ loan: TrashedLoan }> {
  return apiFetch(`/loans/${id}`, {
    method: "DELETE",
    json: reason ? { reason } : {},
    accessToken,
  });
}

/**
 * POST /loans/{id}/restore — bring an application back. A pending one re-checks
 * the one-open-loan rule on the way, so this can still be refused.
 */
export function restoreLoan(accessToken: string, id: string): Promise<{ loan: Loan }> {
  return apiFetch(`/loans/${id}/restore`, { method: "POST", accessToken });
}

/* -------------------------------------------------------------- repayments --- */

export interface RepaymentResult {
  repayment: Repayment;
  loan: Loan;
  replayed: boolean;
  /** Present only on the susu-closure route — what happened on the susu side. */
  susuClosure?: SusuClosureResult;
}

/**
 * POST /loans/{id}/repayments — record cash against the loan.
 *
 * Allocated oldest-instalment-first. An overpayment is refused with
 * `EXCEEDS_BALANCE`, whose details carry the exact balance — pre-fill the box
 * from that rather than making someone guess again. Settling to the penny flips
 * the loan to `repaid` and stamps `repaidOnTime`, which is what unlocks the big
 * tier later.
 *
 * The idempotency key is what makes a retry safe: the same key returns the
 * original repayment with `200` instead of taking the money twice.
 */
export function recordRepayment(
  accessToken: string,
  id: string,
  input: { amount: number; idempotencyKey: string; channel?: RepaymentChannel },
): Promise<RepaymentResult> {
  return apiFetch(`/loans/${id}/repayments`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/**
 * POST /loans/{id}/repayments/susu-closure — pay the loan by stopping a susu
 * account, in one transaction across both modules.
 *
 * The susu account closes with the usual commission maths and its payout lands
 * on the loan, capped at what the loan still owes. What is left over either
 * stays in the susu account pending withdrawal — the default — or credits the
 * customer's active savings account in the same transaction. That choice moves
 * real money, so the screen has to make it explicit and show the figures before
 * anyone presses anything.
 */
export function repayBySusuClosure(
  accessToken: string,
  id: string,
  input: {
    susuAccountId: string;
    idempotencyKey: string;
    excessTo?: ExcessDestination;
  },
): Promise<RepaymentResult> {
  return apiFetch(`/loans/${id}/repayments/susu-closure`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/* --------------------------------------------------------------- receipts --- */

/**
 * GET /loans/{id}/disbursement/receipt — the printable PDF proving the
 * customer received the money. The boxed headline is the principal handed
 * over, with what is owed back stated underneath. Refused with
 * `NOT_DISBURSED` (422) while the loan is still waiting to be paid out.
 *
 * Raw response: the browser holds no access token, so a resource route proxies
 * the body through with the session's.
 */
export function disbursementReceiptPdf(
  accessToken: string,
  id: string,
): Promise<Response> {
  return apiFetchRaw(`/loans/${id}/disbursement/receipt`, { accessToken });
}

/**
 * GET /loans/{id}/repayments/{repaymentId}/receipt — the printable PDF for one
 * repayment. Balances are rebuilt as at that repayment, so a reprint shows the
 * position when it was issued rather than the position today.
 */
export function repaymentReceiptPdf(
  accessToken: string,
  id: string,
  repaymentId: string,
): Promise<Response> {
  return apiFetchRaw(`/loans/${id}/repayments/${repaymentId}/receipt`, {
    accessToken,
  });
}
