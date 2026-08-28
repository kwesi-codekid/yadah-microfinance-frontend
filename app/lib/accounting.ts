/**
 * The company's own books — types and display constants shared by the server
 * and the browser. Nothing here may import a `.server` module or the API
 * client; the fetch functions live in `~/api/accounting`.
 *
 * Everything else in this app is customer money: a deposit is theirs, a loan
 * goes back out, a transfer moves between two of their own pockets. This
 * module is the branch's own money — what it holds in its drawer and bank,
 * what it spends, what it owns, what the owner put in — and the two statements
 * built from all of it. Two rules from the API shape every screen:
 *
 * - **Customer deposits are liabilities.** Susu and savings balances are held
 *   on someone else's behalf and repayable; a microfinance that reads its
 *   deposit book as wealth is the classic way to go under.
 * - **Balances are derived, never stored.** The cash position is rebuilt on
 *   every read from opening balances and every movement since, so no missed
 *   write can leave a stored total quietly wrong. Which is also why a balance
 *   sheet that does not balance says so rather than hiding it.
 *
 * Money is integer pesewas throughout, as everywhere else.
 */

/* ------------------------------------------------------------ cash accounts --- */

export type CashAccountKind = "cash-on-hand" | "bank" | "momo" | "paystack";

/**
 * The channel a customer transaction was recorded on is what ties it to a
 * company account, so there can be at most one active account per channel.
 */
export type CashChannel = "cash" | "paystack" | "momo";

/**
 * A company account. The API leaves this shape undocumented, so the fields the
 * opening body names are taken as given and the rest are read defensively.
 */
export interface CashAccount {
  id: string;
  name: string;
  kind: CashAccountKind;
  channel: CashChannel;
  openingBalance: number;
  /** Accra day the opening balance was true on. */
  openingDate: string;
  bankName?: string;
  accountNumber?: string;
  status?: "active" | "closed";
  createdAt?: string;
}

/** One account's derived holding, as `GET /accounting/cash-position` gives it. */
export interface CashPositionAccount {
  id: string;
  name: string;
  kind: CashAccountKind;
  channel: CashChannel;
  balance: number;
  openingBalance?: number;
}

export interface CashPosition {
  asOf: string;
  accounts: CashPositionAccount[];
  total: number;
}

/* ---------------------------------------------------------------- expenses --- */

export type ExpenseCategory =
  | "salaries-staff"
  | "petty-cash-office"
  | "utilities-premises"
  | "fees-transport-other"
  | "bad-debt-recovery"
  | "professional-compliance-tax"
  | "marketing"
  | "insurance";

export type ExpenseStatus = "pending" | "approved" | "rejected" | "paid";

/** A bad-debt write-off names what it is writing off. */
export type WriteOffEntityType = "loan" | "hp-agreement";

export interface Expense {
  id: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  payee?: string;
  /** The day the cost belongs to — not always the day it is paid. */
  incurredOn: string;
  status: ExpenseStatus;
  /** Set once paid: the account the money left. */
  cashAccountId?: string;
  paidOn?: string;
  recordedById: string;
  recordedByName?: string;
  approvedById?: string;
  approvedByName?: string;
  rejectionReason?: string;
  receiptUrl?: string;
  reference?: string;
  writeOffEntityType?: WriteOffEntityType;
  writeOffEntityId?: string;
  createdAt: string;
}

/* ------------------------------------------------------------ fixed assets --- */

export type AssetCategory =
  | "motorbike-vehicle"
  | "computer-equipment"
  | "furniture-fittings"
  | "premises"
  | "other";

export type AssetStatus = "active" | "disposed";

/**
 * An asset on the register, with its depreciation computed as at the day the
 * register was read. Straight-line from cost, salvage and useful life — there
 * is no monthly posting to miss, so the figures are a function of the date.
 */
export interface FixedAsset {
  id: string;
  name: string;
  category: AssetCategory;
  cost: number;
  acquiredOn: string;
  usefulLifeMonths: number;
  salvageValue: number;
  status: AssetStatus;
  cashAccountId?: string;
  serialNumber?: string;
  assignedToId?: string;
  assignedToName?: string;
  /** Computed as at the register's `asOf`. */
  accumulatedDepreciation?: number;
  netBookValue?: number;
  monthlyDepreciation?: number;
  disposedOn?: string;
  disposalProceeds?: number;
  disposalNote?: string;
  createdAt?: string;
}

