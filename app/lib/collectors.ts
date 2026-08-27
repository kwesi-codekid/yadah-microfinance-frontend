/**
 * Round-sheet types and rules shared by the server and the browser. Nothing
 * here may import a `.server` module or the API client — it is bundled into
 * the client. The fetch functions live in `~/api/collectors`.
 *
 * The field app's home screen, in two halves the API answers separately:
 *
 *   - the **round** — who still owes a susu deposit today, how much, and where
 *     to find them. Susu is the only product with a daily schedule, so it is
 *     the only one that can be "due" at a stop; savings are voluntary and
 *     loans and hire purchase are paid at the office.
 *   - the **day** — what has been taken so far, susu and savings together,
 *     and the cash figure the collector will be asked to hand over.
 *
 * A deposit recorded by *any* collector satisfies the day, so a stop covered
 * by a colleague drops off the sheet rather than being chased twice.
 */

export interface RoundSusu {
  accountId: string;
  accountNumber: string;
  dailyAmount: number;
  depositsCount: number;
  daysRemainingInCycle: number;
  collectedToday: number;
  /** One day's deposit less anything already taken today. */
  stillDue: number;
}

export interface RoundStop {
  customerId: string;
  customerName: string;
  phone: string;
  residentialAddress?: string;
  ghanaPostGps?: string;
  photoUrl?: string;
  susu: RoundSusu[];
  totalStillDue: number;
  /** True once every susu account has today's deposit. */
  done: boolean;
}

export interface CollectorRound {
  /** Accra day, `YYYY-MM-DD`. */
  date: string;
  collectorId: string;
  stops: RoundStop[];
  totals: {
    customers: number;
    customersDone: number;
    susuAccounts: number;
    expectedTotal: number;
    collectedTotal: number;
    stillDueTotal: number;
  };
}

export type DayProduct = "susu" | "savings";

export interface DayEntry {
  id: string;
  product: DayProduct;
  accountId: string;
  accountNumber: string;
  customerId: string;
  customerName: string;
  amount: number;
  channel: string;
  at: string;
}

export interface CollectorDay {
  date: string;
  collectorId: string;
  susu: { count: number; amount: number };
  savings: { count: number; amount: number };
  /** Cash channel only — what must be handed over. */
  cashTotal: number;
  entries: DayEntry[];
  /** Null until the collector declares the day. */
  reconciliation: { id: string; status: string; declaredAmount: number } | null;
}

/* ------------------------------------------------------------------ labels --- */

export const PRODUCT_LABELS: Record<DayProduct, string> = {
  susu: "Susu",
  savings: "Savings",
};

export const CHANNEL_LABELS: Record<string, string> = {
  cash: "Cash",
  momo: "Mobile money",
  paystack: "Mobile money",
  transfer: "Transfer",
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

/* ------------------------------------------------------------------- rules --- */

/** How far through the round, as a fraction for the bar. */
export function roundProgress(totals: CollectorRound["totals"]): number {
  if (totals.customers === 0) return 1;
  return totals.customersDone / totals.customers;
}

/** Where the account behind a day entry lives in this app. */
export function entryPath(entry: Pick<DayEntry, "product" | "accountId">): string {
  return entry.product === "susu"
    ? `/susu/${entry.accountId}`
    : `/savings/${entry.accountId}`;
}

/**
 * The link for a stop: straight into the collect-all drawer for that customer,
 * which takes one cash amount across every active account at once. The stop
 * is the customer, not one of their accounts, so this is the right door.
 */
export function collectPath(stop: Pick<RoundStop, "customerId">): string {
  return `/susu/collect?customerId=${encodeURIComponent(stop.customerId)}`;
}

/**
 * Where a stop's name leads. The customer record is office-only, so for
 * everyone the door is the susu account the deposit is due on — which a
 * collector may open, and which is what they came to collect against.
 */
export function stopPath(stop: Pick<RoundStop, "customerId" | "susu">): string {
  const first = stop.susu[0];
  return first ? `/susu/${first.accountId}` : `/susu?search=${encodeURIComponent(stop.customerId)}`;
}

/** A map link for the address, when there is one to go to. */
export function mapsHref(stop: Pick<RoundStop, "ghanaPostGps" | "residentialAddress">): string | null {
  const q = stop.ghanaPostGps?.trim() || stop.residentialAddress?.trim();
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}
