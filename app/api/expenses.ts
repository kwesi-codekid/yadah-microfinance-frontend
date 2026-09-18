import { apiFetch, apiFetchRaw } from "~/api/client";
import { queryOf, type ExportFormat, type Paginated } from "~/api/query";
import type {
  Expense,
  ExpenseCategory,
  ExpenseStatus,
  ExpenseSummary,
  TrashedExpense,
  WriteOffEntityType,
} from "~/lib/expenses";

/**
 * The `/expenses` endpoints.
 *
 * Recording, reading and correcting a pending entry are the counter's —
 * petty cash is spent by whoever is standing at it. Approving, rejecting,
 * paying and the bin are the office's, and nobody approves their own spending.
 */

export interface ExpenseList extends Paginated<Expense> {
  /** Total matching the filters across ALL pages, not just this one. */
  totalAmount: number;
}

export function listExpenses(
  accessToken: string,
  params: {
    page?: number;
    limit?: number;
    category?: ExpenseCategory;
    status?: ExpenseStatus;
    cashAccountId?: string;
    search?: string;
    from?: string;
    to?: string;
  } = {},
): Promise<ExpenseList> {
  return apiFetch(`/expenses${queryOf(params)}`, { accessToken });
}

export function exportExpenses(
  accessToken: string,
  params: Record<string, string | undefined>,
  format: ExportFormat,
): Promise<Response> {
  return apiFetchRaw(`/expenses${queryOf(params, format)}`, { accessToken });
}

export function getExpenseSummary(
  accessToken: string,
  range: { from?: string; to?: string } = {},
): Promise<ExpenseSummary> {
  return apiFetch(`/expenses/summary${queryOf(range)}`, { accessToken });
}

export function getExpense(accessToken: string, id: string): Promise<{ expense: Expense }> {
  return apiFetch(`/expenses/${id}`, { accessToken });
}

/**
 * Record a cost. Moves NO money — only paying does that, which is why only
 * that step names an account. Dated by the day the cost belongs to.
 */
export function recordExpense(
  accessToken: string,
  input: {
    category: ExpenseCategory;
    description: string;
    amount: number;
    incurredOn: string;
    payee?: string;
    receiptUrl?: string;
    reference?: string;
    writeOffEntityType?: WriteOffEntityType;
    writeOffEntityId?: string;
  },
): Promise<{ expense: Expense }> {
  return apiFetch("/expenses", { method: "POST", json: input, accessToken });
}

/** Only while pending: once approved, changing the amount behind them is not a fix. */
export function updateExpense(
  accessToken: string,
  id: string,
  input: {
    category?: ExpenseCategory;
    description?: string;
    amount?: number;
    incurredOn?: string;
    payee?: string;
    reference?: string;
  },
): Promise<{ expense: Expense }> {
  return apiFetch(`/expenses/${id}`, { method: "PATCH", json: input, accessToken });
}

/** Allowed at any status — a receipt turning up after approval is the norm. */
export function attachReceipt(
  accessToken: string,
  id: string,
  receiptUrl: string,
): Promise<{ expense: Expense }> {
  return apiFetch(`/expenses/${id}/receipt`, {
    method: "POST",
    json: { receiptUrl },
    accessToken,
  });
}

/** Office. Refused with `SELF_APPROVAL` when the approver recorded it. */
export function approveExpense(
  accessToken: string,
  id: string,
): Promise<{ expense: Expense }> {
  return apiFetch(`/expenses/${id}/approve`, { method: "POST", accessToken });
}

export function rejectExpense(
  accessToken: string,
  id: string,
  reason: string,
): Promise<{ expense: Expense }> {
  return apiFetch(`/expenses/${id}/reject`, {
    method: "POST",
    json: { reason },
    accessToken,
  });
}

/** The only step that moves money, which is why it is the only one naming an account. */
export function payExpense(
  accessToken: string,
  id: string,
  input: { cashAccountId: string; paidOn?: string },
): Promise<{ expense: Expense }> {
  return apiFetch(`/expenses/${id}/pay`, { method: "POST", json: input, accessToken });
}

/** Pending or rejected only — the books keep what has already been booked. */
export function trashExpense(
  accessToken: string,
  id: string,
  reason?: string,
): Promise<{ expense: TrashedExpense }> {
  return apiFetch(`/expenses/${id}`, {
    method: "DELETE",
    json: reason ? { reason } : {},
    accessToken,
  });
}

export function restoreExpense(
  accessToken: string,
  id: string,
): Promise<{ expense: Expense }> {
  return apiFetch(`/expenses/${id}/restore`, { method: "POST", accessToken });
}

export type { ExportFormat };
