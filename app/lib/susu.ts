/**
 * Susu types and display constants shared by the server and the browser.
 * Nothing here may import a `.server` module or the API client — it is bundled
 * into the client. The fetch functions live in `~/api/susu`.
 *
 * A customer holds ONE susu account, like savings: a balance that deposits go
 * into and withdrawals come out of, open until the customer leaves. Inside it
 * run one or more plans — a daily amount each — and every plan counts its own
 * cycle of 31 payments. A cycle is counted in payments, never in dates: GHS 50
 * on a GHS 10 plan is five of the thirty-one, whenever it lands.
 *
 * Commission is one payment of the plan's amount per cycle, moved to Yadah's
 * commission account the moment the 31st payment lands. Until then that one
 * payment per running plan is commission due: an ordinary withdrawal leaves it
 * behind, and withdrawing everything, stopping a plan mid-cycle or closing the
 * account hands it to Yadah on the spot (client decision, 7 Oct 2026).
 */

import { formatAmount } from "~/lib/format";

/** The 31 payments a full cycle runs to. The API sends it on every plan. */
export const CYCLE_TARGET = 31;

/** The API's floor on a daily amount: GHS 10, in pesewas. */
export const MIN_DAILY_AMOUNT = 1000;

/**
 * The most one deposit may credit to a plan: the rest of this cycle and one
 * whole cycle after it. Anything further is far likelier a mistyped amount
 * than cash somebody handed over, and the API refuses it.
 */
export const MAX_CYCLES_PER_DEPOSIT = 2;

export type SusuStatus = "active" | "closed";
export type PlanStatus = "active" | "stopped";

/** How the cash physically arrived. `transfer` is only ever set by the API. */
export type DepositChannel = "cash" | "paystack" | "momo";

export interface SusuPlan {
  id: string;
  accountId: string;
  /** Pesewas. Changeable only between cycles. */
  dailyAmount: number;
  /** Payments made in the cycle in progress, 0..30. Never 31: that completes it. */
  paidInCycle: number;
  cycleTarget: number;
  /** The cycle in progress — or, between cycles, the one the next deposit starts. */
  cycleNumber: number;
  cyclesCompleted: number;
  status: PlanStatus;
  /** One payment's amount while a cycle is in progress; 0 between cycles or stopped. */
  locked: number;
  /** True between cycles: the amount may be changed before the next deposit. */
  amountChangeable: boolean;
  startedAt: string;
  stoppedAt?: string;
  /** Charged when stopped mid-cycle; 0 when stopped between cycles. */
  stopCommission?: number;
  /**
   * What the plan holds, pesewas: ended cycles net of commission, plus the
   * cycle in progress, less withdrawals beyond the days they cost. On the
   * account detail only; 0 once the account is closed.
   */
  balance?: number;
  /** Σ withdrawals taken off this plan, pesewas. On the account detail only. */
  withdrawn?: number;
}

/** Money out of the account: a withdrawal, or the payout that closed it. */
export interface SusuPayout {
  id: string;
  accountId: string;
  amount: number;
  kind: "payout" | "withdrawal";
  destination: "cash" | "savings" | "loan" | "hire-purchase";
  commissionAmount: number;
  /** How the money was spread over the plans; absent on closing payouts and pre-plan rows. */
  lines?: WithdrawalLine[];
  recordedById: string;
  createdAt: string;
}

/** One plan's share of a withdrawal, as the API reports it. */
export interface WithdrawalLine {
  planId: string;
  /** The plan's amount at the time. */
  dailyAmount: number;
  amount: number;
  /** Whole payments this share took off the plan's cycle in progress. */
  paymentsRemoved: number;
}

export interface SusuAccount {
  id: string;
  /** The customer's susu number, e.g. `SU26090005` — one per customer, for life. */
  accountNumber: string;
  customerId: string;
  /** Present on list responses, for display. */
  customerName?: string;
  /** Pesewas — what the account holds. */
  balance: number;
  /** One payment per plan with a cycle in progress: the part nothing may take. */
  locked: number;
  /** `balance − locked`, floored at zero. */
  availableToWithdraw: number;
  /** Σ daily amounts of the active plans — what one day's round collects. */
  dailyTotal: number;
  status: SusuStatus;
  /** Active plans first, then stopped; each group oldest first. */
  plans: SusuPlan[];
  openedAt: string;
  closedAt?: string;
  closeCommission?: number;
  closePayout?: number;
}

/** An account in the trash. `deletedAt` is what separates it from a live one. */
export interface TrashedSusuAccount extends SusuAccount {
  deletedAt: string;
  deletedById?: string;
  deleteReason?: string;
}

/**
 * One stretch of a deposit inside one cycle of one plan. A deposit that runs a
 * plan past its 31st payment has two lines for that plan, the second opening
 * the next cycle.
 */
