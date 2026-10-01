/**
 * Customer-portal types and rules shared by the server and the browser.
 * Nothing here may import a `.server` module or the API client — it is
 * bundled into the client. The fetch functions live in `~/api/portal`.
 *
 * The portal is the customer's own window onto their money: what they hold,
 * what moved, a statement, paying in by mobile money, and asking for a
 * withdrawal. It never moves money out by itself — a withdrawal is a
 * *request* the office decides on — and everything it reads is scoped to the
 * signed-in customer by the token, never by a parameter.
 */

import type { CustomerStatement, TransactionTotals, UnifiedTransaction } from "~/lib/customers";
import type { PaystackCharge } from "~/lib/payments";
import type { PayoutRequest, PayoutRequestKind } from "~/lib/payout-requests";

export interface PortalProfile {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
  photoUrl?: string;
  status: string;
}

export interface PortalTokens {
  accessToken: string;
  refreshToken: string;
}

export interface PortalSusuPlan {
  planId: string;
  dailyAmount: number;
  /** Payments made in the cycle in progress, 0..30. */
  paidInCycle: number;
  /** Always 31. */
  cycleLength: number;
  cycleNumber: number;
  status: string;
}

export interface PortalSusu {
  accountId: string;
  /** The customer's own susu number — one per customer. */
  accountNumber: string;
  status: string;
  balance: number;
  /** One payment per plan with a cycle in progress — the part nothing may take. */
  locked: number;
  /** Most the customer can take with the account left open. */
  availableToWithdraw: number;
  /** One payment on every running plan. */
  dailyTotal: number;
  plans: PortalSusuPlan[];
}

export interface PortalSavings {
  accountId: string;
  accountNumber: string;
  accountType: string;
  status: string;
  balance: number;
  /** balance − minimum − fee, floored at zero. */
  available: number;
  minBalance: number;
  withdrawalFee: number;
}

/** The API leaves these two open; these are the fields the statement uses. */
export interface PortalLoan {
  loanId?: string;
  id?: string;
  tier?: string;
  status: string;
  principal?: number;
  totalDue?: number;
  totalRepaid?: number;
  remaining?: number;
  dueDate?: string | null;
}

export interface PortalHirePurchase {
  agreementId?: string;
  id?: string;
  itemName?: string;
  status: string;
  totalPayable?: number | null;
  totalPaid?: number;
  remaining?: number | null;
}

export interface PortalAccounts {
  susu: PortalSusu[];
  savings: PortalSavings[];
  loans: PortalLoan[];
  hirePurchase: PortalHirePurchase[];
  totals: {
    /** Open susu + savings balances. */
    saved: number;
    /** Open loan + hire-purchase balances. */
    owed: number;
  };
}

/** The unified feed, scoped to the customer. Shape follows `/reports/transactions`. */
export interface PortalTransactions {
  items: UnifiedTransaction[];
  totals?: TransactionTotals;
  page?: number;
  limit?: number;
  total?: number;
  from?: string;
  to?: string;
}

export type PortalStatement = CustomerStatement;

export type PortalChargeKind = "susu-deposit" | "savings-deposit";

export type { PaystackCharge, PayoutRequest, PayoutRequestKind };

/* ------------------------------------------------------------------ labels --- */

export const SUSU_STATUS_LABELS: Record<string, string> = {
  active: "Open",
  closed: "Closed",
};

export const SAVINGS_STATUS_LABELS: Record<string, string> = {
  active: "Open",
  closed: "Closed",
};

export function statusLabel(table: Record<string, string>, status: string): string {
  return table[status] ?? status.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function isOpen(status: string): boolean {
  return status === "active";
}

/* ------------------------------------------------------------------- rules --- */

/** An account the customer can pay into by mobile money. */
export interface PayTarget {
  kind: PortalChargeKind;
  id: string;
  label: string;
  hint: string;
}

/** How to name the susu account to its owner: the number, and what one round costs. */
export function susuLabel(account: PortalSusu): string {
  return `#${account.accountNumber} · GH₵ ${(account.dailyTotal / 100).toFixed(2)} a day`;
}

export function payTargets(accounts: PortalAccounts): PayTarget[] {
  const out: PayTarget[] = [];
  const susu = accounts.susu.filter((a) => isOpen(a.status) && a.dailyTotal > 0);
  for (const a of susu) {
    const running = a.plans.filter((p) => p.status === "active").length;
    out.push({
      kind: "susu-deposit",
      id: a.accountId,
      label: `Susu ${susuLabel(a)}`,
      hint: `Paid in rounds of GH₵ ${(a.dailyTotal / 100).toFixed(2)} — one payment on ${running === 1 ? "your plan" : `each of your ${running} plans`}`,
    });
  }
  for (const a of accounts.savings) {
    if (!isOpen(a.status)) continue;
    out.push({
      kind: "savings-deposit",
      id: a.accountId,
      label: `Savings #${a.accountNumber}`,
      hint: "Any amount from GH₵ 5.00",
    });
  }
  return out;
}

/** A withdrawal the customer may ask for, with the ceiling the API will apply. */
export interface RequestOption {
  kind: PayoutRequestKind;
  targetId: string;
  label: string;
  /** Null for a closure — the payout is not the customer's to choose. */
  max: number | null;
  hint: string;
}

export function requestOptions(accounts: PortalAccounts): RequestOption[] {
  const out: RequestOption[] = [];
  for (const a of accounts.savings) {
    if (!isOpen(a.status)) continue;
    out.push({
      kind: "savings-withdrawal",
      targetId: a.accountId,
      label: `Withdraw from savings #${a.accountNumber}`,
      max: a.available,
      hint: `Up to GH₵ ${(a.available / 100).toFixed(2)} today. A GH₵ ${(a.withdrawalFee / 100).toFixed(2)} fee applies and GH₵ ${(a.minBalance / 100).toFixed(2)} stays in the account.`,
    });
  }
  const susu = accounts.susu.filter((a) => isOpen(a.status));
  for (const a of susu) {
    out.push({
      kind: "susu-partial-withdrawal",
      targetId: a.accountId,
      label: `Withdraw from susu #${a.accountNumber}`,
      max: a.availableToWithdraw,
      hint: `Up to GH₵ ${(a.availableToWithdraw / 100).toFixed(2)} with the account left open. No commission is taken; GH₵ ${(a.locked / 100).toFixed(2)} stays for the cycles in progress.`,
    });
    out.push({
      kind: "susu-closure",
      targetId: a.accountId,
      label: `Close susu #${a.accountNumber}`,
      max: null,
      hint: `Stops every plan. You receive GH₵ ${(Math.max(0, a.balance - a.locked) / 100).toFixed(2)} after GH₵ ${(a.locked / 100).toFixed(2)} commission for the cycles in progress.`,
    });
  }
  return out;
}

export function optionKey(o: Pick<RequestOption, "kind" | "targetId">): string {
  return `${o.kind}:${o.targetId}`;
}

/** Whether an amount is inside what the option allows. */
export function checkRequestAmount(option: RequestOption, pesewas: number | null): string | null {
  if (option.max === null) return null;
  if (pesewas == null || !Number.isFinite(pesewas) || pesewas <= 0) return "Enter how much you want.";
  if (pesewas > option.max) return `The most you can take now is GH₵ ${(option.max / 100).toFixed(2)}.`;
  return null;
}

/** Where a ledger row's account lives in the portal — there is one page. */
export function portalHome(): string {
  return "/portal";
}
