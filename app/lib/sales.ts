/**
 * Counter-sale types and display constants shared by the server and the
 * browser. Nothing here may import a `.server` module or the API client — it is
 * bundled into the client. The fetch functions live in `~/api/sales`.
 *
 * An outright sale is the till, not a contract: stock out, money in, no
 * deposit, no instalments, no agreement. It sits under the hire-purchase prefix
 * on the API because it draws down the same shelf, but nothing else about it is
 * shared, which is why it has a module of its own here.
 *
 * Two things separate it from an agreement and both shape the screen. The buyer
 * **need not be a registered customer** — a walk-in gives a name and that is
 * enough, because demanding a photo and both sides of an ID to sell a kettle is
 * absurd. And it is a **basket**: several items, several quantities, one total.
 */

export type SaleStatus = "completed" | "voided";

/** How the money arrived at the till. */
export type SaleChannel = "cash" | "paystack" | "momo";

/**
 * One line of a completed sale, as the API returns it. `unitPrice` is what was
 * actually charged and `listPrice` what the shelf said — they differ only when
 * someone haggled, and the receipt shows both so a discount is never invisible.
 */
export interface SaleLine {
  itemId: string;
  /** Snapshotted at the sale. Later inventory edits never reach back here. */
  name: string;
  quantity: number;
  unitPrice: number;
  listPrice: number;
  lineTotal: number;
}

export interface Sale {
  id: string;
  /** What the customer's paper says. The number the counter quotes. */
  receiptNo: string;
  /** Null for a walk-in — the case this module exists to allow. */
  customerId: string | null;
  buyerName: string;
  buyerPhone?: string;
  lines: SaleLine[];
  subtotal: number;
  /** List total less what was charged. Zero on a sale at shelf prices. */
  discount: number;
  total: number;
  channel: string;
  soldById: string;
  status: SaleStatus;
  voidedAt?: string;
  voidReason?: string;
  createdAt: string;
}

/**
 * The figures under a filtered listing. They cover the **whole filter**, not
 * the page on screen, and always exclude voided sales — so a page of ten rows
 * can sit under a total covering four hundred, and the screen has to say so.
 *
 * `profit` is margin over cost. Cost never appears on a line, only here.
 */
export interface SaleTotals {
  salesCount: number;
  revenue: number;
  profit: number;
}

/* ------------------------------------------------------------ the basket --- */

/**
 * A line while it is still being built at the till, before anything is sent.
 *
 * `unitPrice` is left unset for the ordinary case and the API fills it from the
 * item's selling price. It is set only to record a haggled price — which is why
 * the form starts it empty rather than pre-filled with the shelf price: a box
 * that already holds a number invites editing it.
 */
export interface BasketLine {
  itemId: string;
  name: string;
  /** The shelf price, kept for the discount arithmetic and the preview. */
  listPrice: number;
  /** What is left on the shelf, so the till can refuse to oversell. */
  available: number;
  quantity: number;
  /** Pesewas. Null means "charge the list price". */
  unitPrice: number | null;
}

/** What a line comes to at the price that will actually be charged. */
export function lineTotal(line: BasketLine): number {
  return (line.unitPrice ?? line.listPrice) * line.quantity;
}

/** What the line would have come to at the shelf price. */
export function lineListTotal(line: BasketLine): number {
  return line.listPrice * line.quantity;
}

/** The basket at shelf prices. */
export function basketSubtotal(lines: BasketLine[]): number {
  return lines.reduce((sum, line) => sum + lineListTotal(line), 0);
}

/** What comes off for haggling. Never negative — see `checkLine`. */
export function basketDiscount(lines: BasketLine[]): number {
  return Math.max(0, basketSubtotal(lines) - basketTotal(lines));
}

/** What the buyer actually pays. */
export function basketTotal(lines: BasketLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

/**
 * What is wrong with a line, or null. Stock is checked here rather than left to
 * the API because the till knows what is on the shelf and refusing after the
 * money is counted is the wrong moment to find out.
 */
export function checkLine(line: BasketLine): string | null {
  if (!Number.isFinite(line.quantity) || line.quantity < 1) {
    return "At least one.";
  }
  if (line.quantity > line.available) {
    return line.available === 0
      ? "Out of stock."
      : `Only ${line.available} left on the shelf.`;
  }
  if (line.unitPrice != null) {
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 1) {
      return "Enter the price charged, or clear it for the shelf price.";
    }
    if (line.unitPrice > line.listPrice) {
      // Above list is almost always a slipped decimal point. The API would take
      // it, which is exactly why it is worth catching here.
      return "Above the shelf price. Change the item's price instead.";
    }
  }
  return null;
}

