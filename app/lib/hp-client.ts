/**
 * Hire purchase, client-safe.
 *
 * The product in a paragraph: the office stocks items, a customer signs for one
 * over 1–24 months, and pays **half the selling price as a deposit before the
 * item leaves the shop**. Interest is flat and applied once at activation, so
 * settling early pays the same total. Miss enough of it and the item is
 * repossessed — with one month to redeem it by paying the whole remaining
 * balance, after which it is forfeited and may be restocked as used.
 */

import {
  PAYMENT_CHANNELS,
  PAYMENT_CHANNEL_LABELS,
  isPaymentChannel,
  type PaymentChannel,
} from "~/lib/channel";

export type HpChannel = PaymentChannel;
export const HP_CHANNELS = PAYMENT_CHANNELS;
export const HP_CHANNEL_LABELS = PAYMENT_CHANNEL_LABELS;
export const isHpChannel = isPaymentChannel;

/** The deposit is exactly half the selling price. The API enforces it. */
export const HP_DEPOSIT_PERCENT = 50;

/** Longest term the API accepts. */
export const HP_MAX_MONTHS = 24;

export type HpItemStatus = "active" | "discontinued";

export const HP_ITEM_STATUSES: HpItemStatus[] = ["active", "discontinued"];

export const HP_ITEM_STATUS_LABELS: Record<HpItemStatus, string> = {
  active: "Stocked",
  discontinued: "Discontinued",
};

export type HpCondition = "new" | "used";

export const HP_CONDITION_LABELS: Record<HpCondition, string> = {
  new: "New",
  used: "Used",
};

export interface HpItem {
  id: string;
  name: string;
  description?: string;
  quantityInStock: number;
  /** What Yadah paid. Office-only — never put this in front of a customer. */
  costPrice: number;
  /** What the customer pays. */
  sellingPrice: number;
  /** Forfeited repossessions come back into stock as `used`. */
  condition: HpCondition;
  status: HpItemStatus;
}

export type HpAgreementStatus =
  | "pending"
  | "rejected"
  | "active"
  | "in-arrears"
  | "repossessed"
  | "closed-redeemed"
  | "closed-forfeited"
  | "closed-completed";

export const HP_AGREEMENT_STATUSES: HpAgreementStatus[] = [
  "pending",
  "active",
  "in-arrears",
  "repossessed",
  "closed-completed",
  "closed-redeemed",
  "closed-forfeited",
  "rejected",
];

export const HP_AGREEMENT_STATUS_LABELS: Record<HpAgreementStatus, string> = {
  pending: "Awaiting deposit",
  rejected: "Rejected",
  active: "Active",
  "in-arrears": "In arrears",
  repossessed: "Repossessed",
  "closed-redeemed": "Redeemed",
  "closed-forfeited": "Forfeited",
  "closed-completed": "Settled",
};

/** The snapshot taken at signing — prices here never follow the item's. */
export interface HpAgreementItem {
  name: string;
  description?: string;
  sellingPrice: number;
}

export interface HpAgreement {
  id: string;
  customerId: string;
  customerName?: string;
  item: HpAgreementItem;
  /** Half the selling price, due before the item is released. */
  depositRequired: number;
  /** The other half, which the instalments carry. */
  financedAmount: number;
  durationMonths: number;
  interestRatePercent: number;
  interestAmount?: number;
  totalPayable?: number;
  remaining: number;
  totalPaid: number;
  status: HpAgreementStatus;
  itemReleasedAt?: string;
  arrearsAt?: string;
  repossessedAt?: string;
  repossessionReason?: string;
  /** Repossession + one month, exact. Redemption is refused after it. */
  redemptionDeadline?: string;
  closedAt?: string;
  rejectionReason?: string;
  createdAt: string;
}

export interface HpConfig {
  interestRatePercent: number;
}

/**
 * `GET /hire-purchase/config` is declared as a propertyless object, exactly as
 * the loans one is, so the field name is read rather than trusted. `complete`
 * is false when nothing usable came back and the page is showing a fallback.
 */
export function normalizeHpConfig(raw: unknown): {
  config: HpConfig;
  complete: boolean;
} {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  // Accept the PUT body's name first, then the obvious alternatives.
  for (const key of ["interestRatePercent", "interestRate", "ratePercent", "rate"]) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return { config: { interestRatePercent: value }, complete: true };
    }
  }
  return { config: { interestRatePercent: 0 }, complete: false };
}

