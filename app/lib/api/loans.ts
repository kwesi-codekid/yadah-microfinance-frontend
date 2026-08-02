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

export function getLoanConfig(
  accessToken: string,
): Promise<{ config: unknown }> {
  return apiFetch("/loans/config", { accessToken });
}

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

export function getLoan(accessToken: string, id: string): Promise<LoanDetail> {
  return apiFetch(`/loans/${id}`, { accessToken });
}

export function approveLoan(
  accessToken: string,
  id: string,
): Promise<{ loan: Loan }> {
  return apiFetch(`/loans/${id}/approve`, { method: "POST", accessToken });
}

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

export interface RecordLoanRepaymentInput {
  /** Pesewas. Must not exceed `loan.remaining` — there is no overpayment. */
  amount: number;
  /** 8–128 chars, from `newIdempotencyKey()`. Required. */
  idempotencyKey: string;
  /** Defaults to `cash` server-side. */
  channel?: PaymentChannel;
}

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
