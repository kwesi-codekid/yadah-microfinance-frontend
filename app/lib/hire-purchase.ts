/**
 * Hire purchase types and display constants shared by the server and the
 * browser. Nothing here may import a `.server` module or the API client — it is
 * bundled into the client. The fetch functions live in `~/api/hire-purchase`.
 *
 * Two things live under this module and they are not the same thing. The
 * **inventory** is a shelf: items with a stock count, a cost price the customer
 * must never see, and a selling price. An **agreement** is a contract against
 * one unit of one item: half the selling price down, the rest financed, and a
 * lifecycle that can end in ownership, redemption or forfeiture.
 *
 * Signing snapshots the prices, so editing an item later never rewrites a
 * contract that was already signed.
 */

/* --------------------------------------------------------------- inventory --- */

export type ItemCondition = "new" | "used";

export type ItemStatus = "active" | "discontinued";

/** The two managed lists an item is filed under: who makes it, what kind of thing it is. */
export type LabelKind = "brand" | "category";

export interface ItemLabel {
  id: string;
  kind: LabelKind;
  name: string;
  description?: string;
  /** Items on the shelf filed under it, trashed ones excluded. */
  itemCount: number;
  createdAt: string;
}

/** A label as an item carries it: enough to show and to filter by. */
export interface LabelRef {
  id: string;
  name: string;
}

export interface HpItem {
  id: string;
  name: string;
  brand?: LabelRef;
  category?: LabelRef;
  description?: string;
  quantityInStock: number;
  /** What Yadah paid. Office-only — this must never reach a customer-facing view. */
  costPrice: number;
  /** What the customer pays. The figure every agreement is built from. */
  sellingPrice: number;
  /** Forfeited repossessions come back onto the shelf as `used`. */
  condition: ItemCondition;
  status: ItemStatus;
  createdAt: string;
}

export interface TrashedHpItem extends HpItem {
  deletedAt: string;
  deletedById?: string;
  deleteReason?: string;
}

/* -------------------------------------------------------------- agreements --- */

/**
 * The full lifecycle. `pending` until the deposit lands, `active` while it is
 * being paid off, and then one of four endings — three of which involve the
 * item coming back.
 */
export type AgreementStatus =
  /** Signed at the counter by a teller; a manager has yet to let it stand. */
  | "awaiting-approval"
  | "pending"
  | "rejected"
  | "active"
  | "in-arrears"
  | "repossessed"
  | "closed-redeemed"
  | "closed-forfeited"
  | "closed-completed";

export type PaymentChannel = "cash" | "paystack" | "momo";

export interface HpAgreement {
  id: string;
  customerId: string;
  /** Present on list responses, for display. */
  customerName?: string;
  /** Snapshotted at signing. Later edits to the item never reach back here. */
  item: { name: string; description?: string; sellingPrice: number };
  /** Exactly half the selling price. Must be paid to the pesewa. */
  depositRequired: number;
  /** The other half — what interest is charged on. */
  financedAmount: number;
  durationMonths: number;
  /** Snapshotted at signing. Flat, applied once at activation. */
  interestRatePercent: number;
  /** Set at activation. */
  interestAmount?: number;
  /** `financedAmount + interestAmount` — what remains after the deposit. */
  totalPayable?: number;
  /** `totalPayable` less payments; the deposit is not counted. Zero before activation. */
  remaining: number;
  totalPaid: number;
  status: AgreementStatus;
  /** When the deposit landed and the item left the shop. */
  itemReleasedAt?: string;
  arrearsAt?: string;
  repossessedAt?: string;
  repossessionReason?: string;
  /** `repossessedAt` plus one month, exactly. Legally sensitive — never rounded. */
  redemptionDeadline?: string;
  closedAt?: string;
  rejectionReason?: string;
  /** A picture of the customer's signature on the agreement. */
  signatureUrl?: string;
  createdAt: string;
}

export interface TrashedHpAgreement extends HpAgreement {
  deletedAt: string;
  deletedById?: string;
  deleteReason?: string;
}

/** One payment against an agreement, as the detail endpoint returns it. */
export interface HpPayment {
  id: string;
  amount: number;
  /** `deposit` · `installment` · `redemption`, plus how it arrived. */
  type?: string;
  source?: string;
  channel?: string;
  recordedById?: string;
  createdAt: string;
}

/**
 * `GET /hire-purchase/config`. Typed as an opaque object in the spec, so the
 * rate is optional and the screens fall back rather than render a blank.
 */
