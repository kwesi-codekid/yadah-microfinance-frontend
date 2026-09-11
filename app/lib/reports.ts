/**
 * Report types and display constants shared by the server and the browser.
 * Nothing here may import a `.server` module or the API client — it is bundled
 * into the client. The fetch functions live in `~/api/reports`.
 *
 * One idea runs through every report and it is worth stating once: **direction
 * is from the company's side of the counter**. A customer's deposit is money
 * *in*; their withdrawal is money *out*. And a transfer between two of the same
 * customer's own products is neither — it is `internal`, and it must never be
 * added to a cash total, because no cash moved. The ledger shows those rows and
 * excludes them from the sums, so the screen has to make the exclusion visible
 * or the figures will look wrong to whoever counts the drawer.
 */

/** The five modules money can move through. */
export type TxnModule = "susu" | "savings" | "loans" | "hire-purchase" | "transfers";

export const MODULES: TxnModule[] = [
  "susu",
  "savings",
  "loans",
  "hire-purchase",
  "transfers",
];

/** Every kind of money event the API reports, across all five modules. */
export type TxnType =
  | "susu-deposit"
  | "susu-payout"
  | "susu-withdrawal"
  | "savings-deposit"
  | "savings-withdrawal"
  | "savings-closure"
  | "loan-disbursement"
  | "loan-repayment"
  | "hp-deposit"
  | "hp-installment"
  | "hp-redemption"
  | "hp-sale"
  | "transfer";

/** From the company's cash perspective. `internal` rows are transfer legs. */
export type Direction = "in" | "out" | "internal";

/** Whether the money actually moved. Only Paystack rows are ever not `completed`. */
export type TxnStatus = "completed" | "pending" | "failed";

/** A count and a total, the pair almost every figure in these reports comes as. */
export interface Tally {
  count: number;
  amount: number;
}

export const RECORDED_BY_KINDS = ["staff", "customer", "system", "unknown"] as const;
export type RecordedByKind = (typeof RECORDED_BY_KINDS)[number];

/** How each kind is named on screen, where the name alone is not enough. */
export const RECORDED_BY_LABELS: Record<RecordedByKind, string> = {
  staff: "Staff",
  customer: "Customer",
  system: "Automated",
  unknown: "Not recorded",
};

export interface UnifiedTransaction {
  id: string;
  module: TxnModule;
  type: TxnType;
  direction: Direction;
  /** Pesewas. */
  amount: number;
  /**
   * Pesewas — the charge taken on this row: a savings withdrawal or closure
   * fee, or the one-day commission charged when a susu account was stopped.
   * A staged susu payout carries it on the instalment that stopped the
   * account and zero on every later one, so it is never counted twice.
   */
  fee: number;
  /**
   * Every ledger row is `completed` — the modules only write once money has
   * moved. `pending` and `failed` appear only where the caller asked for
   * unapplied Paystack charges: pending is awaiting confirmation, failed is
   * money Paystack took that could not be posted. Neither is in `totals`.
   */
  status: TxnStatus;
  channel: string | null;
  /** Payout destination, repayment source, or transfer route — `susu->loan`. */
  detail: string | null;
  customerId: string;
  customerName: string;
  ref: {
    kind:
      | "susu-account"
      | "savings-account"
      | "loan"
      | "hp-agreement"
      | "hp-sale"
      | "transfer";
    id: string;
    /** Present for susu and savings accounts. */
    accountNumber?: string;
  };
  /** Savings rows only: the running balance after this row. */
  balanceAfter?: number;
  recordedById: string | null;
  /** `System` for automated moves; null when the record named nobody. */
  recordedByName: string | null;
  /**
   * Which directory `recordedById` belongs to, and so how to read the name:
   * a member of staff, the customer themselves paying through the portal, an
   * automated move, or a record that never named an actor at all.
   */
  recordedByKind: RecordedByKind;
  createdAt: string;
}

export interface TransactionTotals {
  in: Tally;
  out: Tally;
  /** Transfer legs. Shown, never summed into cash. */
  internal: Tally;
  /** Charges kept inside the range: savings fees plus susu closing commissions. */
  feesCollected: number;
}