export interface SusuDepositLine {
  planId: string;
  /** The plan's amount at the time. */
  dailyAmount: number;
  cycleNumber: number;
  payments: number;
  /** 1-based positions within the cycle, 1..31. */
  seqStart: number;
  seqEnd: number;
  /** payments × dailyAmount. */
  amount: number;
  /** One payment's amount when this line landed the 31st payment; else 0. */
  commissionAmount: number;
  completesCycle: boolean;
}

export interface SusuDeposit {
  id: string;
  accountId: string;
  customerId: string;
  /** Whoever recorded it — a collector in the field or office staff. */
  collectorId: string;
  /** The cash handed over. */
  amount: number;
  /** Σ lines.payments. */
  payments: number;
  lines: SusuDepositLine[];
  /** Cash beyond whole payments — stays in the balance, counts toward no plan. */
  leftover: number;
  /** Taken out of this deposit as cycles completed. */
  commissionAmount: number;
  channel: DepositChannel | "transfer";
  createdAt: string;
}

export interface TrashedSusuDeposit extends SusuDeposit {
  deletedAt: string;
  deletedById?: string;
  deleteReason?: string;
}

/** One ended cycle of one plan — the statement's history and the commission trail. */
export interface SusuCycle {
  id: string;
  planId: string;
  accountId: string;
  cycleNumber: number;
  dailyAmount: number;
  /** 31 when completed; fewer when cut short. */
  payments: number;
  commissionAmount: number;
  endReason: "completed" | "plan-stopped" | "account-closed";
  endedAt: string;
}

/** How many whole payments a deposit credits to each plan. */
export interface DepositSplit {
  planId: string;
  payments: number;
}

/** What recording a deposit gives back. */
export interface DepositResult {
  deposit: SusuDeposit;
  account: SusuAccount;
  replayed?: boolean;
}

/** GET /susu/summary — one Accra day's collection, for reconciliation. */
export interface SusuSummary {
  date: string;
  /** Null when the office asked for everyone rather than one collector. */
  collectorId: string | null;
  depositCount: number;
  totalCollected: number;
  deposits: SummaryDeposit[];
}

export interface SummaryDeposit {
  depositId: string;
  accountId: string;
  customerId: string;
  customerName: string;
  collectorId: string;
  amount: number;
  payments: number;
  at: string;
}

/* ------------------------------------------------------------------ labels --- */

export const SUSU_STATUS_LABELS: Record<SusuStatus, string> = {
  active: "Open",
  closed: "Closed",
};

/** What each state means at the counter, in one line. */
export const SUSU_STATUS_BLURBS: Record<SusuStatus, string> = {
  active: "Taking deposits and withdrawals.",
  closed: "Paid out. Reopens if the customer comes back.",
};

export const SUSU_STATUS_TONE: Record<SusuStatus, "success" | "muted"> = {
  active: "success",
  closed: "muted",
};

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  active: "Running",
  stopped: "Stopped",
};

export const CYCLE_END_LABELS: Record<SusuCycle["endReason"], string> = {
  completed: "Completed",
  "plan-stopped": "Plan stopped",
  "account-closed": "Account closed",
};

export const CHANNEL_LABELS: Record<string, string> = {
  cash: "Cash",
  momo: "MoMo",
  paystack: "Paystack",
  transfer: "Transfer",
};

export const CHANNEL_OPTIONS: { value: DepositChannel; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "momo", label: "MoMo" },
  { value: "paystack", label: "Paystack" },
];

/* ------------------------------------------------------------------- rules --- */

/** True while the account can still take a deposit. */
export function isOpen(account: Pick<SusuAccount, "status">): boolean {
  return account.status === "active";
}

export function activePlans(account: Pick<SusuAccount, "plans">): SusuPlan[] {
  return account.plans.filter((p) => p.status === "active");
}

/** "GH₵ 10.00 a day" — how the branch and its customers name a plan. */
export function planLabel(plan: Pick<SusuPlan, "dailyAmount">): string {
  return `GH₵ ${(plan.dailyAmount / 100).toFixed(2)} a day`;
}

/** How far through the cycle in progress, 0–1. */
export function cycleProgress(plan: Pick<SusuPlan, "paidInCycle" | "cycleTarget">): number {
  const target = plan.cycleTarget || CYCLE_TARGET;
  return Math.max(0, Math.min(1, plan.paidInCycle / target));
}

/** True while a cycle is in progress and its commission is still to come. */
export function isMidCycle(plan: Pick<SusuPlan, "status" | "paidInCycle">): boolean {
  return plan.status === "active" && plan.paidInCycle > 0;
}

/**
 * What closing the account today would do: every plan mid-cycle is charged its
 * one payment — exactly the amount already locked — and the rest is paid out.
 */
