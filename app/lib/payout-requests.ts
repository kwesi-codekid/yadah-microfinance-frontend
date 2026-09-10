import { formatAmount } from "~/lib/format";

/**
 * Payout-request types and display constants shared by the server and the
 * browser. Nothing here may import a `.server` module or the API client — it
 * is bundled into the client. The fetch functions live in
 * `~/api/payout-requests`.
 *
 * A payout request is a withdrawal the **customer** asked for from the portal,
 * to be paid to their mobile-money wallet, and it waits here for the office to
 * decide. Two things about it are unlike every other withdrawal in the app:
 *
 *   - Approving it moves money twice. The ledger is debited first, through the
 *     ordinary office service; only then does the Paystack transfer go out.
 *     If that transfer later fails the account is **already debited** and the
 *     request sits in `failed` — the API never re-credits an account on a
 *     webhook's word. The office retries the payout or pays cash.
 *   - Nothing is typed. The customer named the amount and the wallet; the
 *     office says yes or no, and a "no" carries a reason.
 *
 * So `failed` is not a closed state to file away. It is money that left the
 * books and did not reach the customer, and it is drawn as such.
 */

export type PayoutRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "paid"
  | "failed";

export type PayoutRequestKind =
  | "savings-withdrawal"
  | "susu-partial-withdrawal"
  | "susu-closure";

export interface PayoutRequest {
  id: string;
  customerId: string;
  /** Office responses only. */
  customerName?: string;
  kind: PayoutRequestKind;
  /** The savings or susu account the request draws on. */
  targetId: string;
  /** Null for a closure — the payout is whatever the cycle comes to. */
  amount: number | null;
  status: PayoutRequestStatus;
  payoutPhone: string;
  /** Paystack's bank code for the wallet — `MTN`, `VOD`, `ATL`. */
  payoutProvider: string;
  /** What actually left the account, after commission or fee. Set on approval. */
  netAmount: number | null;
  rejectionReason?: string;
  paystackStatus?: string;
  failureReason?: string;
  reviewedAt?: string;
  paidAt?: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ labels --- */

export const STATUSES: PayoutRequestStatus[] = [
  "pending",
  "approved",
  "rejected",
  "paid",
  "failed",
];

export const STATUS_LABELS: Record<PayoutRequestStatus, string> = {
  pending: "Awaiting decision",
  approved: "Sending",
  rejected: "Declined",
  paid: "Paid",
  failed: "Transfer failed",
};

/** What each state asks of whoever is looking at it. */
export const STATUS_BLURBS: Record<PayoutRequestStatus, string> = {
  pending: "The customer has asked. Nothing has moved yet.",
  approved: "The account is debited and the money is on its way to the wallet.",
  rejected: "Declined by the office. Nothing moved.",
  paid: "Paystack confirmed the money reached the wallet.",
  failed:
    "The account was debited but the transfer did not go through. Retry it, or pay cash.",
};

/**
 * `failed` takes the danger tone because it is the one state where the books
 * and the customer's pocket disagree. `pending` is the queue, so it takes the
 * warning that says "somebody has to act".
 */
export const STATUS_TONE: Record<
  PayoutRequestStatus,
  "success" | "info" | "warning" | "danger" | "muted"
> = {
  pending: "warning",
  approved: "info",
  rejected: "muted",
  paid: "success",
  failed: "danger",
};

export const KIND_LABELS: Record<PayoutRequestKind, string> = {
  "savings-withdrawal": "Savings withdrawal",
  "susu-partial-withdrawal": "Susu withdrawal",
  "susu-closure": "Susu closure",
};

/** One line under the kind, for the person deciding. */
export const KIND_BLURBS: Record<PayoutRequestKind, string> = {
  "savings-withdrawal": "Taken from a savings account. The withdrawal fee applies.",
  "susu-partial-withdrawal":
    "Part of a susu balance, the account stays open. No commission here.",
  "susu-closure":
    "Ends the cycle and pays out what is held, less the closing commission.",
};

/** Paystack's wallet codes, as the customer's own screens name them. */
export const PROVIDER_LABELS: Record<string, string> = {
  MTN: "MTN MoMo",
  VOD: "Telecel Cash",
  ATL: "AT Money",
};

export function providerLabel(code: string): string {
  return PROVIDER_LABELS[code.toUpperCase()] ?? code;
}

/* ------------------------------------------------------------------- rules --- */

/** Still waiting for the office to say yes or no. */
export function isPending(row: Pick<PayoutRequest, "status">): boolean {
  return row.status === "pending";
}

/** Money left the account and did not reach the customer. */
export function isStranded(row: Pick<PayoutRequest, "status">): boolean {
  return row.status === "failed";
}

/**
 * Whether asking Paystack directly could change anything. The transfer is in
 * flight after approval and its outcome normally arrives by webhook; when that
 * goes astray the request sits on `approved` for good, and a failed one may
 * have gone through on a retry Paystack made itself. Neither a decision not
 * yet taken nor a settled one has anything to ask about.
 */
export function canVerify(row: Pick<PayoutRequest, "status">): boolean {
  return row.status === "approved" || row.status === "failed";
}

/** Where the account behind the request lives in this app. */
export function targetPath(row: Pick<PayoutRequest, "kind" | "targetId">): string {
  return row.kind === "savings-withdrawal"
    ? `/savings/${row.targetId}`
    : `/susu/${row.targetId}`;
}

/** A refusal must say why — the customer sees the reason on the portal. */
export function checkRejectionReason(reason: string): string | null {
  if (!reason.trim()) return "Say why the customer is being refused.";
  if (reason.trim().length > 500) return "Keep the reason under 500 characters.";
  return null;
}

/* ---------------------------------------------------------------- outcomes --- */

export interface Outcome {
  ok: boolean;
  message: string;
  description?: string;
}

/** What the toast says, from what the API says the request is now. */
export function outcomeFor(intent: string, r: PayoutRequest): Outcome {
  const who = r.customerName ?? "the customer";
  const sent = formatAmount(r.netAmount ?? r.amount ?? 0);
  if (intent === "reject") {
    return {
      ok: true,
      message: "Declined. Nothing moved.",
      description: `${who} sees the reason on the portal.`,
    };
  }
  if (r.status === "paid") {
    return { ok: true, message: `GH₵ ${sent} reached ${who}'s wallet.` };
  }
  if (r.status === "failed") {
    return {
      ok: false,
      message: "The account is debited but the transfer failed.",
      description: r.failureReason || "Retry the payout, or pay cash and note it.",
    };
  }
  if (intent === "approve") {
    return {
      ok: true,
      message: `Approved — GH₵ ${sent} is on its way.`,
      description: "The account is debited. Paystack will confirm when it lands.",
    };
  }
  return {
    ok: true,
    message: "Checked with Paystack.",
    description: `Still ${STATUS_LABELS[r.status].toLowerCase()}.`,
  };
}
