/**
 * Customer types and display constants shared by the server and the browser.
 * Nothing here may import a `.server` module or the API client — it is bundled
 * into the client. The fetch functions live in `~/api/customers`.
 */

import type {
  Direction,
  TransactionTotals,
  TxnModule,
  TxnType,
  UnifiedTransaction,
} from "~/lib/reports";

export type Gender = "male" | "female";
export type MaritalStatus = "single" | "married" | "other";
export type CustomerStatus = "active" | "inactive";
export type IdType = "ghana-card" | "passport" | "drivers-license" | "voter-id";

/** The block is optional on a customer; once present, the type and number are not. */
export interface Identification {
  idType: IdType;
  idNumber: string;
}

export interface NextOfKin {
  fullName: string;
  relationship?: string;
  phone?: string;
  address?: string;
}

/** A customer record. Only the six fields the API guarantees are required. */
export interface Customer {
  id: string;
  fullName: string;
  dateOfBirth?: string;
  gender?: Gender;
  nationality?: string;
  maritalStatus?: MaritalStatus;
  residentialAddress?: string;
  phone: string;
  altPhone?: string;
  identification?: Identification;
  occupation?: string;
  /**
   * The collector whose round this customer sits on. Set at registration and
   * changed *only* through `PATCH /customers/{id}/collector` — a plain profile
   * update ignores the field, so responsibility never moves by accident.
   */
  assignedCollectorId?: string;
  nextOfKin?: NextOfKin;
  photoUrl?: string;
  idDocumentFrontUrl?: string;
  idDocumentBackUrl?: string;
  registeredById: string;
  status: CustomerStatus;
  createdAt: string;
}

/** How each ID document is labelled in the UI. */
export const ID_TYPE_LABELS: Record<IdType, string> = {
  "ghana-card": "Ghana Card",
  passport: "Passport",
  "drivers-license": "Driver's licence",
  "voter-id": "Voter ID",
};

/** Select options, in the order the registration form presents them. */
export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

export const MARITAL_OPTIONS: { value: MaritalStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "other", label: "Other" },
];

export const ID_TYPE_OPTIONS: { value: IdType; label: string }[] = [
  { value: "ghana-card", label: "Ghana Card" },
  { value: "passport", label: "Passport" },
  { value: "drivers-license", label: "Driver's licence" },
  { value: "voter-id", label: "Voter ID" },
];

/** Ghanaian mobile number: `0` then `2` or `5`, then eight digits. */
export const PHONE_RE = /^0[25]\d{8}$/;

/** The body of POST /customers. Optionals are omitted when blank. */
export interface CreateCustomerInput {
  fullName: string;
  phone: string;
  photoUrl: string;
  /**
   * Optional on the profile. Both sides must be on file before a loan or
   * hire-purchase agreement can be opened, and neither can be removed while
   * one is running — see `hasIdDocument`.
   */
  idDocumentFrontUrl?: string;
  idDocumentBackUrl?: string;
  /**
   * Whose round this customer joins, if anyone's. Optional: a customer who
   * brings their deposits to the counter is collected from by nobody, and the
   * API reads a missing collector as exactly that.
   */
  assignedCollectorId?: string;
  dateOfBirth?: string;
  gender?: Gender;
  nationality?: string;
  maritalStatus?: MaritalStatus;
  residentialAddress?: string;
  altPhone?: string;
  identification?: {
    idType: IdType;
    idNumber: string;
  };
  occupation?: string;
  nextOfKin?: {
    fullName: string;
    relationship?: string;
    phone?: string;
    address?: string;
  };
}

/**
 * The body of PATCH /customers/{id} — every field optional, none required.
 *
 * A field that is optional on the record takes `null` to clear it — the only
 * way to blank a value once set, since omitting it means "leave alone". The
 * three the record cannot be without (name, phone, photo) take a replacement
 * or nothing; an ID scan clears like any other optional, and the API refuses
 * that with `ID_DOCUMENT_IN_USE` while a loan or agreement is open.
 *
 * `assignedCollectorId` is deliberately not among them. The API ignores it here
 * and moves a round only through `PATCH /customers/{id}/collector`, which is
 * admin-only and writes an audit entry; leaving it in the type would let a form
 * post a change that silently does nothing.
 */
export type UpdateCustomerInput = {
  [K in keyof Omit<CreateCustomerInput, "assignedCollectorId">]?: undefined extends CreateCustomerInput[K]
    ? CreateCustomerInput[K] | null
    : CreateCustomerInput[K];
};

/**
 * A customer in the trash. Soft-deleted: gone from the listings and from
 * lookups, restorable via POST /customers/{id}/restore. `deletedAt` is what
 * separates this from a plain `Customer`.
 */
export interface TrashedCustomer extends Customer {
  deletedAt: string;
  deletedById?: string;
  deleteReason?: string;
}

/** How much of the ID document a record carries. `partial` is one side only. */
export type IdDocumentState = "complete" | "partial" | "none";

export function idDocumentState(
  customer: Pick<Customer, "idDocumentFrontUrl" | "idDocumentBackUrl">,
): IdDocumentState {
  const sides = [customer.idDocumentFrontUrl, customer.idDocumentBackUrl].filter(
    Boolean,
  ).length;
  return sides === 2 ? "complete" : sides === 1 ? "partial" : "none";
}