export interface HpConfig {
  interestRatePercent?: number;
}

/** What the API says about a customer before an agreement can be signed. */
export interface HpEligibility {
  customer?: { id: string; fullName: string };
  eligible?: boolean;
  /** Each unmet condition, in the API's own words, for the form to list. */
  reasons?: string[];
  /** Both sides of the ID document on the profile — a condition in its own right. */
  hasIdDocument?: boolean;
  hasActiveSusuOrSavings?: boolean;
  /** A loan is open on the customer. Loans and hire purchase block each other. */
  openLoan?: boolean;
  /** An agreement is already open on the customer. */
  openHpAgreement?: boolean;
  monthsOfHistory?: number;
}

/* -------------------------------------------------------------- the halves --- */

/** The deposit is exactly half the selling price. Nothing about that is configurable. */
export const DEPOSIT_SHARE = 0.5;

/** What the deposit on an item will be, for the sign-up form's preview. */
export function depositFor(sellingPrice: number): number {
  return Math.round(sellingPrice * DEPOSIT_SHARE);
}

/** What is financed once the deposit is down. */
export function financedFor(sellingPrice: number): number {
  return sellingPrice - depositFor(sellingPrice);
}

/* ------------------------------------------------------------------ labels --- */

export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  "awaiting-approval": "Awaiting approval",
  pending: "Awaiting deposit",
  rejected: "Rejected",
  active: "Active",
  "in-arrears": "In arrears",
  repossessed: "Repossessed",
  "closed-redeemed": "Redeemed",
  "closed-forfeited": "Forfeited",
  "closed-completed": "Completed",
};

/**
 * What each state means on the shop floor, in one line. The three closed states
 * are told apart by where the item ended up, which is the only thing anyone
 * asks about an agreement after it is over.
 */
export const AGREEMENT_STATUS_BLURBS: Record<AgreementStatus, string> = {
  "awaiting-approval":
    "Signed at the counter. A manager has to approve it before a deposit can be taken.",
  pending: "Signed. The item stays in the shop until the deposit is paid.",
  rejected: "Turned down. The unit went back on the shelf.",
  active: "Item released and instalments running.",
  "in-arrears": "Behind on instalments. Repossession is the next step.",
  repossessed: "Item recovered. The customer may redeem it until the deadline.",
  "closed-redeemed": "Redeemed in full. The item is the customer's.",
  "closed-forfeited": "The window lapsed. Item and payments are Yadah's.",
  "closed-completed": "Paid off. The item is the customer's.",
};

export const AGREEMENT_STATUS_TONE: Record<
  AgreementStatus,
  "success" | "info" | "warning" | "danger" | "muted"
> = {
  "awaiting-approval": "warning",
  pending: "info",
  rejected: "muted",
  active: "success",
  "in-arrears": "warning",
  repossessed: "danger",
  "closed-redeemed": "muted",
  "closed-forfeited": "muted",
  "closed-completed": "muted",
};

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  active: "Active",
  discontinued: "Discontinued",
};

export const CONDITION_LABELS: Record<ItemCondition, string> = {
  new: "New",
  used: "Used",
};

export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  deposit: "Deposit",
  installment: "Instalment",
  redemption: "Redemption",
};

export const CHANNEL_LABELS: Record<string, string> = {
  cash: "Cash",
  momo: "MoMo",
  paystack: "Paystack",
  transfer: "Transfer",
};

export const CHANNEL_OPTIONS: { value: PaymentChannel; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "momo", label: "MoMo" },
  { value: "paystack", label: "Paystack" },
];

/* ---------------------------------------------------------- the state gate --- */

/** Waiting on its 50% deposit. The item is still on the shelf, reserved. */
export function awaitingDeposit(a: Pick<HpAgreement, "status">): boolean {
  return a.status === "pending";
}

/**
 * Signed at the counter and waiting on a manager. The unit is reserved just as
 * it is for a pending one, so nothing can be sold out from under it — but no
 * deposit may be taken until somebody senior lets it stand.
 */
export function awaitingApproval(a: Pick<HpAgreement, "status">): boolean {
  return a.status === "awaiting-approval";
}

/** Running: the item is out and instalments are due. */
export function isRunning(a: Pick<HpAgreement, "status">): boolean {
  return a.status === "active" || a.status === "in-arrears";
}

/** Over, whichever way it ended. */
export function isClosed(a: Pick<HpAgreement, "status">): boolean {
  return a.status.startsWith("closed-") || a.status === "rejected";
}