export interface TransactionFeed {
  from: string;
  to: string;
  items: UnifiedTransaction[];
  page: number;
  limit: number;
  total: number;
  totals: TransactionTotals;
}

/* --------------------------------------------------------------- dashboard --- */

/**
 * The five `/dashboard/*` endpoints, which exist only to feed this one screen.
 *
 * They are deliberately not the `/reports` endpoints: a report answers a
 * question someone asked, a dashboard states the position without being asked.
 * Money is integer pesewas throughout, as everywhere else in the API.
 */

/**
 * The headline tiles, already flattened by the API. Every value is derived from
 * the blocks below it and repeated only so the screen need not redo the sums.
 */
export interface DashboardKpis {
  /** Customers with status `active`. */
  totalCustomers: number;
  /** Open susu cycles + active savings + open loans + open HP agreements. */
  activeAccounts: number;
  /** Completed cycles not yet paid out. */
  pendingSusuPayouts: Tally;
  /** Today's cash in, pesewas. */
  amountCollectedToday: number;
  /**
   * Against yesterday, one decimal. **Null when yesterday took nothing** —
   * there is no percentage change from zero, so the tile must draw a dash
   * rather than `0%` or `∞`.
   */
  amountCollectedChangePercent: number | null;
  /** Loans in arrears + HP agreements in arrears. */
  inArrears: number;
}

/** `GET /dashboard/summary` — the position right now, computed on every call. */
export interface DashboardSummary {
  kpis: DashboardKpis;
  today: {
    /** Accra calendar day, `YYYY-MM-DD`. */
    day: string;
    cashIn: Tally;
    cashOut: Tally;
    /** Transfer legs — excluded from the two above. */
    internalMoves: Tally;
    in: {
      susuDeposits: Tally;
      savingsDeposits: Tally;
      loanRepayments: Tally;
      hpPayments: Tally;
    };
    out: {
      susuPayouts: Tally;
      savingsWithdrawals: Tally;
      loanDisbursements: Tally;
    };
  };
  /** Yesterday's take, the denominator behind `amountCollectedChangePercent`. */
  yesterday: {
    day: string;
    cashIn: Tally;
  };
  monthToDate: {
    from: string;
    to: string;
    susuCommission: Tally;
    savingsFees: Tally;
    /**
     * Margin on outright counter sales — selling price less cost, voided sales
     * excluded. Trading profit rather than a fee, but earned in the period, so
     * the API counts it toward `totalRevenue` and so must the screen.
     */
    outrightSalesProfit: Tally;
    totalRevenue: number;
  };
  portfolio: {
    customersActive: number;
    susu: {
      activeAccounts: number;
      completedAwaitingClosure: number;
      /** Deposits less anything already withdrawn. */
      valueHeld: number;
      pendingPayout: Tally;
    };
    savings: {
      activeAccounts: number;
      totalBalance: number;
      byType: { standard: Tally; student: Tally };
    };
    loans: { active: number; arrears: number; outstanding: number };
    hirePurchase: { active: number; inArrears: number; outstanding: number };
  };
  generatedAt: string;
}

/** How `GET /dashboard/series` groups its buckets. */
export type SeriesBucket = "day" | "week" | "month";

/**
 * One bucket of the cash series.
 *
 * `expected` and `received` come from **reconciled collector days only**, so
 * the newest buckets legitimately read as zero until the office confirms those
 * handovers — a chart that treats that as a collapse in collections is lying.
 */
export interface CashSeriesPoint {
  /** `2026-08-27` (day), `2026-W35` (ISO week), or `2026-08` (month). */
  key: string;
  cashIn: Tally;
  cashOut: Tally;
  internalMoves: Tally;
  /** Field cash the system recorded collectors taking in. */
  expected: number;
  /** What the office confirmed was turned in. */
  received: number;
}

/**
 * `GET /dashboard/series` — one series behind the cash-flow, collections and
 * reconciliation charts. Every bucket in the range is present, empty ones
 * included: a chart that skips an empty month draws a slope across it and
 * implies activity that never happened.
 */
