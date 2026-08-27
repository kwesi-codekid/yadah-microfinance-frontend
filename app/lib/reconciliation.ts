/**
 * Reconciliation types and display constants shared by the server and the
 * browser. Nothing here may import a `.server` module or the API client — it is
 * bundled into the client. The fetch functions live in `~/api/reconciliation`.
 *
 * The end-of-day cash handover, in two steps by two different people. The
 * collector **declares** what they are handing over; the office **confirms**
 * what it actually counted. Three figures come out of that and they are not
 * interchangeable:
 *
 *   - `expectedAmount` — what the system says passed through their hands.
 *   - `declaredAmount` — what the collector said they had.
 *   - `receivedAmount` — what the office counted.
 *
 * `variance` is received less expected: the real gap, and the one that matters.
 * `declaredVsReceived` is a separate thing — a collector who declares honestly
 * and comes up short has made an error, one who declares a figure they do not
 * hand over has done something else. Folding the two together loses exactly the
 * distinction the process exists to draw, so both are shown.
 *
 * A shortage is recorded, never blocked. The collector keeps working and the
 * gap surfaces in the variance report.
 */

export type ReconciliationStatus = "declared" | "reconciled";

/**
 * What the day is expected to come to, before anything is counted. Cash
 * channel only: a Paystack or momo deposit never passed through the
 * collector's hands, and a transfer leg is not cash. Loans and hire purchase
 * are excluded outright — those are collected at the office.
 */
export interface ExpectedCash {
  collectorId: string;
  accraDay: string;
  susu: number;
  savings: number;
  total: number;
  /** How many deposits make up the total. */
  entries: number;
}

export interface Reconciliation {
  id: string;
  collectorId: string;
  /** Present on list responses, for display. */
  collectorName?: string;
  /** The Accra day being closed, `YYYY-MM-DD`. */
  accraDay: string;
  /** Recomputed at confirmation, not reused from declaration. */
  expectedAmount: number;
  expectedBreakdown: { susu: number; savings: number };
  declaredAmount: number;
  declaredAt: string;
  declaredNote?: string;
  /** Set at step two. Absent while the day is still `declared`. */
  receivedAmount?: number;
  receivedById?: string;
  receivedAt?: string;
  /** `receivedAmount − expectedAmount`. Negative is short. */
  variance?: number;
  /** `receivedAmount − declaredAmount`. A different question — see above. */
  declaredVsReceived?: number;
  varianceReason?: string;
  status: ReconciliationStatus;
}

/** One collector's record over a range, as the variance report groups it. */
export interface VarianceRow {
  collectorId: string;
  collectorName: string;
  days: number;
  daysWithVariance: number;
  totalExpected: number;
  totalReceived: number;
  /** Shorts and overs netted off. */
  netVariance: number;
  /** Shortfalls alone, as a positive number. */
  totalShort: number;
  /** Overages alone, as a positive number. */
  totalOver: number;
}

export interface VarianceReport {
  period: { from: string | null; to: string | null };
  rows: VarianceRow[];
  totals: {
    netVariance: number;
    totalShort: number;
    totalOver: number;
    daysWithVariance: number;
  };
}

/* ------------------------------------------------------------------ labels --- */

export const STATUS_LABELS: Record<ReconciliationStatus, string> = {
  declared: "Awaiting count",
  reconciled: "Reconciled",
};

/** What each state asks of whoever is looking at it. */
export const STATUS_BLURBS: Record<ReconciliationStatus, string> = {
  declared: "The collector has handed over. The office has not counted it yet.",
  reconciled: "Counted and closed. Any gap is recorded against the day.",
};

export const STATUS_TONE: Record<ReconciliationStatus, "warning" | "muted"> = {
  declared: "warning",
  reconciled: "muted",
};

/* ------------------------------------------------------------------- rules --- */

/** True while the day is still waiting for the office to count it. */
export function isPending(row: Pick<Reconciliation, "status">): boolean {
  return row.status === "declared";
}

/**
 * How a variance reads: short, over, or square. Zero is its own case rather
 * than a shade of one of the others — "balanced" is the answer people are
 * looking for, and it should not have to be inferred from a missing minus sign.
 */
export type VarianceKind = "short" | "over" | "square";

export function varianceKind(pesewas: number | null | undefined): VarianceKind {
  if (pesewas == null || pesewas === 0) return "square";
  return pesewas < 0 ? "short" : "over";
}

export const VARIANCE_LABELS: Record<VarianceKind, string> = {
  short: "Short",
  over: "Over",
  square: "Balanced",
};

export const VARIANCE_TONE: Record<VarianceKind, "danger" | "warning" | "success"> = {
  short: "danger",
  over: "warning",
  square: "success",
};

/**
 * A declaration, checked before the round trip. The figure is recorded as
 * given — a mismatch with the system total is information for whoever counts
 * it, not an error to correct here, so this only refuses what is not a figure
 * at all.
 */
export function checkDeclaredAmount(pesewas: number | null): string | null {
  if (pesewas == null || !Number.isFinite(pesewas) || pesewas < 0) {
    return "Enter what you are handing over.";
  }
  return null;
}

/** The counted figure, same rule. Zero is legitimate — a day with no round. */
export function checkReceivedAmount(pesewas: number | null): string | null {
  if (pesewas == null || !Number.isFinite(pesewas) || pesewas < 0) {
    return "Enter what you counted.";
  }
  return null;
}

/**
 * Whether a reason has to be given for this gap. The API does not demand one,
 * but a variance closed in silence is a variance nobody can explain a month
 * later, so the screen asks for one whenever the figures disagree.
 */
export function reasonExpected(expected: number, received: number): boolean {
  return expected !== received;
}