export function closurePreview(
  account: Pick<SusuAccount, "balance" | "locked">,
): { commission: number; payout: number } {
  return { commission: account.locked, payout: Math.max(0, account.balance - account.locked) };
}

/**
 * A withdrawal, checked before the round trip. The API keeps one payment per
 * running plan back so the commission stays collectible, which is exactly what
 * `availableToWithdraw` already is — so this refuses what the API would
 * refuse, using the figure it sent.
 */
export function checkWithdrawalAmount(
  account: Pick<SusuAccount, "availableToWithdraw">,
  pesewas: number | null,
): string | null {
  if (pesewas == null || !Number.isFinite(pesewas) || pesewas <= 0) {
    return "Enter what the customer is taking.";
  }
  if (account.availableToWithdraw <= 0) {
    return "What is in the account is the commission due on the cycles in progress.";
  }
  if (pesewas > account.availableToWithdraw) {
    return `Up to GH₵ ${formatAmount(account.availableToWithdraw)} leaves the commission behind — or withdraw everything.`;
  }
  return null;
}

/**
 * What withdrawing everything does today: each plan mid-cycle gives its one
 * payment — exactly `locked` — to Yadah, and the customer takes the rest.
 */
export function withdrawAllPreview(
  account: Pick<SusuAccount, "balance" | "locked">,
): { commission: number; cash: number } {
  return { commission: account.locked, cash: Math.max(0, account.balance - account.locked) };
}

/** What the account holds once a withdrawal of this size comes off. No fee. */
export function balanceAfterWithdrawal(
  account: Pick<SusuAccount, "balance">,
  pesewas: number,
): number {
  return account.balance - pesewas;
}

/* ------------------------------------------------------------------ splits --- */

/** The deposit form's starting point: one payment on every running plan. */
export function defaultSplit(account: Pick<SusuAccount, "plans">): DepositSplit[] {
  return activePlans(account).map((p) => ({ planId: p.id, payments: 1 }));
}

/** The most payments one deposit may credit to this plan. */
export function maxPaymentsFor(plan: Pick<SusuPlan, "paidInCycle" | "cycleTarget">): number {
  const target = plan.cycleTarget || CYCLE_TARGET;
  return target - plan.paidInCycle + target * (MAX_CYCLES_PER_DEPOSIT - 1);
}

/** Pesewas the split credits to plans: Σ payments × daily amount. */
export function coveredAmount(
  account: Pick<SusuAccount, "plans">,
  split: readonly DepositSplit[],
): number {
  return split.reduce((sum, s) => {
    const plan = account.plans.find((p) => p.id === s.planId);
    return plan ? sum + plan.dailyAmount * s.payments : sum;
  }, 0);
}

/**
 * The fault in a deposit and its split, or null when the API would take it.
 * Mirrors the API's own refusals so the form says no first.
 */
export function checkDeposit(
  account: Pick<SusuAccount, "plans">,
  split: readonly DepositSplit[],
  pesewas: number | null,
): string | null {
  if (pesewas == null || !Number.isFinite(pesewas) || pesewas <= 0) {
    return "Enter the cash received.";
  }
  const paying = split.filter((s) => s.payments > 0);
  if (paying.length === 0) return "Put at least one payment on a plan.";
  for (const s of paying) {
    const plan = account.plans.find((p) => p.id === s.planId);
    if (!plan || plan.status !== "active") return "One of these plans is no longer running.";
    if (!Number.isInteger(s.payments) || s.payments < 0) {
      return "Payments are whole numbers.";
    }
    if (s.payments > maxPaymentsFor(plan)) {
      return `At most ${maxPaymentsFor(plan)} payments on ${planLabel(plan)} in one go — check the amount.`;
    }
  }
  const covered = coveredAmount(account, split);
  if (covered > pesewas) {
    return `The split needs GH₵ ${(covered / 100).toFixed(2)}, more than the cash received.`;
  }
  return null;
}

/** What crediting `payments` to a plan would do, said before the cash is taken. */
export interface PlanPreview {
  /** Where the cycle in progress ends up, 0..30. */
  paidAfter: number;
  /** Cycles this deposit would complete on the plan (0, 1 or 2). */
  completes: number;
  /** Commission those completions take, pesewas. */
  commission: number;
  /** Payments that spill into the next cycle. */
  carried: number;
}

export function previewPlan(
  plan: Pick<SusuPlan, "paidInCycle" | "cycleTarget" | "dailyAmount">,
  payments: number,
): PlanPreview {
  const target = plan.cycleTarget || CYCLE_TARGET;
  const total = plan.paidInCycle + Math.max(0, payments);
  const completes = Math.floor(total / target);
  const paidAfter = total % target;
  const carried = completes > 0 ? paidAfter : 0;
  return { paidAfter, completes, commission: completes * plan.dailyAmount, carried };
}