export interface CashSeries {
  from: string;
  to: string;
  bucket: SeriesBucket;
  points: CashSeriesPoint[];
  totals: {
    cashIn: Tally;
    cashOut: Tally;
    internalMoves: Tally;
    expected: number;
    received: number;
  };
}

/**
 * `GET /dashboard/efficiency` — of the field cash the system recorded
 * collectors taking in, how much the office confirmed receiving.
 *
 * **This measures whether money reached the office, not whether customers paid
 * what they owed.** Loans and hire purchase are collected at the counter and
 * never appear here; only susu and savings cash does. Label it accordingly or
 * it will be read as a repayment rate.
 */
export interface CollectionEfficiency {
  from: string;
  to: string;
  expected: number;
  received: number;
  /** One decimal. Null when nothing was due — draw a dash, not a zero. */
  percent: number | null;
  /** Negative means collectors were short overall. */
  netVariance: number;
  daysReconciled: number;
  daysWithVariance: number;
}

/**
 * A standing condition, not a notification. A notification is one past event
 * addressed to one person; an alert stays true until the work is done and reads
 * the same for everyone in the office. Alerts with nothing behind them are
 * omitted, so an empty array means nothing needs attention.
 */
export interface DashboardAlert {
  /** Stable identifier — key the UI off this, never off the title. */
  key: string;
  severity: "info" | "warning" | "critical";
  title: string;
  /** One sentence stating the condition, already phrased for display. */
  body: string;
  count: number;
  /** Pesewas at stake, or null when the alert is not about an amount. */
  amount: number | null;
  /** Where the work lives, so the action button routes without a lookup table. */
  target: { module: string; filter: Record<string, string> };
}

export interface DashboardAlerts {
  alerts: DashboardAlert[];
  generatedAt: string;
}

/** `GET /dashboard/recent-transactions` — a short window onto the ledger. */
export interface RecentTransactions {
  items: UnifiedTransaction[];
  /** Counts only money that moved: pending and failed rows are excluded. */
  totals: TransactionTotals;
}

/** Where an alert's action button goes. The API names the module; this maps it. */
const ALERT_MODULE_PATHS: Record<string, string> = {
  susu: "/susu",
  savings: "/savings",
  loans: "/loans",
  "hire-purchase": "/hire-purchase",
  hp: "/hire-purchase",
  transfers: "/transfers",
  payments: "/transactions",
  reconciliation: "/reconciliation",
  customers: "/customers",
  reports: "/reports",
};

/**
 * The alert's target as a path this app can navigate to, filter included.
 *
 * The filter arrives as plain strings and is passed straight through as query
 * parameters, so a filter the API adds later still lands on the right screen
 * without a release here. An unknown module falls back to the ledger rather
 * than to a dead link.
 */
export function alertPath(alert: DashboardAlert): string {
  const base = ALERT_MODULE_PATHS[alert.target.module] ?? "/transactions";
  const query = new URLSearchParams(alert.target.filter ?? {}).toString();
  return query ? `${base}?${query}` : base;
}

/** The share of a bucket's expected cash that reached the office, 0–100. */
export function matchRate(point: CashSeriesPoint): number | null {
  if (point.expected <= 0) return null;
  return (point.received / point.expected) * 100;
}

/**
 * `GET /reports/dashboard`, the deprecated alias that `/dashboard/summary`
 * replaced. Kept for the one caller that has not moved yet; new screens read
 * `DashboardSummary`, which carries `kpis` and `yesterday` on top of this.
 *
 * @deprecated Use {@link DashboardSummary}.
 */
export type DashboardMetrics = Omit<DashboardSummary, "kpis" | "yesterday">;

/* ----------------------------------------------------------- other reports --- */

/**
 * `GET /reports/collections`. The spec leaves the payload open, so every field
 * here is optional and every screen reads it defensively. What the endpoint is
 * *for* is settled: susu and savings deposits grouped by whoever recorded them,
 * so the office can reconcile a day's collection against the people who did it.
 */
export interface CollectionsReport {
  from?: string;
  to?: string;
  rows?: CollectionRow[];
  /** Some deployments answer with `items`; both are read. */
  items?: CollectionRow[];
  totals?: Partial<Tally> & { susu?: Tally; savings?: Tally };
}

