import type { Role } from "~/lib/auth";
import { formatAccraDateTime, formatPesewas } from "~/lib/format";

/**
 * The audit trail — types and vocabulary shared by the server and the
 * browser. Nothing here may import a `.server` module or the API client; the
 * fetch functions live in `~/api/audit`.
 *
 * Every change made through the API leaves one entry: who, what, to which
 * record, and the figures before and after. The API records the action as a
 * dot-notation code — `susu.deposit.record`, `loan.approve` — and the record
 * as a kebab-case type and an id. This module turns those into the words the
 * office reads, and into the page each record lives on.
 */

export interface AuditLog {
  id: string;
  actorId: string;
  /** Joined for display; a deleted account leaves it unset. */
  actorName?: string;
  actorRole?: Role;
  action: string;
  entityType: string;
  entityId: string;
  /** The record's own name or number, where its type has one. */
  entityLabel?: string;
  amountBefore?: number;
  amountAfter?: number;
  before?: unknown;
  after?: unknown;
  requestId?: string;
  /**
   * Where the change came from, read off the request by the API. Absent on
   * an entry a background worker wrote — that change was the system's own.
   */
  method?: string;
  path?: string;
  userAgent?: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ device --- */

/**
 * A user-agent string as the office would name the device: "Chrome on
 * Windows", "Safari on iPhone", "Collector app". The string is whatever the
 * client sent, so this is a reading rather than a fact — but a reading of
 * "Chrome on Windows" at the counter, against a deposit the collector says
 * was taken in the field, is exactly the kind of thing the trail is for.
 *
 * Not a full parser on purpose. The branch runs a handful of browsers and
 * one field app, and a library that knows every television would name none
 * of them better.
 */
export function describeDevice(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent;

  // Not a browser at all: an app's HTTP client, or a tool.
  if (/\bDart\//.test(ua) || /\bokhttp\//.test(ua)) return "Collector app";
  if (/\bCFNetwork\//.test(ua) && !/Safari/.test(ua)) return "iPhone app";
  if (/PostmanRuntime|insomnia/i.test(ua)) return "API tool";
  if (/\bcurl\/|node-fetch|undici|axios|python-requests|Go-http-client/i.test(ua)) {
    return "Script";
  }

  const browser = /\bEdg(?:e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /\bOPR\//.test(ua)
      ? "Opera"
      : /SamsungBrowser\//.test(ua)
        ? "Samsung Internet"
        : /\bFirefox\/|\bFxiOS\//.test(ua)
          ? "Firefox"
          : /\bCriOS\//.test(ua) || /\bChrome\//.test(ua)
            ? "Chrome"
            : /\bSafari\//.test(ua)
              ? "Safari"
              : null;

  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPod/.test(ua)
      ? "iPhone"
      : /iPad/.test(ua)
        ? "iPad"
        : /Android/.test(ua)
          ? "Android"
          : /CrOS/.test(ua)
            ? "Chromebook"
            : /Mac OS X|Macintosh/.test(ua)
              ? "Mac"
              : /Linux/.test(ua)
                ? "Linux"
                : null;

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return `A browser on ${os}`;
  // Something else entirely: the product name before the first slash.
  const product = ua.split("/")[0]?.trim();
  return product ? product.slice(0, 40) : "Unknown device";
}

/**
 * The endpoint as the page shows it: the method and the path with the API
 * prefix off, because every entry shares the prefix and it says nothing.
 */
export function describeEndpoint(
  method: string | undefined,
  path: string | undefined,
): string | null {
  if (!method || !path) return null;
  return `${method} ${path.replace(/^\/api\/v\d+/, "")}`;
}

/* ------------------------------------------------------------------- areas --- */

/**
 * The parts of the business the trail is narrowed by. Each is one or more
 * action prefixes on the API's side: the company's own books are written
 * under three, so the filter names all three.
 */
export type AuditArea =
  | "customers"
  | "susu"
  | "savings"
  | "loans"
  | "hire-purchase"
  | "sales"
  | "inventory"
  | "transfers"
  | "payments"
  | "corrections"
  | "payouts"
  | "reconciliation"
  | "expenses"
  | "accounting"
  | "staff";

export const AUDIT_AREAS: readonly {
  key: AuditArea;
  label: string;
  prefixes: readonly string[];
}[] = [
  { key: "customers", label: "Customers", prefixes: ["customer"] },
  { key: "susu", label: "Susu", prefixes: ["susu"] },
  { key: "savings", label: "Savings", prefixes: ["savings"] },
  { key: "loans", label: "Loans", prefixes: ["loan"] },
  {
    key: "hire-purchase",
    label: "Hire purchase",
    prefixes: ["hp.agreement", "hp.deposit", "hp.payment", "hp.config"],
  },
  { key: "sales", label: "Sales", prefixes: ["hp.sale"] },
  {
    key: "inventory",
    label: "Inventory",
    prefixes: ["hp.item", "hp.damage", "hp.label"],
  },
  { key: "transfers", label: "Transfers", prefixes: ["transfer"] },
  { key: "payments", label: "Mobile money", prefixes: ["payment"] },
  { key: "corrections", label: "Corrections", prefixes: ["txn.correction"] },
  { key: "payouts", label: "Payout requests", prefixes: ["payout-request"] },
  { key: "reconciliation", label: "Cash handover", prefixes: ["reconciliation"] },
  { key: "expenses", label: "Expenses", prefixes: ["expense"] },
  {
    key: "accounting",
    label: "Accounting",
    prefixes: ["cash-account", "fixed-asset", "capital-entry"],
  },
  { key: "staff", label: "Staff", prefixes: ["user"] },
];

export const AUDIT_AREA_KEYS: AuditArea[] = AUDIT_AREAS.map((a) => a.key);

/** The area an action belongs to, by its longest matching prefix. */
export function areaOf(action: string): AuditArea | null {
  let best: { key: AuditArea; length: number } | null = null;
  for (const area of AUDIT_AREAS) {
    for (const prefix of area.prefixes) {
      if (action === prefix || action.startsWith(`${prefix}.`)) {
        if (!best || prefix.length > best.length) {
          best = { key: area.key, length: prefix.length };
        }
      }
    }
  }
  return best?.key ?? null;
}

/**
 * The colour a row's dot takes. The five money modules keep the colours the
 * ledger and the charts already give them, so susu is susu on every screen;
 * everything else is drawn grey, because it has no colour anywhere else and
 * would only be inventing one here.
 */
export const AREA_VAR: Partial<Record<AuditArea, string>> = {
  susu: "var(--module-susu)",
  savings: "var(--module-savings)",
  loans: "var(--module-loans)",
  "hire-purchase": "var(--module-hp)",
  transfers: "var(--module-transfers)",
};

/* ----------------------------------------------------------------- actions --- */

/**
 * What each action is called in a sentence whose subject is the person who
 * did it: "Efua Mensah **recorded a susu deposit**". The list is the API's
 * writers as they stand; an action not in it is still readable, through
 * `describeAction` below, which spells the code out.
 */
const ACTION_LABELS: Record<string, string> = {
  // Customers
  "customer.create": "Registered a customer",
  "customer.update": "Edited a customer's profile",
  "customer.collector.reassign": "Moved a customer to another round",
  "customer.activate": "Re-activated a customer",
  "customer.deactivate": "Deactivated a customer",
  "customer.trash": "Sent a customer to the trash",
  "customer.restore": "Restored a customer from the trash",
  // Susu
  "susu.account.open": "Opened a susu account",
  "susu.deposit.record": "Recorded a susu deposit",
  "susu.deposit.update": "Corrected a susu deposit",
  "susu.deposit.trash": "Sent a susu deposit to the trash",
  "susu.deposit.restore": "Restored a susu deposit",
  "susu.withdrawal.partial": "Paid out part of a susu balance",
  "susu.account.close": "Closed a susu account and paid it out",
  "susu.account.terminate": "Terminated a susu account",
  "susu.payout": "Paid out a susu account",
  "susu.account.trash": "Sent a susu account to the trash",
  "susu.account.restore": "Restored a susu account",
  // Savings
  "savings.account.open": "Opened a savings account",
  "savings.deposit.record": "Recorded a savings deposit",
  "savings.withdrawal.record": "Recorded a savings withdrawal",
  "savings.txn.update": "Corrected a savings transaction",
  "savings.txn.trash": "Sent a savings transaction to the trash",
  "savings.txn.restore": "Restored a savings transaction",
  "savings.account.close": "Closed a savings account",
  "savings.account.trash": "Sent a savings account to the trash",
  "savings.account.restore": "Restored a savings account",
  // Loans
  "loan.apply": "Took a loan application",
  "loan.approve": "Approved a loan",
  "loan.reject": "Declined a loan",
  "loan.repayment": "Recorded a loan repayment",
  "loan.repayment.update": "Corrected a loan repayment",
  "loan.escalate": "Escalated an overdue loan",
  "loan.freeze": "Froze a loan in arrears",
  "loan.config.update": "Changed the loan terms",
  "loan.trash": "Sent a loan to the trash",
  "loan.restore": "Restored a loan",
  // Hire purchase
  "hp.agreement.create": "Signed a hire-purchase agreement",
  "hp.deposit.record": "Recorded a hire-purchase deposit",
  "hp.agreement.approve": "Approved a hire-purchase agreement",
  "hp.agreement.reject": "Declined a hire-purchase agreement",
  "hp.payment.record": "Recorded a hire-purchase instalment",
  "hp.payment.update": "Corrected a hire-purchase instalment",
  "hp.agreement.arrears": "Flagged an agreement in arrears",
  "hp.agreement.repossess": "Repossessed an item",
  "hp.agreement.forfeit": "Forfeited an agreement",
  "hp.agreement.trash": "Sent an agreement to the trash",
  "hp.agreement.restore": "Restored an agreement",
  "hp.config.update": "Changed the hire-purchase rate",
  // Sales and inventory
  "hp.sale.record": "Rang up a counter sale",
  "hp.sale.void": "Voided a counter sale",
  "hp.item.create": "Added an item to the shelf",
  "hp.item.update": "Edited an item",
  "hp.item.adjust-stock": "Adjusted stock",
  "hp.item.receive-stock": "Received stock",
  "hp.item.trash": "Sent an item to the trash",
  "hp.item.restore": "Restored an item",
  "hp.damage.report": "Reported damaged stock",
  "hp.damage.update": "Edited a damage report",
  "hp.damage.approve": "Approved a damage write-off",
  "hp.damage.reject": "Declined a damage report",
  "hp.damage.trash": "Sent a damage report to the trash",
  "hp.damage.restore": "Restored a damage report",
  "hp.label.create": "Added a brand or category",
  "hp.label.update": "Renamed a brand or category",
  "hp.label.delete": "Removed a brand or category",
  // Money between products, and money by phone
  "transfer.record": "Moved money between a customer's accounts",
  "payment.charge.initiate": "Started a mobile-money charge",
  // Corrections
  "txn.correction.propose": "Asked for a figure to be corrected",
  "txn.correction.approve": "Applied a correction",
  "txn.correction.reject": "Declined a correction",
  "txn.correction.cancel": "Took back a correction request",
  // Payout requests
  "payout-request.approve": "Approved a payout request",
  "payout-request.reject": "Declined a payout request",
  // Cash handover
  "reconciliation.declare": "Declared a day's cash",
  "reconciliation.confirm": "Counted and confirmed a day's cash",
  // Expenses
  "expense.record": "Recorded an expense",
  "expense.update": "Edited an expense",
  "expense.approve": "Approved an expense",
  "expense.reject": "Rejected an expense",
  "expense.pay": "Paid an expense",
  "expense.attach-receipt": "Attached a receipt to an expense",
  "expense.trash": "Sent an expense to the trash",
  "expense.restore": "Restored an expense",
  // The company's books
  "cash-account.create": "Opened a cash or bank account",
  "fixed-asset.register": "Registered a fixed asset",
  "fixed-asset.dispose": "Disposed of a fixed asset",
  "capital-entry.record": "Recorded owner capital",
  // Staff
  "user.create": "Added a staff account",
  "user.update": "Edited a staff account",
  "user.disable": "Disabled a staff account",
  "user.enable": "Re-enabled a staff account",
  "user.password-reset": "Reset a staff member's password",
  "user.password-change": "Changed their own password",
  "user.password-reset-self": "Reset their own password by email",
};

/**
 * The sentence for an action. A code that has no line above is spelled out
 * from its parts — `hp.schedule.rebuild` reads "Hp schedule rebuild" — which
 * is worse than a written line but far better than the code, and it means a
 * writer added to the API shows up here the day it lands.
 */
export function describeAction(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const words = action.split(/[.\-]/).filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/* ---------------------------------------------------------------- entities --- */

/** What each kind of record is called. */
const ENTITY_LABELS: Record<string, string> = {
  customer: "Customer",
  user: "Staff account",
  "susu-account": "Susu account",
  "susu-deposit": "Susu deposit",
  "savings-account": "Savings account",
  "savings-txn": "Savings transaction",
  loan: "Loan",
  "loan-config": "Loan terms",
  repayment: "Loan repayment",
  "hp-agreement": "Hire-purchase agreement",
  "hp-payment": "Hire-purchase instalment",
  "hp-config": "Hire-purchase rate",
  "hp-item": "Inventory item",
  "hp-damage": "Damage report",
  "hp-label": "Brand or category",
  "hp-sale": "Counter sale",
  transfer: "Transfer",
  "paystack-charge": "Mobile-money charge",
  "txn-correction": "Correction",
  "payout-request": "Payout request",
  reconciliation: "Cash handover",
  expense: "Expense",
  "cash-account": "Cash account",
  "fixed-asset": "Fixed asset",
  "capital-entry": "Capital entry",
};

export function describeEntityType(entityType: string): string {
  const known = ENTITY_LABELS[entityType];
  if (known) return known;
  const words = entityType.split("-").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Where the record behind an entry lives in this app, or null when it has no
 * page of its own — a single deposit or repayment is a row on its account's
 * page, and a transfer is its two legs on the ledger.
 */
export function entityPath(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case "customer":
      return `/customers/${entityId}`;
    case "user":
      return `/staff/${entityId}`;
    case "susu-account":
      return `/susu/${entityId}`;
    case "savings-account":
      return `/savings/${entityId}`;
    case "loan":
      return `/loans/${entityId}`;
    case "loan-config":
      return "/loans/config";
    case "hp-agreement":
      return `/hire-purchase/${entityId}`;
    case "hp-config":
      return "/hire-purchase/config";
    case "hp-sale":
      return `/sales/${entityId}`;
    case "hp-damage":
      return `/inventory/damages/${entityId}`;
    case "txn-correction":
      return "/corrections";
    case "payout-request":
      return `/payout-requests/${entityId}`;
    case "reconciliation":
      return `/reconciliation/${entityId}`;
    case "expense":
      return `/expenses/${entityId}`;
    case "cash-account":
      return "/accounting";
    case "fixed-asset":
      return "/accounting/assets";
    case "capital-entry":
      return "/accounting/capital";
    default:
      return null;
  }
}

/* --------------------------------------------------------------- snapshots --- */

/**
 * One line of a before/after comparison: the field, what it was, what it
 * became, and whether the two differ. Built from two snapshots of no fixed
 * shape, so the fields are whatever the writer chose to record.
 */
export interface SnapshotLine {
  key: string;
  label: string;
  before: string | null;
  after: string | null;
  changed: boolean;
}

/** Fields the writers record as integer pesewas. Everything else is as-is. */
const MONEY_KEY =
  /amount|payout|commission|balance|principal|interest|fee|price|cost|total|deposit|reserved|remaining|owed|paid|value|capital/i;

/** A key that plainly holds an instant, whichever writer set it. */
const DATE_KEY = /(At|On|Date)$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const OBJECT_ID = /^[0-9a-f]{24}$/;

/**
 * The words for a snapshot field. The writers use the model's own camelCase
 * names, which split cleanly into words; the few that would still read oddly
 * are named here.
 */
const FIELD_LABELS: Record<string, string> = {
  assignedCollectorId: "Collector",
  customerId: "Customer",
  cashAccountId: "Paid from",
  collectAllBatchId: "Collect-all batch",
  carriedFromAccountId: "Carried from account",
  carriedFromDepositId: "Carried from deposit",
  receiptUrl: "Receipt",
  photoUrl: "Photo",
  idDocumentFrontUrl: "ID front",
  idDocumentBackUrl: "ID back",
  dailyAmount: "Daily amount",
  daysCovered: "Days covered",
  carriedDays: "Days carried",
  depositsCount: "Deposits",
  withdrawnDuringCycle: "Withdrawn during cycle",
  deletedAt: "Trashed at",
  deleteReason: "Reason",
  fullName: "Full name",
  seq: "Deposit number",
};

export function describeField(key: string): string {
  const known = FIELD_LABELS[key];
  if (known) return known;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A snapshot value as the office reads it. Money keys are pesewas and print
 * as cedis; instants print in Accra time; an id prints shortened, because
 * twenty-four hex characters say nothing and the record is linked anyway.
 */
export function formatSnapshotValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return Number.isInteger(value) && MONEY_KEY.test(key) && !/count|days|seq/i.test(key)
      ? formatPesewas(value)
      : String(value);
  }
  if (typeof value === "string") {
    if (ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value))) {
      return formatAccraDateTime(value);
    }
    if (DATE_KEY.test(key) && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    if (OBJECT_ID.test(value)) return `…${value.slice(-6)}`;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => formatSnapshotValue(key, v) ?? "—").join(", ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The comparison, one line per field, in the order the writer recorded them
 * — fields that were there before first, then anything that only appears
 * after. A snapshot that is not an object at all becomes one line.
 */
export function snapshotLines(before: unknown, after: unknown): SnapshotLine[] {
  const b = asRecord(before);
  const a = asRecord(after);
  if (!b && !a) {
    if (before === undefined && after === undefined) return [];
    const bv = formatSnapshotValue("value", before);
    const av = formatSnapshotValue("value", after);
    return [{ key: "value", label: "Value", before: bv, after: av, changed: bv !== av }];
  }
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])];
  return keys.map((key) => {
    const bv = b && key in b ? formatSnapshotValue(key, b[key]) : null;
    const av = a && key in a ? formatSnapshotValue(key, a[key]) : null;
    return { key, label: describeField(key), before: bv, after: av, changed: bv !== av };
  });
}
