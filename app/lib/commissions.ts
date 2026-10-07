/**
 * Yadah's commission account (client decisions, 7 Oct 2026): what the company
 * keeps from susu, savings and loans, held apart from the cash accounts until
 * office staff move it into one. Types and labels shared by the server and the
 * browser; the fetch functions live in `~/api/commissions`.
 */

export const COMMISSION_SOURCES = ["susu", "savings-fee", "loan-fee"] as const;
export type CommissionSource = (typeof COMMISSION_SOURCES)[number];

export type CommissionReason =
  | "cycle-completed"
  | "withdraw-all"
  | "plan-stopped"
  | "account-closed"
  | "savings-withdrawal"
  | "savings-closure"
  | "loan-disbursed";

export const COMMISSION_SOURCE_LABELS: Record<CommissionSource, string> = {
  susu: "Susu commission",
  "savings-fee": "Savings fees",
  "loan-fee": "Loan processing fees",
};

export const COMMISSION_REASON_LABELS: Record<CommissionReason, string> = {
  "cycle-completed": "Cycle completed",
  "withdraw-all": "Withdrew everything",
  "plan-stopped": "Plan stopped",
  "account-closed": "Account closed",
  "savings-withdrawal": "Withdrawal fee",
  "savings-closure": "Closure fee",
  "loan-disbursed": "Processing fee",
};

export interface Commission {
  id: string;
  source: CommissionSource;
  reason: CommissionReason;
  amount: number;
  customerId: string;
  customerName?: string;
  /** The susu account, savings account or loan it was earned on. */
  accountId: string;
  accountNumber?: string;
  channel: "cash" | "paystack" | "momo";
  takenAt: string;
  cycleNumber?: number;
  dailyAmount?: number;
}

export interface CommissionMove {
  id: string;
  amount: number;
  cashAccountId: string;
  cashAccountName?: string;
  occurredOn: string;
  note?: string;
  recordedById: string;
  recordedByName?: string;
  createdAt: string;
}

export interface CommissionSummary {
  /** What the commission account holds now. */
  balance: number;
  earned: { total: number; bySource: Record<CommissionSource, number> };
  moved: number;
}

/** Where an entry's account lives in the app. */
export function accountPath(c: Pick<Commission, "source" | "accountId">): string {
  if (c.source === "susu") return `/susu/${c.accountId}`;
  if (c.source === "savings-fee") return `/savings/${c.accountId}`;
  return `/loans/${c.accountId}`;
}