export interface CollectionRow {
  userId?: string;
  userName?: string;
  name?: string;
  susu?: Partial<Tally>;
  savings?: Partial<Tally>;
  count?: number;
  total?: number;
  amount?: number;
}

/** `GET /reports/loans/outstanding` — open loans, soonest due first. */
export interface OutstandingReport {
  rows?: OutstandingRow[];
  items?: OutstandingRow[];
  totals?: Partial<Tally>;
}

export interface OutstandingRow {
  loanId?: string;
  id?: string;
  customerId?: string;
  customerName?: string;
  principal?: number;
  totalDue?: number;
  remaining?: number;
  dueDate?: string;
  daysOverdue?: number;
  status?: string;
}

/** `GET /reports/loans/aging` — arrears in the three buckets. */
export interface AgingReport {
  buckets?: Record<string, Partial<Tally>>;
  rows?: { bucket?: string; count?: number; amount?: number }[];
  total?: Partial<Tally>;
}

/** `GET /reports/commission` — susu commissions plus savings fees in a range. */
export interface CommissionReport {
  from?: string;
  to?: string;
  susuCommission?: Partial<Tally>;
  savingsFees?: Partial<Tally>;
  /** Margin on outright counter sales in the range. Voided sales excluded. */
  outrightSalesProfit?: Partial<Tally>;
  totalRevenue?: number;
  rows?: unknown[];
}

/**
 * `GET /reports/workers` — heartbeats for the four background workers.
 *
 * In-memory on the API and reset by a restart, and each worker also runs once
 * at startup. A panel of zeroes therefore means "recently restarted", not
 * "broken", and the screen has to say so — otherwise it reads as an outage.
 */
export interface WorkerStatus {
  startedAt: string | null;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  lastChanges: Record<string, number> | null;
  runs?: number;
}

export type WorkersReport = { workers: Record<string, WorkerStatus> };

/* ------------------------------------------------------------------ labels --- */

export const MODULE_LABELS: Record<TxnModule, string> = {
  susu: "Susu",
  savings: "Savings",
  loans: "Loans",
  "hire-purchase": "Hire purchase",
  transfers: "Transfers",
};

/**
 * The module colours, matching `--module-*` in `app.css` and `chart-1..5`. A
 * legend and a chart must never disagree, so both read from the same names.
 */
export const MODULE_DOT: Record<TxnModule, string> = {
  susu: "bg-module-susu",
  savings: "bg-module-savings",
  loans: "bg-module-loans",
  "hire-purchase": "bg-module-hp",
  transfers: "bg-module-transfers",
};

export const MODULE_VAR: Record<TxnModule, string> = {
  susu: "var(--module-susu)",
  savings: "var(--module-savings)",
  loans: "var(--module-loans)",
  "hire-purchase": "var(--module-hp)",
  transfers: "var(--module-transfers)",
};

/** What each row actually was, in the words the branch uses. */
export const TXN_TYPE_LABELS: Record<TxnType, string> = {
  "susu-deposit": "Susu deposit",
  "susu-payout": "Susu payout",
  "susu-withdrawal": "Susu withdrawal",
  "savings-deposit": "Savings deposit",
  "savings-withdrawal": "Savings withdrawal",
  "savings-closure": "Savings closure",
  "loan-disbursement": "Loan disbursed",
  "loan-repayment": "Loan repayment",
  "hp-deposit": "HP deposit",
  "hp-installment": "HP instalment",
  "hp-redemption": "HP redemption",
  "hp-sale": "Counter sale",
  transfer: "Transfer",
};

export const DIRECTION_LABELS: Record<Direction, string> = {
  in: "In",
  out: "Out",
  internal: "Internal",
};

/** The sign a figure carries in the ledger. Internal rows carry none. */
export const DIRECTION_SIGN: Record<Direction, string> = {
  in: "+",
  out: "−",
  internal: "",
};

/* ------------------------------------------------------------------- rules --- */

/** True for a transfer leg — shown in the ledger, never counted as cash. */
export function isInternal(txn: Pick<UnifiedTransaction, "direction">): boolean {
  return txn.direction === "internal";
}

