/**
 * Readers for the report payloads.
 *
 * The spec declares all four responses as `{}` — an object with no properties —
 * so field names here are read at runtime rather than typed ahead of it. The
 * page renders whatever arrives: an array of rows becomes a table, scalars
 * beside it become figures. When the API publishes real schemas this can
 * collapse into four plain types.
 */

import { formatDate, formatDateTime } from "~/lib/format";
import { formatGhs } from "~/lib/money";

export type Row = Record<string, unknown>;

export interface ReportView {
  /** The table, if the payload held one. */
  rows: Row[];
  /** Column keys, in the order the first rows declared them. */
  columns: string[];
  /** Scalars sat outside the table — totals, the range, the generated date. */
  figures: { key: string; value: unknown }[];
  /** Named arrays other than the one being tabled, e.g. aging buckets. */
  sections: { key: string; rows: Row[]; columns: string[] }[];
}

function isRecord(value: unknown): value is Row {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

function isRowArray(value: unknown): value is Row[] {
  return Array.isArray(value) && value.every(isRecord);
}

/** The range the user picked comes back in the payload; the filter already shows it. */
function isRangeEcho(key: string): boolean {
  const leaf = key.split(".").pop()!.toLowerCase();
  return leaf === "from" || leaf === "to";
}

/** Keys in declaration order across the rows — later rows can add columns. */
function columnsOf(rows: Row[]): string[] {
  const seen: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.includes(key)) seen.push(key);
    }
  }
  return seen;
}

export function readReport(payload: unknown): ReportView {
  const empty: ReportView = { rows: [], columns: [], figures: [], sections: [] };

  // A bare array is the whole report.
  if (isRowArray(payload)) {
    return { ...empty, rows: payload, columns: columnsOf(payload) };
  }
  if (!isRecord(payload)) return empty;

  const arrays = Object.entries(payload).filter(([, v]) => isRowArray(v)) as [
    string,
    Row[],
  ][];

  // The longest array is the report's spine; anything else is a section.
  const [main, ...rest] = [...arrays].sort((a, b) => b[1].length - a[1].length);

  const figures = Object.entries(payload)
    .filter(([, v]) => !Array.isArray(v) && !isRecord(v) && v !== null)
    .filter(([key]) => !isRangeEcho(key))
    .map(([key, value]) => ({ key, value }));

  // A nested object of scalars (a `totals: {...}`) reads as more figures.
  for (const [key, value] of Object.entries(payload)) {
    if (!isRecord(value)) continue;
    for (const [inner, v] of Object.entries(value)) {
      if (!Array.isArray(v) && !isRecord(v) && v !== null && !isRangeEcho(inner)) {
        figures.push({ key: `${key}.${inner}`, value: v });
      }
    }
  }

  return {
    rows: main ? main[1] : [],
    columns: main ? columnsOf(main[1]) : [],
    figures,
    sections: rest.map(([key, rows]) => ({
      key,
      rows,
      columns: columnsOf(rows),
    })),
  };
}

/** `totalAmount` → "Total amount"; `loans.count` → "Loans count". */
export function labelOf(key: string): string {
  const words = key
    .replace(/\./g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Names that mean pesewas, so a number under them is money and not a count. */
const MONEY = /(amount|total|balance|principal|interest|commission|fee|fees|paid|repaid|outstanding|remaining|payout|deposited|collected|due|revenue|earned)/i;

/** Names that are ids rather than anything to read. */
const ID = /(^id$|Id$|_id$)/;

/** Counts and spans, which win over MONEY — `daysOverdue` is days, not cedis. */
const COUNTABLE = /(days?|count|quantity|months?|years?|term|number|rate|percent)/i;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T/;

/** Whether a number under this name is pesewas rather than a count. */
export function isMoneyKey(key: string): boolean {
  return MONEY.test(key) && !ID.test(key) && !COUNTABLE.test(key);
}

/** Whether a name is an id — never worth reading, never worth charting. */
export function isIdKey(key: string): boolean {
  return ID.test(key);
}

export function isDateString(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (ISO_DATE.test(value) || ISO_DATETIME.test(value))
  );
}

export function formatCell(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (typeof value === "number") {
    // Integer pesewas everywhere in this API; counts and days are not money.
    if (isMoneyKey(key)) return formatGhs(value, { symbol: null });
    return String(value);
  }

  if (typeof value === "string") {
    if (ISO_DATETIME.test(value)) return formatDateTime(value);
    if (ISO_DATE.test(value)) return formatDate(value);
    return value;
  }

  return JSON.stringify(value);
}

/** Money and counts sit right; words sit left. */
export function isNumericColumn(key: string, rows: Row[]): boolean {
  return rows.some((row) => typeof row[key] === "number");
}
