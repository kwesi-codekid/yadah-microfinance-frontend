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

export interface PortalSusu {
  accountId: string;
  /**
   * The customer's own susu number — shared by every book they hold, so two
   * cycles opened in one month read identically. Never enough on its own to
   * name one book; see `susuLabel`.
   */
  accountNumber: string;
  /** The month this book is called. */
  cycleMonth?: string;
  /** This book's own identity, rendered: `260912134501-a3f9`. Always distinct. */
  ref: string;
  status: string;
  dailyAmount: number;
  depositsCount: number;
  /** Always 31. */
  cycleLength: number;
  daysRemaining: number;
  totalDeposited: number;
  withdrawnAmount: number;
  balance: number;
  /** Most that can be taken with the account left open — one day stays reserved. */
  maxPartialWithdrawal: number;
  closurePreview: { commission: number; payout: number };
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
  active: "Running",
  "pending-payout": "Payout due",
  closed: "Closed",
  terminated: "Terminated",
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

/**
 * How to name one susu book to its owner.
 *
 * The number alone will not do: it belongs to the customer, not the book, so
 * somebody holding two September cycles sees the same string twice. What
 * distinguishes them for a customer is what they pay in — "my twenty cedi
 * book" is how the branch's customers already talk about them — and only when
 * even that matches does the machine reference get added, because it means
 * nothing to a person and is a last resort rather than a label.
 *
 * This matters most where the list is a menu: these labels are all the handset
 * shows, and one of the choices closes an account for good.
 */
export function susuLabel(account: PortalSusu, among: PortalSusu[]): string {
  const daily = `GH₵ ${(account.dailyAmount / 100).toFixed(2)} a day`;
  const twins = among.filter(
    (o) =>
      o.accountNumber === account.accountNumber && o.dailyAmount === account.dailyAmount,
  );
  const tail = twins.length > 1 ? `${daily} · ${account.ref}` : daily;
  return `#${account.accountNumber} · ${tail}`;
}

export function payTargets(accounts: PortalAccounts): PayTarget[] {
  const out: PayTarget[] = [];
  const susu = accounts.susu.filter((a) => isOpen(a.status));
  for (const a of susu) {
    out.push({
      kind: "susu-deposit",
      id: a.accountId,
      label: `Susu ${susuLabel(a, susu)}`,
      hint: `One day is GH₵ ${(a.dailyAmount / 100).toFixed(2)} · ${a.daysRemaining} day${a.daysRemaining === 1 ? "" : "s"} left in the cycle`,
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
      label: `Take some of susu ${susuLabel(a, susu)}`,
      max: a.maxPartialWithdrawal,
      hint: `Up to GH₵ ${(a.maxPartialWithdrawal / 100).toFixed(2)} with the account left open. No commission is taken.`,
    });
    out.push({
      kind: "susu-closure",
      targetId: a.accountId,
      label: `Close susu ${susuLabel(a, susu)}`,
      max: null,
      hint: `Ends the cycle. You receive GH₵ ${(a.closurePreview.payout / 100).toFixed(2)} after one day's commission of GH₵ ${(a.closurePreview.commission / 100).toFixed(2)}.`,
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