/**
 * Cash in less cash out. Internal rows are absent by construction: the API's
 * own totals split them out, and this only ever reads the two cash figures.
 */
export function netCash(totals: TransactionTotals): number {
  return totals.in.amount - totals.out.amount;
}

/** Where a ledger row points, so the customer's record is always one click away. */
export function refPath(txn: UnifiedTransaction): string | null {
  switch (txn.ref.kind) {
    case "susu-account":
      return `/susu/${txn.ref.id}`;
    case "savings-account":
      return `/savings/${txn.ref.id}`;
    case "loan":
      return `/loans/${txn.ref.id}`;
    case "hp-agreement":
      return `/hire-purchase/${txn.ref.id}`;
    default:
      // A transfer has no page of its own — its legs are the record.
      return null;
  }
}

/**
 * Where a ledger row's printable receipt lives, or null when there is none.
 *
 * Every receipt route is keyed by the owning record (`ref.id`) and, where the
 * record has many money events, by the event itself. The assumption behind the
 * second key is that `t.id` **is the underlying record's own id** — the
 * deposit's, the repayment's, the HP payment's — rather than an id minted for
 * the feed. The ledger row and the receipt are both built from the same
 * document, so that holds today; if the feed ever starts synthesising ids,
 * this is the one place to change.
 *
 * Only a `completed` row has a receipt. A pending or failed Paystack charge is
 * money that has not landed, and there is nothing to print for it. The
 * customer statement's row type leaves `status` optional — the API writes it
 * on every ledger row and omits it nowhere that matters — so a missing status
 * is read as completed rather than as unprintable.
 */
export function receiptPathFor(
  t: Pick<UnifiedTransaction, "id" | "type" | "ref"> & { status?: TxnStatus },
): string | null {
  if ((t.status ?? "completed") !== "completed") return null;
  switch (t.type) {
    case "susu-deposit":
      return `/susu/${t.ref.id}/deposits/${t.id}/receipt`;
    // A partial withdrawal and a payout share one receipt endpoint.
    case "susu-payout":
    case "susu-withdrawal":
      return `/susu/${t.ref.id}/withdrawals/${t.id}/receipt`;
    case "savings-deposit":
    case "savings-withdrawal":
    case "savings-closure":
      return `/savings/${t.ref.id}/txns/${t.id}/receipt`;
    // One per loan: the disbursement is the loan's own event, not a row of its own.
    case "loan-disbursement":
      return `/loans/${t.ref.id}/disbursement/receipt`;
    case "loan-repayment":
      return `/loans/${t.ref.id}/repayments/${t.id}/receipt`;
    // Deposit, instalment and redemption are one document under three titles.
    case "hp-deposit":
    case "hp-installment":
    case "hp-redemption":
      return `/hire-purchase/${t.ref.id}/payments/${t.id}/receipt`;
    case "hp-sale":
      return `/sales/${t.ref.id}/receipt`;
    case "transfer":
      return `/transfers/${t.ref.id}/receipt`;
    default:
      return null;
  }
}

/** A worker's heartbeat, read as one of three states for the panel. */
export function workerHealth(w: WorkerStatus): "ok" | "failing" | "idle" {
  if (w.lastOk === false) return "failing";
  if (w.lastRunAt && w.lastOk) return "ok";
  return "idle";
}

/** The four the API runs, in the order they matter to the office. */
export const WORKER_LABELS: Record<string, string> = {
  sms: "SMS delivery",
  loanEscalation: "Loan escalation",
  "loan-escalation": "Loan escalation",
  hpArrears: "HP arrears",
  "hp-arrears": "HP arrears",
  debtRecovery: "Debt recovery",
  "debt-recovery": "Debt recovery",
};

/** A worker key as a heading, falling back to the raw key spaced out. */
export function workerLabel(key: string): string {
  return (
    WORKER_LABELS[key] ??
    key.replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase())
  );
}

/** Read a loose report row's total, whatever the deployment happens to call it. */
export function amountOf(row: { total?: number; amount?: number }): number {
  return row.total ?? row.amount ?? 0;
}
