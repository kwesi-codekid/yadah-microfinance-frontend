import { formatAmount } from "~/lib/format";
import { MIN_BALANCE, MIN_DEPOSIT, WITHDRAWAL_FEE } from "~/lib/savings";

/**
 * Corrections to a figure already on the ledger — types and display constants
 * shared by the server and the browser. Nothing here may import a `.server`
 * module or the API client; the fetch functions live in `~/api/corrections`.
 *
 * The office corrects a transaction outright. A teller may not — a figure
 * already on the ledger is changed by a decision — but may ask, and the
 * asking is a `TxnCorrection`. Nothing moves until the office approves, and
 * approval runs the very same correction the office would have made by hand,
 * so every rule that guards a direct correction guards this one, as the
 * record stands then.
 *
 * One vocabulary for the four kinds of figure that can be corrected, because
 * the asking and the deciding are the same whatever the figure is on. What
 * differs — what the amount is checked against — is `CorrectionContext`.
 */

export type CorrectionKind =
  | "susu-deposit"
  | "savings-txn"
  | "loan-repayment"
  | "hp-payment";

export const CORRECTION_KINDS: CorrectionKind[] = [
  "susu-deposit",
  "savings-txn",
  "loan-repayment",
  "hp-payment",
];

export const KIND_LABELS: Record<CorrectionKind, string> = {
  "susu-deposit": "Susu deposit",
  "savings-txn": "Savings",
  "loan-repayment": "Loan repayment",
  "hp-payment": "Hire-purchase instalment",
};

/** What one entry of each kind is called in a sentence. */
export const KIND_NOUNS: Record<CorrectionKind, string> = {
  "susu-deposit": "deposit",
  "savings-txn": "transaction",
  "loan-repayment": "repayment",
  "hp-payment": "payment",
};

export type CorrectionStatus = "pending" | "approved" | "rejected" | "cancelled";

export const CORRECTION_STATUSES: CorrectionStatus[] = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
];

export interface TxnCorrection {
  id: string;
  kind: CorrectionKind;
  /** The record the transaction belongs to: an account, a loan, an agreement. */
  targetId: string;
  txnId: string;
  customerId: string;
  /** Joined for display; the record holds only ids. */
  customerName?: string;
  /** The account, loan or agreement number, where the record has one. */
  targetNumber?: string;
  /** A susu account's own ref, or the item on a hire-purchase agreement. */
  targetLabel?: string;
  /** The transaction as it stood when the teller asked, and what they asked for. */
  amountBefore: number;
  amount: number;
  /** Susu only: the days covered before and after. */
  unitsBefore?: number;
  units?: number;
  reason: string;
  status: CorrectionStatus;
  requestedById: string;
  requestedByName?: string;
  /** Whoever decided — or, for a cancellation, whoever withdrew it. */
  reviewedById?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  createdAt: string;
}

export const CORRECTION_STATUS_LABELS: Record<CorrectionStatus, string> = {
  pending: "Awaiting decision",
  approved: "Applied",
  rejected: "Declined",
  cancelled: "Taken back",
};

export const CORRECTION_STATUS_BLURBS: Record<CorrectionStatus, string> = {
  pending: "Waiting on the office. The ledger still shows the old figure.",
  approved: "The office applied it. The ledger shows the new figure.",
  rejected: "The office said no. The figure is unchanged.",
  cancelled: "Whoever asked took it back before a decision.",
};

/** Waiting is the one that needs someone, so it takes the warning. */
export const CORRECTION_STATUS_TONE: Record<
  CorrectionStatus,
  "success" | "info" | "warning" | "danger" | "muted"
> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "muted",
};

/** The API wants three to three hundred characters of reason. */
export function checkCorrectionReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < 3) return "Say why, in a few words.";
  if (trimmed.length > 300) return "Keep it under 300 characters.";
  return null;
}

/** Where the record behind a correction lives in this app. */
export function targetPath(c: Pick<TxnCorrection, "kind" | "targetId">): string {
  switch (c.kind) {
    case "susu-deposit":
      return `/susu/${c.targetId}`;
    case "savings-txn":
      return `/savings/${c.targetId}`;
    case "loan-repayment":
      return `/loans/${c.targetId}`;
    case "hp-payment":
      return `/hire-purchase/${c.targetId}`;
  }
}

/* ----------------------------------------------------------------- amounts --- */

/**
 * What a corrected amount is checked against, per kind, before the round
 * trip. Each mirrors the API's own refusal so the dialog says no first; the
 * API is the authority either way.
 */
export type CorrectionContext =
  | {
      kind: "susu-deposit";
      dailyAmount: number;
      /** The cycle without this deposit in it. */
      depositsCount: number;
      cycleTarget: number;
      /** The days this deposit covers as it stands. */
      daysCovered: number;
    }
  | {
      kind: "savings-txn";
      txnType: "deposit" | "withdrawal";
      /** What the account held before this transaction. */
      balanceBefore: number;
    }
  | {
      kind: "loan-repayment";
      /** What the loan owed before this repayment landed. */
      remainingBefore: number;
    }
  | {
      kind: "hp-payment";
      /** What the agreement owed before this payment landed. */
      remainingBefore: number;
    };

/** The fault in a corrected amount, or null when the API would take it. */
export function checkCorrectedAmount(
  context: CorrectionContext,
  pesewas: number | null,
): string | null {
  if (pesewas == null || !Number.isFinite(pesewas) || pesewas <= 0) {
    return "Enter an amount.";
  }
  switch (context.kind) {
    case "susu-deposit": {
      if (pesewas % context.dailyAmount !== 0) {
        return "The amount has to be a whole number of days.";
      }
      const days = pesewas / context.dailyAmount;
      if (days - context.daysCovered > context.cycleTarget - context.depositsCount) {
        return "That runs past the end of the cycle.";
      }
      return null;
    }
    case "savings-txn": {
      if (context.txnType === "deposit") {
        return pesewas < MIN_DEPOSIT ? "Deposits start at GH₵ 5.00." : null;
      }
      const available = context.balanceBefore - MIN_BALANCE - WITHDRAWAL_FEE;
      if (pesewas > Math.max(0, available)) {
        return "More than the account could give up that day.";
      }
      return null;
    }
    case "loan-repayment":
    case "hp-payment":
      return pesewas > context.remainingBefore
        ? "More than was owed at the time."
        : null;
  }
}

/** The one line under the box: what the corrected amount comes to. */
export function describeCorrectedAmount(
  context: CorrectionContext,
  pesewas: number,
): string {
  switch (context.kind) {
    case "susu-deposit": {
      const days = pesewas / context.dailyAmount;
      return `${days} day${days === 1 ? "" : "s"} at GH₵ ${formatAmount(context.dailyAmount)}.`;
    }
    case "savings-txn": {
      const after =
        context.txnType === "deposit"
          ? context.balanceBefore + pesewas
          : context.balanceBefore - pesewas - WITHDRAWAL_FEE;
      return context.txnType === "deposit"
        ? `Leaves a balance of GH₵ ${formatAmount(after)}.`
        : `With the GH₵ ${formatAmount(WITHDRAWAL_FEE)} fee, leaves GH₵ ${formatAmount(after)}.`;
    }
    case "loan-repayment":
    case "hp-payment": {
      const left = context.remainingBefore - pesewas;
      return left === 0
        ? "Settles it exactly."
        : `Leaves GH₵ ${formatAmount(left)} owing.`;
    }
  }
}