/* ----------------------------------------------------------------- capital --- */

export type CapitalKind = "contribution" | "drawing";

/** Owner money in or out. Neither is income or an expense: it moves equity. */
export interface CapitalEntry {
  id: string;
  kind: CapitalKind;
  amount: number;
  occurredOn: string;
  cashAccountId?: string;
  cashAccountName?: string;
  note?: string;
  recordedById?: string;
  recordedByName?: string;
  createdAt?: string;
}

/* -------------------------------------------------------------- statements --- */

export interface BalanceSheet {
  asOf: string;
  assets: {
    current: {
      cashAndBank: number;
      loansReceivable: number;
      hirePurchaseReceivable: number;
      inventory: number;
      total: number;
    };
    nonCurrent: {
      fixedAssetsAtCost: number;
      accumulatedDepreciation: number;
      netBookValue: number;
    };
    total: number;
  };
  liabilities: {
    customerDeposits: {
      susuBalances: number;
      savingsBalances: number;
      susuPayoutsPending: number;
      total: number;
    };
    accruedExpenses: number;
    total: number;
  };
  equity: {
    contributedCapital: number;
    drawings: number;
    retainedEarnings: number;
    total: number;
  };
  /** Assets less (liabilities + equity). Should be zero; reported when not. */
  checkDifference: number;
  balances: boolean;
  disclosures: {
    unearnedLoanInterest: number;
    unearnedHpInterest: number;
    note: string;
  };
  generatedAt: string;
}

export interface ProfitAndLoss {
  from: string;
  to: string;
  income: {
    susuCommission: number;
    savingsFees: number;
    outrightSalesProfit: number;
    loanInterest: number;
    hirePurchaseInterest: number;
    total: number;
  };
  expenses: {
    byCategory: { category: ExpenseCategory | string; count: number; amount: number }[];
    recorded: number;
    depreciation: number;
    total: number;
  };
  netProfit: number;
  generatedAt: string;
}

/* ------------------------------------------------------------------ labels --- */

export const CASH_ACCOUNT_KIND_LABELS: Record<CashAccountKind, string> = {
  "cash-on-hand": "Cash on hand",
  bank: "Bank",
  momo: "Mobile money",
  paystack: "Paystack",
};

export const CASH_ACCOUNT_KIND_OPTIONS: { value: CashAccountKind; label: string }[] = (
  Object.keys(CASH_ACCOUNT_KIND_LABELS) as CashAccountKind[]
).map((value) => ({ value, label: CASH_ACCOUNT_KIND_LABELS[value] }));

export const CASH_CHANNEL_LABELS: Record<CashChannel, string> = {
  cash: "Cash",
  momo: "MoMo",
  paystack: "Paystack",
};

export const CASH_CHANNEL_OPTIONS: { value: CashChannel; label: string }[] = (
  Object.keys(CASH_CHANNEL_LABELS) as CashChannel[]
).map((value) => ({ value, label: CASH_CHANNEL_LABELS[value] }));

/** The channel an account kind naturally takes. Prefilled, never enforced. */
export const DEFAULT_CHANNEL_FOR_KIND: Record<CashAccountKind, CashChannel> = {
  "cash-on-hand": "cash",
  bank: "cash",
  momo: "momo",
  paystack: "paystack",
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  "salaries-staff": "Salaries and staff",
  "petty-cash-office": "Petty cash and office",
  "utilities-premises": "Utilities and premises",
  "fees-transport-other": "Fees, transport and other",
  "bad-debt-recovery": "Bad debt and recovery",
  "professional-compliance-tax": "Professional, compliance and tax",
  marketing: "Marketing",
  insurance: "Insurance",
};

export const EXPENSE_CATEGORIES = Object.keys(
  EXPENSE_CATEGORY_LABELS,
) as ExpenseCategory[];

export const EXPENSE_CATEGORY_OPTIONS: { value: ExpenseCategory; label: string }[] =
  EXPENSE_CATEGORIES.map((value) => ({ value, label: EXPENSE_CATEGORY_LABELS[value] }));

export const EXPENSE_STATUSES: ExpenseStatus[] = ["pending", "approved", "paid", "rejected"];

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  paid: "Paid",
  rejected: "Rejected",
};