export function isHpItemStatus(v: unknown): v is HpItemStatus {
  return typeof v === "string" && (HP_ITEM_STATUSES as string[]).includes(v);
}

export function isHpAgreementStatus(v: unknown): v is HpAgreementStatus {
  return (
    typeof v === "string" && (HP_AGREEMENT_STATUSES as string[]).includes(v)
  );
}

/** Open = the money is still moving. Everything else is history. */
export function isOpenAgreement(status: HpAgreementStatus): boolean {
  return status === "active" || status === "in-arrears";
}

/** What the office made on one unit. Cost is not the customer's business. */
export function marginOf(item: HpItem): number {
  return item.sellingPrice - item.costPrice;
}

/** The deposit this item would ask for, before any agreement exists. */
export function depositFor(sellingPrice: number): number {
  return Math.round((sellingPrice * HP_DEPOSIT_PERCENT) / 100);
}

/** 0–100, rounded. For a progress bar; use the figures for anything counted. */
export function paidPercent(agreement: HpAgreement): number {
  const total = agreement.totalPaid + agreement.remaining;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((agreement.totalPaid / total) * 100));
}

/**
 * Whether the redemption window is still open, read against the browser's
 * clock. The API decides for real — this only shapes what the page offers.
 */
export function redemptionOpen(agreement: HpAgreement, now: Date): boolean {
  if (!agreement.redemptionDeadline) return false;
  return new Date(agreement.redemptionDeadline).getTime() > now.getTime();
}

/** `422 DEPOSIT_MISMATCH` / `EXCEEDS_BALANCE` — the API's own figure. */
export function readHpAmount(
  details: unknown,
  key: "required" | "remaining",
): number | null {
  if (details && typeof details === "object" && key in details) {
    const value = (details as Record<string, unknown>)[key];
    if (typeof value === "number") return value;
  }
  return null;
}

/**
 * `GET /hire-purchase/agreements/{id}` is another undeclared response. Read the
 * agreement out of it whether it arrives wrapped or bare, and hand back any
 * payment rows alongside — the page renders whatever columns they carry.
 */
export function readAgreementPayload(payload: unknown): {
  agreement: HpAgreement | null;
  payments: Record<string, unknown>[];
} {
  if (!payload || typeof payload !== "object") {
    return { agreement: null, payments: [] };
  }
  const source = payload as Record<string, unknown>;

  const wrapped = source.agreement;
  const agreement =
    wrapped && typeof wrapped === "object"
      ? (wrapped as HpAgreement)
      : "status" in source && "item" in source
        ? (source as unknown as HpAgreement)
        : null;

  // Payments may be `payments`, or a `schedule` once Stage B lands.
  for (const key of ["payments", "schedule", "instalments", "installments"]) {
    const rows = source[key];
    if (Array.isArray(rows) && rows.every((r) => r && typeof r === "object")) {
      return { agreement, payments: rows as Record<string, unknown>[] };
    }
  }
  return { agreement, payments: [] };
}

/**
 * The eligibility summary, read defensively — its response is undeclared too.
 * The gates the API names: an active susu or savings account, three months of
 * saving history, no active loan, and no open agreement.
 */
export function readHpEligibility(payload: unknown): {
  eligible: boolean | null;
  reasons: string[];
} {
  if (!payload || typeof payload !== "object") {
    return { eligible: null, reasons: [] };
  }
  const source = payload as Record<string, unknown>;
  const inner =
    source.eligibility && typeof source.eligibility === "object"
      ? (source.eligibility as Record<string, unknown>)
      : source;

  const flag = inner.eligible ?? inner.isEligible ?? inner.ok;
  const reasons = readEligibilityReasons(inner);

  return {
    eligible: typeof flag === "boolean" ? flag : reasons.length ? false : null,
    reasons,
  };
}

/** `422 NOT_ELIGIBLE` — the API lists why, in its own words. */
export function readEligibilityReasons(details: unknown): string[] {
  if (details && typeof details === "object" && "reasons" in details) {
    const reasons = (details as { reasons?: unknown }).reasons;
    if (Array.isArray(reasons)) {
      return reasons.filter((r): r is string => typeof r === "string");
    }
  }
  return [];
}

export { newIdempotencyKey } from "~/lib/idempotency";