/**
 * Server-side line faults, keyed by item id, to lay over what `checkLine`
 * found. The till checks what it knows about the shelf; the API knows what is
 * on it *now*, and refuses one line by name — `INSUFFICIENT_STOCK`,
 * `ITEM_NOT_FOUND`, `ITEM_DISCONTINUED` — after the money is counted. That
 * refusal belongs on the line it names, in the same place, not in a toast.
 */
export type LineErrors = Record<string, string>;

/**
 * The line a refused `POST /hire-purchase/sales` names, and what to say on it.
 * Empty for any other code, and for a refusal that does not name a line.
 */
export function lineErrorsFromRefusal(
  code: string | undefined,
  details: unknown,
): LineErrors {
  if (!details || typeof details !== "object") return {};
  const d = details as {
    itemId?: unknown;
    requested?: unknown;
    quantityInStock?: unknown;
  };
  if (typeof d.itemId !== "string" || !d.itemId) return {};

  switch (code) {
    case "INSUFFICIENT_STOCK": {
      const left = typeof d.quantityInStock === "number" ? d.quantityInStock : null;
      return {
        [d.itemId]:
          left === 0
            ? "Sold out while ringing up."
            : left != null
              ? `Only ${left} left on the shelf now.`
              : "Not enough on the shelf now.",
      };
    }
    case "ITEM_NOT_FOUND":
      return { [d.itemId]: "No longer on the shelf. Remove it." };
    case "ITEM_DISCONTINUED":
      return { [d.itemId]: "Discontinued. Remove it." };
    default:
      return {};
  }
}

/** What is wrong with the basket as a whole, or null. */
export function checkBasket(lines: BasketLine[]): string | null {
  if (lines.length === 0) return "Add something to the basket.";
  if (lines.some((line) => checkLine(line))) return "Fix the lines marked above.";
  if (basketTotal(lines) < 1) return "The total has to be more than nothing.";
  return null;
}

/**
 * The body `POST /hire-purchase/sales` wants, from a basket.
 *
 * `unitPrice` is dropped when it is null so the API applies the shelf price
 * itself — sending the same number back would record every sale as haggled at
 * exactly list, which is not the same thing and reads wrong on a receipt.
 */
export function linesForApi(
  lines: BasketLine[],
): { itemId: string; quantity: number; unitPrice?: number }[] {
  return lines.map((line) => ({
    itemId: line.itemId,
    quantity: line.quantity,
    ...(line.unitPrice != null ? { unitPrice: line.unitPrice } : {}),
  }));
}

/* ------------------------------------------------------------------ labels --- */

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  completed: "Completed",
  voided: "Voided",
};

/** What each state means at the till, in one line. */
export const SALE_STATUS_BLURBS: Record<SaleStatus, string> = {
  completed: "Sold and counted toward revenue.",
  voided: "Reversed. Stock went back; the row stays on the record.",
};

export const SALE_STATUS_TONE: Record<SaleStatus, "success" | "muted"> = {
  completed: "success",
  voided: "muted",
};

export const CHANNEL_LABELS: Record<string, string> = {
  cash: "Cash",
  momo: "MoMo",
  paystack: "Paystack",
};

export const CHANNEL_OPTIONS: { value: SaleChannel; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "momo", label: "MoMo" },
  { value: "paystack", label: "Paystack" },
];

/* ------------------------------------------------------------------- rules --- */

/** True for a sale to somebody who is not on the books. */
export function isWalkIn(sale: Pick<Sale, "customerId">): boolean {
  return sale.customerId == null;
}

/** Only a completed sale can be voided; voiding is not undoable. */
export function canVoid(sale: Pick<Sale, "status">): boolean {
  return sale.status === "completed";
}

/** How many units a sale moved, across all its lines. */
export function unitCount(sale: Pick<Sale, "lines">): number {
  return sale.lines.reduce((sum, line) => sum + line.quantity, 0);
}
