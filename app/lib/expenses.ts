/**
 * Money the business spends on itself: recorded → approved → paid.
 *
 * Its own module rather than a corner of accounting, because the two are used
 * by different people at different times. Petty cash leaves the drawer in ones
 * and twos all day and is recorded at the counter as it happens; the
 * statements built from it are read at month end by somebody else.
 *
 * Only PAYMENT moves cash. An approved-but-unpaid expense is a liability, which
 * is what keeps the cash position honest — and the reason approving and paying
 * are two separate acts rather than one button.
 */

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

export interface TrashedExpense extends Expense {
  deletedAt: string;
  deletedById?: string;
  deleteReason?: string;
}

/** What was spent in a period, by category and by status. */
export interface ExpenseSummary {
  from: string | null;
  to: string | null;
  /** Every non-rejected expense in the period — what the business actually spent. */
  totalAmount: number;
  totalCount: number;
  byCategory: { category: ExpenseCategory; count: number; amount: number }[];
  byStatus: { status: string; count: number; amount: number }[];
  /** Incurred but not yet paid. */
  outstandingAmount: number;
}

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

/** Whether the amount and category can still be changed. */
export function isEditable(expense: Expense): boolean {
  return expense.status === "pending";
}

/**
 * Whether it can be removed from the book. An approved expense is already a
 * liability on the balance sheet and a paid one has already moved cash;
 * removing either would silently restate a period somebody may have acted on.
 */
export function isRemovable(expense: Expense): boolean {
  return expense.status === "pending" || expense.status === "rejected";
}