/** True while the customer can still buy the item back. */
export function isRedeemable(
  a: Pick<HpAgreement, "status" | "redemptionDeadline">,
  now: Date = new Date(),
): boolean {
  if (a.status !== "repossessed" || !a.redemptionDeadline) return false;
  return Date.parse(a.redemptionDeadline) > now.getTime();
}

/**
 * True once the window has closed and the agreement can be forfeited. The API
 * refuses a forfeit while the window is open — this refuses the same thing
 * first, so the button is never offered a moment too early.
 */
export function windowLapsed(
  a: Pick<HpAgreement, "status" | "redemptionDeadline">,
  now: Date = new Date(),
): boolean {
  if (a.status !== "repossessed" || !a.redemptionDeadline) return false;
  return Date.parse(a.redemptionDeadline) <= now.getTime();
}

/**
 * Milliseconds left on the redemption window, floored at zero. The deadline is
 * an exact instant rather than a day, so this is counted in real time and not
 * in Accra days — the difference decides whether someone keeps a fridge.
 */
export function redemptionTimeLeft(
  a: Pick<HpAgreement, "redemptionDeadline">,
  now: Date = new Date(),
): number {
  if (!a.redemptionDeadline) return 0;
  return Math.max(0, Date.parse(a.redemptionDeadline) - now.getTime());
}

/**
 * Only an unpaid agreement that never got going may be trashed. Trashing one
 * that was still reserving a unit puts it back on the shelf — the item never
 * left the shop.
 */
export function canTrashAgreement(
  a: Pick<HpAgreement, "status" | "totalPaid">,
): boolean {
  return (
    (a.status === "pending" ||
      a.status === "awaiting-approval" ||
      a.status === "rejected") &&
    a.totalPaid === 0
  );
}

/* ------------------------------------------------------------------- rules --- */

/** How much of what is payable has been paid, 0–1. */
export function paymentProgress(
  a: Pick<HpAgreement, "totalPayable" | "totalPaid">,
): number {
  const payable = a.totalPayable ?? 0;
  if (payable <= 0) return 0;
  return Math.max(0, Math.min(1, a.totalPaid / payable));
}

/**
 * The deposit has to equal `depositRequired` to the pesewa — the API answers
 * `DEPOSIT_MISMATCH` for anything else. Returns the fault, or null.
 */
export function checkDeposit(
  a: Pick<HpAgreement, "depositRequired">,
  pesewas: number | null,
): string | null {
  if (pesewas == null || !Number.isFinite(pesewas) || pesewas <= 0) {
    return "Enter the deposit received.";
  }
  if (pesewas !== a.depositRequired) {
    return "The deposit has to be exactly half the selling price.";
  }
  return null;
}

/**
 * A payment is allocated oldest-instalment-first and an overpayment is refused
 * with the exact remaining balance. Returns the fault, or null.
 */
export function checkPayment(
  a: Pick<HpAgreement, "remaining">,
  pesewas: number | null,
): string | null {
  if (pesewas == null || !Number.isFinite(pesewas) || pesewas <= 0) {
    return "Enter the cash received.";
  }
  if (pesewas > a.remaining) return "More than this agreement still owes.";
  return null;
}

/**
 * What a stock adjustment would leave on the shelf. The API refuses a negative
 * result with `STOCK_UNDERFLOW`, so the form says so before it submits.
 */
export function stockAfter(
  item: Pick<HpItem, "quantityInStock">,
  delta: number,
): number {
  return item.quantityInStock + delta;
}

/**
 * The margin on an item, in pesewas. Office-only by association: it is derived
 * from the cost price, so anywhere this is shown, the cost price effectively is
 * too.
 */
export function marginOf(
  item: Pick<HpItem, "costPrice" | "sellingPrice">,
): number {
  return item.sellingPrice - item.costPrice;
}

/** That margin as a percentage of cost, or null when the item cost nothing. */
export function marginPercent(
  item: Pick<HpItem, "costPrice" | "sellingPrice">,
): number | null {
  if (item.costPrice <= 0) return null;
  return Math.round((marginOf(item) / item.costPrice) * 100);
}

/** True when nothing is on the shelf, so no new agreement can be signed. */
export function outOfStock(item: Pick<HpItem, "quantityInStock">): boolean {
  return item.quantityInStock <= 0;
}

/** True when the item can back a new agreement today. */
export function isSellable(
  item: Pick<HpItem, "status" | "quantityInStock">,
): boolean {
  return item.status === "active" && item.quantityInStock > 0;
}