/**
 * Both sides on file — the API's own definition, and the one that gates a loan
 * or a hire-purchase agreement. One side alone counts for nothing.
 */
export function hasIdDocument(
  customer: Pick<Customer, "idDocumentFrontUrl" | "idDocumentBackUrl">,
): boolean {
  return idDocumentState(customer) === "complete";
}

/**
 * ID number formats, per the API's own check. Getting these wrong is the
 * commonest registration rejection, so the form pre-checks them rather than
 * making the clerk discover it on submit.
 */
export const ID_NUMBER_RULES: Record<
  IdType,
  { re: RegExp; hint: string; placeholder: string }
> = {
  "ghana-card": {
    re: /^GHA-\d{9}-\d$/,
    hint: "Ghana Card numbers look like GHA-123456789-0.",
    placeholder: "GHA-123456789-0",
  },
  "voter-id": {
    re: /^\d{8}$/,
    hint: "Voter IDs are 8 digits.",
    placeholder: "12345678",
  },
  passport: {
    re: /^[A-Z]\d{8}$/,
    hint: "Passport numbers are a letter then 8 digits, like G12345678.",
    placeholder: "G12345678",
  },
  "drivers-license": {
    re: /^[A-Z0-9]{10,20}$/,
    hint: "Driver's licence numbers are 10–20 letters and digits.",
    placeholder: "As printed on the licence",
  },
};

/** Null when the number suits the type, otherwise the message to show. */
export function checkIdNumber(idType: IdType, idNumber: string): string | null {
  const rule = ID_NUMBER_RULES[idType];
  return rule.re.test(idNumber.trim().toUpperCase()) ? null : rule.hint;
}

/* ------------------------------------------------------ statement of account --- */

/**
 * The statement's rows are the unified ledger's rows — the same shape
 * `/reports/transactions` returns — so the one definition in `~/lib/reports`
 * is re-exported here rather than copied and left to drift. The shorter names
 * are what this module's callers have always used.
 */
export type { TransactionTotals, UnifiedTransaction };
export type TxModule = TxnModule;
export type TxType = TxnType;
export type TxDirection = Direction;

export interface SusuHolding {
  accountId: string;
  accountNumber: string;
  status: string;
  dailyAmount: number;
  depositsCount: number;
  /** Gross paid in over the cycle. Withdrawals never reduce it. */
  totalDeposited: number;
  /** Handed back through partial withdrawals, without stopping the cycle. */
  withdrawnAmount?: number;
  /** `totalDeposited − withdrawnAmount` — what the cycle actually holds. */
  balance?: number;
  payoutRemaining: number;
}

export interface SavingsHolding {
  accountId: string;
  accountNumber: string;
  accountType: "standard" | "student";
  status: string;
  openingBalance: number;
  closingBalance: number;
  currentBalance: number;
}

export interface LoanHolding {
  loanId: string;
  tier: string;
  status: string;
  principal: number;
  totalDue: number;
  totalRepaid: number;
  remaining: number;
  dueDate?: string | null;
}

export interface HirePurchaseHolding {
  agreementId: string;
  itemName: string;
  status: string;
  totalPayable?: number | null;
  totalPaid: number;
  remaining?: number | null;
}

/** GET /customers/{id}/statement */
export interface CustomerStatement {
  customer: {
    id: string;
    fullName: string;
    phone: string;
    residentialAddress?: string | null;
  };
  period: { from: string; to: string };
  generatedAt: string;
  products: {
    susu: SusuHolding[];
    savings: SavingsHolding[];
    loans: LoanHolding[];
    hirePurchase: HirePurchaseHolding[];
  };
  totals: TransactionTotals;
  transactions: UnifiedTransaction[];
  /** True when the range held more rows than the API will return at once. */
  truncated: boolean;
}

/** How each ledger row is described in the UI. */
export const TX_TYPE_LABELS: Record<TxType, string> = {
  "susu-deposit": "Susu deposit",
  "susu-payout": "Susu payout",
  "susu-withdrawal": "Susu withdrawal",
  "savings-deposit": "Savings deposit",
  "savings-withdrawal": "Savings withdrawal",
  "savings-closure": "Savings closure",
  "loan-disbursement": "Loan disbursement",
  "loan-repayment": "Loan repayment",
  "hp-deposit": "Hire-purchase deposit",
  "hp-installment": "Hire-purchase instalment",
  "hp-redemption": "Hire-purchase redemption",
  "hp-sale": "Counter sale",
  transfer: "Transfer",
};

export const MODULE_LABELS: Record<TxModule, string> = {
  susu: "Susu",
  savings: "Savings",
  loans: "Loans",
  "hire-purchase": "Hire purchase",
  transfers: "Transfers",
};

/**
 * How the money physically moved. `momo` is mobile money, which is what the
 * branch calls it — the column is read at a glance, not in a report.
 * Values come from the API's `channel` enum; anything unrecognised falls
 * through to the raw string rather than being hidden.
 */
export const CHANNEL_LABELS: Record<string, string> = {
  cash: "Cash",
  momo: "MoMo",
  paystack: "Paystack",
  transfer: "Transfer",
};

/** The channel's label, or the raw value when the API adds one we do not know. */
export function channelLabel(channel?: string | null): string | null {
  if (!channel) return null;
  return CHANNEL_LABELS[channel] ?? channel;
}
