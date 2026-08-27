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

/** A count and a total, the pair almost every figure in these reports comes as. */
export interface Tally {
  count: number;
  amount: number;
}

export interface UnifiedTransaction {
  id: string;
  module: TxnModule;
  type: TxnType;
  direction: Direction;
  /** Pesewas. */
  amount: number;
  /** Pesewas — a savings withdrawal or transfer fee. */
  fee: number;
  channel: string | null;
  /** Payout destination, repayment source, or transfer route — `susu->loan`. */
  detail: string | null;
  customerId: string;
  customerName: string;
  ref: {
    kind: "susu-account" | "savings-account" | "loan" | "hp-agreement" | "transfer";
    id: string;
    /** Present for susu and savings accounts. */
    accountNumber?: string;
  };
  /** Savings rows only: the running balance after this row. */
  balanceAfter?: number;
  recordedById: string | null;
  /** `System` for the automated debt-recovery moves. */
  recordedByName: string | null;
  createdAt: string;
}

export interface TransactionTotals {
  in: Tally;
  out: Tally;
  /** Transfer legs. Shown, never summed into cash. */
  internal: Tally;
  /** Savings withdrawal and closure fees inside the range. */
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

export interface DashboardMetrics {
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