/** What each state means for the money, in one line. */
export const EXPENSE_STATUS_BLURBS: Record<ExpenseStatus, string> = {
  pending: "Recorded. Waiting on someone other than the recorder to approve it.",
  approved: "Approved but not yet paid. Sits as a liability until it is.",
  paid: "Paid out of a named account. The only state that moved money.",
  rejected: "Declined. Nothing moved and nothing is owed.",
};

export const EXPENSE_STATUS_TONE: Record<
  ExpenseStatus,
  "success" | "info" | "warning" | "danger" | "muted"
> = {
  pending: "warning",
  approved: "info",
  paid: "success",
  rejected: "muted",
};

export const WRITE_OFF_LABELS: Record<WriteOffEntityType, string> = {
  loan: "Loan",
  "hp-agreement": "Hire purchase agreement",
};

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  "motorbike-vehicle": "Motorbike or vehicle",
  "computer-equipment": "Computer equipment",
  "furniture-fittings": "Furniture and fittings",
  premises: "Premises",
  other: "Other",
};

export const ASSET_CATEGORIES = Object.keys(ASSET_CATEGORY_LABELS) as AssetCategory[];

export const ASSET_CATEGORY_OPTIONS: { value: AssetCategory; label: string }[] =
  ASSET_CATEGORIES.map((value) => ({ value, label: ASSET_CATEGORY_LABELS[value] }));

export const ASSET_STATUSES: AssetStatus[] = ["active", "disposed"];

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  active: "In use",
  disposed: "Disposed",
};

export const ASSET_STATUS_BLURBS: Record<AssetStatus, string> = {
  active: "On the balance sheet, depreciating month by month.",
  disposed: "Off the balance sheet from the day it was disposed of.",
};

export const ASSET_STATUS_TONE: Record<AssetStatus, "success" | "muted"> = {
  active: "success",
  disposed: "muted",
};

export const CAPITAL_KIND_LABELS: Record<CapitalKind, string> = {
  contribution: "Contribution",
  drawing: "Drawing",
};

export const CAPITAL_KIND_BLURBS: Record<CapitalKind, string> = {
  contribution: "The owner put money in.",
  drawing: "The owner took money out.",
};

/* ------------------------------------------------------------------- rules --- */

/** Only a pending expense can be decided on. */
export function canDecide(expense: Pick<Expense, "status">): boolean {
  return expense.status === "pending";
}

/** Only an approved expense can be paid — paying is the one step that moves money. */
export function canPay(expense: Pick<Expense, "status">): boolean {
  return expense.status === "approved";
}

/**
 * The approver may not be the recorder: the API refuses it, and the menu says
 * so before the click rather than after.
 */
export function canApproveBy(
  expense: Pick<Expense, "status" | "recordedById">,
  userId: string,
): boolean {
  return canDecide(expense) && expense.recordedById !== userId;
}

/** Only an asset still in use can be disposed of. */
export function canDispose(asset: Pick<FixedAsset, "status">): boolean {
  return asset.status === "active";
}

/**
 * Straight-line depreciation, for a preview while an asset is being registered:
 * what leaves the profit and loss each month once it is on the register. The
 * API computes the real figure; this only has to agree with it for whole
 * months, which is all a preview shows.
 */
export function monthlyDepreciation(input: {
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
}): number {
  if (input.usefulLifeMonths < 1) return 0;
  return Math.max(0, Math.round((input.cost - input.salvageValue) / input.usefulLifeMonths));
}

/**
 * What the asset is worth in the books as at a day: cost less the months of
 * depreciation that have passed, never below salvage. Used only where the API
 * has not supplied `netBookValue` itself.
 */
export function netBookValueAt(
  asset: Pick<FixedAsset, "cost" | "salvageValue" | "usefulLifeMonths" | "acquiredOn">,
  asOf: string,
): number {
  const [ay, am] = asset.acquiredOn.split("-").map(Number);
  const [oy, om] = asOf.split("-").map(Number);
  const months = Math.max(0, (oy - ay) * 12 + (om - am));
  const used = Math.min(months, asset.usefulLifeMonths);
  const value = asset.cost - monthlyDepreciation(asset) * used;
  return Math.max(asset.salvageValue, value);
}

/**
 * Net worth from one side of the sheet. Where the two sides disagree the API
 * reports the difference, and it is that figure — not this one — the screen
 * leads with.
 */
export function netWorth(sheet: Pick<BalanceSheet, "assets" | "liabilities">): number {
  return sheet.assets.total - sheet.liabilities.total;
}
