/**
 * Paystack mobile-money types shared by the server and the browser. Nothing
 * here may import a `.server` module or the API client. The fetch functions
 * live in `~/api/payments`.
 *
 * The one thing to understand about this module: **a charge has two statuses,
 * and they answer different questions.**
 *
 *   `status`          — did Paystack take the money? `pending | success | failed`
 *   `executionStatus` — did it reach the record it was meant for?
 *                       `pending | applied | failed`
 *
 * They can disagree, and the disagreement is the whole reason the module needs
 * a screen. A charge that succeeded but whose target changed underneath it
 * lands on `success` + `failed`: the customer has paid and nothing was
 * credited. That is a queue for the office to work through, not a silent
 * failure, so both statuses are shown on every row, always.
 */

/** What the money is for. Loan and HP charges are office-only. */
export type ChargeKind =
  | "susu-deposit"
  | "savings-deposit"
  | "loan-repayment"
  | "hp-deposit"
  | "hp-installment"
  | "hp-redemption";

export type ChargeStatus = "pending" | "success" | "failed";

export type ExecutionStatus = "pending" | "applied" | "failed";

/** The three Ghanaian mobile-money networks Paystack charges through. */
export type MomoProvider = "mtn" | "vod" | "atl";

export interface PaystackCharge {
  /** Server-generated and unique. This is what status is polled with. */
  reference: string;
  status: ChargeStatus;
  executionStatus: ExecutionStatus;
  kind: ChargeKind;
  targetId: string;
  customerId: string;
  /** Pesewas. */
  amount: number;
  phone: string;
  provider: MomoProvider;
  /** Paystack's own instruction to the customer. Shown verbatim, never reworded. */
  displayText?: string;
  failureReason?: string;
  /** The deposit, transaction or repayment created once it was applied. */
  resultRecordId?: string;
  createdAt: string;
  executedAt?: string;
}

/* ------------------------------------------------------------------ labels --- */

export const KIND_LABELS: Record<ChargeKind, string> = {
  "susu-deposit": "Susu deposit",
  "savings-deposit": "Savings deposit",
  "loan-repayment": "Loan repayment",
  "hp-deposit": "HP deposit",
  "hp-installment": "HP instalment",
  "hp-redemption": "HP redemption",
};

export const PROVIDER_LABELS: Record<MomoProvider, string> = {
  mtn: "MTN MoMo",
  vod: "Telecel Cash",
  atl: "AT Money",
};

export const PROVIDER_OPTIONS: { value: MomoProvider; label: string }[] = [
  { value: "mtn", label: "MTN MoMo" },
  { value: "vod", label: "Telecel Cash" },
  { value: "atl", label: "AT Money" },
];

export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  pending: "Awaiting approval",
  success: "Paid",
  failed: "Not paid",
};

export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  pending: "Not yet applied",
  applied: "Applied",
  failed: "Could not apply",
};

export const CHARGE_STATUS_TONE: Record<ChargeStatus, "success" | "warning" | "danger"> = {
  pending: "warning",
  success: "success",
  failed: "danger",
};

export const EXECUTION_STATUS_TONE: Record<
  ExecutionStatus,
  "success" | "warning" | "danger"
> = {
  pending: "warning",
  applied: "success",
  failed: "danger",
};

/* ------------------------------------------------------------------- rules --- */

/** The API's own pattern for a Ghanaian mobile number. */
export const PHONE_RE = /^0[25]\d{8}$/;

export function checkPhone(phone: string): string | null {
  if (!phone.trim()) return "Enter the number to charge.";
  if (!PHONE_RE.test(phone.trim())) {
    return "Ten digits starting 02 or 05.";
  }
  return null;
}

/** Redemption is always the full remaining balance, so it takes no amount. */
export function needsAmount(kind: ChargeKind): boolean {
  return kind !== "hp-redemption";
}

/** True while the charge could still change — worth polling. */
export function isSettling(charge: Pick<PaystackCharge, "status" | "executionStatus">): boolean {
  return charge.status === "pending" || charge.executionStatus === "pending";
}

/**
 * The case that needs a person: Paystack took the money and the API could not
 * put it anywhere. Neither status alone says this, which is exactly why both
 * are always on screen.
 */
export function needsReconciliation(
  charge: Pick<PaystackCharge, "status" | "executionStatus">,
): boolean {
  return charge.status === "success" && charge.executionStatus === "failed";
}
