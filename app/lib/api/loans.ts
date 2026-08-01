import type { PaymentChannel } from "~/lib/channel";
import type {
  Loan,
  LoanConfig,
  LoanDetail,
  LoanDuration,
  LoanEligibility,
  LoanRepaymentResult,
  LoanStatus,
} from "~/lib/loan-client";
import { apiFetch } from "~/lib/api/client";

/**
 * Loans (`/loans`) endpoint wrappers, mirroring [susu.ts](app/lib/api/susu.ts)
 * and [savings.ts](app/lib/api/savings.ts).
 *
 * **Office only, all of it.** The API's `Loans` tag says so in as many words,
 * and unlike susu and savings there is no "any collector may pay in" half — a
 * loan repayment is taken at the counter. Each call takes the caller's access
 * token and returns the parsed success body; failures throw `ApiError`.
 *
 * Amounts in and out are integer pesewas. See [money.ts](app/lib/money.ts).
 */

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

/**
 * GET /loans/config — the tiers, rates and durations in force *now*.
 *
 * The response is typed `{ config: unknown }` deliberately. The spec declares
 * the object with no properties at all (`"config": {}`), so its field names are
 * an inference from the `PUT` body; pass whatever comes back through
 * `normalizeLoanConfig` in [loan-client.ts](app/lib/loan-client.ts) rather than
 * casting, or a renamed field lands on screen as `NaN`.
 */
export function getLoanConfig(
  accessToken: string,
): Promise<{ config: unknown }> {
  return apiFetch("/loans/config", { accessToken });
}

/**
 * PUT /loans/config (office)
 *
 * Every field is required — this is a whole-object replace, not a patch, so
 * sending one rate resets the other five to nothing. Read the current config
 * first and send it back with the one change applied.
 *
 * **Applies to new applications and approvals only.** Loans already running are
 * untouched: their rate was locked when they were approved. That is what makes
 * this safe to change mid-month, and also why a rate change cannot be used to
 * fix a loan that was approved at the wrong one.
 */
export function updateLoanConfig(
  accessToken: string,
  input: LoanConfig,
): Promise<{ config: unknown }> {
  return apiFetch("/loans/config", {
    method: "PUT",
    json: input,
    accessToken,
  });
}

/* ------------------------------------------------------------------ *
 * Eligibility and application
 * ------------------------------------------------------------------ */

/**
 * GET /loans/eligibility/{customerId} — roughly four months of susu and savings
 * history, summarised.
 *
 * It approves nothing. The API is explicit: "a human admin decides. No
 * auto-approval exists." Two fields on it are hard gates rather than evidence —
 * `customer.hasGhanaCard` and `openLoan` — and failing either means the
 * application will be refused, so both are worth checking before the form is
 * even offered.
 */
export function getLoanEligibility(
  accessToken: string,
  customerId: string,
): Promise<LoanEligibility> {
  return apiFetch(`/loans/eligibility/${customerId}`, { accessToken });
}

export interface ApplyForLoanInput {
  customerId: string;
  /** Pesewas. Bounded by the tier — see `smallMinPesewas` / `bigMaxPesewas`. */
  principal: number;
  durationMonths: LoanDuration;
}

/**
 * POST /loans/applications (office records it) — creates a **pending** loan.
 *
 * No money moves and no rate is locked here; both wait for the approval. Four
 * refusals, each meaning something different (see `LOAN_APPLICATION_ERRORS`):
 *
 * - 409 `LOAN_EXISTS` — one open loan per customer, always.
 * - 422 `GHANA_CARD_REQUIRED` — the profile has no Ghana Card.
 * - 422 `PRINCIPAL_OUT_OF_RANGE` — outside the tier's bounds.
 * - 422 `BIG_TIER_LOCKED` — no previous small loan repaid on time.
 * - 422 `CUSTOMER_INACTIVE` — the customer has been deactivated.
 *
 * No idempotency key: the API takes none here. `LOAN_EXISTS` is what stands in
 * for one — a double submit creates the first application and the second is
 * refused, which is the outcome a key would have produced anyway.
 */
