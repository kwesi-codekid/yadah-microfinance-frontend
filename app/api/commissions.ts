import { apiFetch } from "~/api/client";
import { queryOf, type Paginated } from "~/api/query";
import type {
  Commission,
  CommissionMove,
  CommissionSource,
  CommissionSummary,
} from "~/lib/commissions";

/**
 * The `/commissions` endpoints — Yadah's commission account. Office only: it
 * is the company's money, not a customer's.
 */

export function getCommissionSummary(accessToken: string): Promise<CommissionSummary> {
  return apiFetch("/commissions/summary", { accessToken });
}

export interface CommissionList extends Paginated<Commission> {
  /** Over the whole filter, not the page; `bySource` ignores the source filter. */
  totals: { amount: number; bySource: Record<CommissionSource, number> };
}

export function listCommissions(
  accessToken: string,
  params: {
    page?: number;
    limit?: number;
    source?: CommissionSource;
    q?: string;
    from?: string;
    to?: string;
  } = {},
): Promise<CommissionList> {
  return apiFetch(`/commissions${queryOf(params)}`, { accessToken });
}

export interface MoveList extends Paginated<CommissionMove> {
  totalAmount: number;
}

export function listCommissionMoves(
  accessToken: string,
  params: { page?: number; limit?: number; from?: string; to?: string } = {},
): Promise<MoveList> {
  return apiFetch(`/commissions/moves${queryOf(params)}`, { accessToken });
}

/** Commission into a company cash account. Never more than the account holds. */
export function moveCommission(
  accessToken: string,
  input: {
    amount: number;
    cashAccountId: string;
    occurredOn?: string;
    note?: string;
    idempotencyKey: string;
  },
): Promise<{ move: CommissionMove; balance: number; replayed: boolean }> {
  return apiFetch("/commissions/moves", { method: "POST", json: input, accessToken });
}

/** A move made in error: the money goes back into the commission account. */
export function undoCommissionMove(
  accessToken: string,
  id: string,
  reason?: string,
): Promise<{ move: CommissionMove; balance: number }> {
  return apiFetch(`/commissions/moves/${id}/trash`, {
    method: "POST",
    json: reason ? { reason } : {},
    accessToken,
  });
}