export function applyForLoan(
  accessToken: string,
  input: ApplyForLoanInput,
): Promise<{ loan: Loan }> {
  return apiFetch("/loans/applications", {
    method: "POST",
    json: input,
    accessToken,
  });
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export interface LoanListResult {
  items: Loan[];
  page: number;
  limit: number;
  total: number;
}

export interface ListLoansParams {
  page?: number;
  limit?: number;
  customerId?: string;
  status?: LoanStatus;
  /** 1–100 chars. The only product with a cross-customer search. */
  search?: string;
}

/**
 * GET /loans
 *
 * Unlike `GET /susu/accounts` this takes a `search` *and* joins `customerName`
 * onto each row, which is what makes a cross-customer loan book worth having:
 * pending applications need to be found by whoever approves them, and they
 * cannot be reached through a customer nobody has thought to open.
 */
export function listLoans(
  accessToken: string,
  params: ListLoansParams = {},
): Promise<LoanListResult> {
  const q = new URLSearchParams();
  if (params.page) q.set("page", String(params.page));
  if (params.limit) q.set("limit", String(params.limit));
  if (params.customerId) q.set("customerId", params.customerId);
  if (params.status) q.set("status", params.status);
  if (params.search) q.set("search", params.search);
  const qs = q.toString();
  return apiFetch<LoanListResult>(`/loans${qs ? `?${qs}` : ""}`, {
    accessToken,
  });
}

/**
 * GET /loans/{id} — the loan, its schedule and its repayment history.
 *
 * `schedule` is empty on a pending loan: it is generated at approval, so there
 * is nothing to show until the decision is made.
 *
 * Note this response carries no `customerName`, where the list rows do. A page
 * that names the customer has to fetch them separately.
 */
export function getLoan(accessToken: string, id: string): Promise<LoanDetail> {
  return apiFetch(`/loans/${id}`, { accessToken });
}

/* ------------------------------------------------------------------ *
 * The decision
 * ------------------------------------------------------------------ */

/**
 * POST /loans/{id}/approve — the human decision, and the point of no return.
 *
 * Four things happen at once: the loan goes active, the rate and interest are
 * locked **from the config as it stands right now**, the monthly schedule is
 * generated (the rounding remainder folding into the last instalment), and an
 * approval SMS goes to the customer. None of it is reversible — there is no
 * unapprove, only a repayment history.
 *
 * 409 `NOT_PENDING` when someone already decided.
 */
export function approveLoan(
  accessToken: string,
  id: string,
): Promise<{ loan: Loan }> {
  return apiFetch(`/loans/${id}/approve`, { method: "POST", accessToken });
}

/**
 * POST /loans/{id}/reject — 2–300 characters saying why.
 *
 * The reason is required and is stored on the record as `rejectionReason`, so
 * it is read later by whoever fields the customer's question about it. 409
 * `NOT_PENDING` when someone already decided.
 */
export function rejectLoan(
  accessToken: string,
  id: string,
  input: { reason: string },
): Promise<{ loan: Loan }> {
  return apiFetch(`/loans/${id}/reject`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

/* ------------------------------------------------------------------ *
 * Repayment
 * ------------------------------------------------------------------ */

export interface RecordLoanRepaymentInput {
  /** Pesewas. Must not exceed `loan.remaining` — there is no overpayment. */
  amount: number;
  /** 8–128 chars, from `newIdempotencyKey()`. Required. */
  idempotencyKey: string;
  /** Defaults to `cash` server-side. */
  channel?: PaymentChannel;
}

/**
 * POST /loans/{id}/repayments — a cash repayment.
 *
 * Allocated to instalments **oldest-first**, so a payment that covers more than
 * one instalment clears them in order rather than being applied to whichever is
 * due. Paying the remaining balance exactly flips the loan to `repaid` and
 * stamps `repaidOnTime` — which is what unlocks the big tier for this
 * customer's next loan, so it is worth telling the teller when a payment will
 * settle rather than merely reduce.
 *
 * Answers `201` for a new repayment and `200` for a replay of the same
 * idempotency key; both bodies carry `replayed`, so branch on that rather than
 * on the status — `apiFetch` doesn't surface it.
 *
 * - 422 `EXCEEDS_BALANCE` carries `details.remaining` — read it with
 *   `readExceedsBalance`. Overpayment is refused outright, not taken and
 *   refunded.
 * - 422 `LOAN_NOT_OPEN` — pending, rejected, or already settled.
 */
export function recordLoanRepayment(
  accessToken: string,
  id: string,
  input: RecordLoanRepaymentInput,
): Promise<LoanRepaymentResult> {
  return apiFetch(`/loans/${id}/repayments`, {
    method: "POST",
    json: input,
    accessToken,
  });
}

export interface RepayFromSusuInput {
  /** Must belong to the same customer as the loan. */
  susuAccountId: string;
  /** 8–128 chars, from `newIdempotencyKey()`. Required. */
  idempotencyKey: string;
}

/**
 * POST /loans/{id}/repayments/susu-closure — close a susu account straight into
 * the loan, in one transaction across both modules.
 *
 * The account closes with the normal commission arithmetic (one day's deposit)
 * and the payout it would have produced is applied to the loan instead of being
 * handed over. Either both happen or neither does.
 *
 * The refusal worth designing around is **`PAYOUT_EXCEEDS_BALANCE`**: if the
 * payout is larger than what is left on the loan the whole operation is refused
 * rather than the excess being paid out, because the API has no answer for what
 * to do with the difference. The way through is the manual one — take a cash
 * repayment for the balance and close the susu account normally — so a screen
 * offering this should compare the projected payout against `loan.remaining`
 * before the click, not after.
 *
 * - 409 `ALREADY_CLOSED` — the susu account is not open.
 * - 422 `CUSTOMER_MISMATCH` — the account belongs to someone else.
 * - 422 `NO_PAYOUT` — nothing to apply (deposits under one day's commission).
 * - 422 `LOAN_NOT_OPEN` — same as the cash path.
 */
export function repayLoanFromSusu(
  accessToken: string,
  id: string,
  input: RepayFromSusuInput,
): Promise<LoanRepaymentResult> {
  return apiFetch(`/loans/${id}/repayments/susu-closure`, {
    method: "POST",
    json: input,
    accessToken,
  });
}
