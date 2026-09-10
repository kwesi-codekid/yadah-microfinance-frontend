/**
 * Bulk customer registration from a spreadsheet: the columns, and the checks
 * the preview screen can answer on its own.
 *
 * The API is the authority — it re-checks every row on submit, and only it can
 * say whether a phone number is already on somebody. What lives here is the
 * half that needs no round trip: required cells, formats, the enums, and a
 * number used twice in one sheet. Those are the faults people actually make,
 * and flagging them as the cell is corrected is the whole point of a preview.
 *
 * Client-safe: no `.server` imports. Fetching lives in `~/api/customers`.
 */

import {
  normalizePhone,
  type SheetColumnSpec,
  type SheetIssue,
  type SheetRow,
} from "~/components/import-sheet";
import {
  ID_NUMBER_RULES,
  PHONE_RE,
  checkIdNumber,
  type IdType,
} from "~/lib/customers";

export { normalizePhone };

export const IMPORT_FIELDS = [
  "fullName",
  "phone",
  "collector",
  "dateOfBirth",
  "gender",
  "maritalStatus",
  "nationality",
  "occupation",
  "residentialAddress",
  "altPhone",
  "idType",
  "idNumber",
  "kinFullName",
  "kinRelationship",
  "kinPhone",
  "kinAddress",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportColumn = SheetColumnSpec<ImportField>;
export type RowIssue = SheetIssue<ImportField>;

const ID_TYPE_OPTIONS = (Object.keys(ID_NUMBER_RULES) as IdType[]).map((value) => ({
  value,
  label:
    value === "ghana-card"
      ? "Ghana Card"
      : value === "drivers-license"
        ? "Driver's licence"
        : value === "voter-id"
          ? "Voter ID"
          : "Passport",
}));

export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  { field: "fullName", header: "Full name", required: true, input: "text", width: "w-52" },
  { field: "phone", header: "Phone", required: true, input: "phone", width: "w-36" },
  /** Drawn by the page: a picker over the collectors the API offered. */
  { field: "collector", header: "Collector", required: true, input: "custom", width: "w-44" },
  { field: "dateOfBirth", header: "Date of birth", input: "date", width: "w-36" },
  {
    field: "gender",
    header: "Gender",
    input: "select",
    options: [
      { value: "male", label: "Male" },
      { value: "female", label: "Female" },
    ],
    width: "w-28",
  },
  {
    field: "maritalStatus",
    header: "Marital status",
    input: "select",
    options: [
      { value: "single", label: "Single" },
      { value: "married", label: "Married" },
      { value: "other", label: "Other" },
    ],
    width: "w-32",
  },
  { field: "nationality", header: "Nationality", input: "text", width: "w-32" },
  { field: "occupation", header: "Occupation", input: "text", width: "w-40" },
  { field: "residentialAddress", header: "Residential address", input: "text", width: "w-56" },
  { field: "altPhone", header: "Secondary phone", input: "phone", width: "w-36" },
  { field: "idType", header: "ID type", input: "select", options: ID_TYPE_OPTIONS, width: "w-36" },
  { field: "idNumber", header: "ID number", input: "text", width: "w-44" },
  { field: "kinFullName", header: "Next of kin name", input: "text", width: "w-48" },
  { field: "kinRelationship", header: "Next of kin relationship", input: "text", width: "w-40" },
  { field: "kinPhone", header: "Next of kin phone", input: "phone", width: "w-36" },
  { field: "kinAddress", header: "Next of kin address", input: "text", width: "w-48" },
];

export interface ImportRow extends SheetRow<ImportField> {
  assignedCollectorId: string;
}

export interface Collector {
  id: string;
  name: string;
}

/** `POST /customers/import/preview` */
export interface ImportPreview {
  rows: {
    row: number;
    values: Partial<Record<ImportField, string>>;
    assignedCollectorId: string;
    issues: RowIssue[];
  }[];
  unknownHeaders: string[];
  collectors: Collector[];
  counts: { total: number; ready: number; blocked: number };
}

/** `POST /customers/import` */
export interface ImportOutcome {
  created: { row: number; id: string; fullName: string }[];
  failed: { row: number; issues: RowIssue[] }[];
  counts: { total: number; created: number; failed: number };
}

export function blankValues(): Record<ImportField, string> {
  return Object.fromEntries(IMPORT_FIELDS.map((f) => [f, ""])) as Record<
    ImportField,
    string
  >;
}

/* --------------------------------------------------------------- the checks --- */

const GENDERS = new Set(["male", "female"]);
const MARITAL = new Set(["single", "married", "other"]);
const ID_TYPES = new Set<IdType>([
  "ghana-card",
  "passport",
  "drivers-license",
  "voter-id",
]);

/** Enum cells are matched on letters only, so "Ghana Card" is a ghana-card. */
export function canonicalEnum(raw: string, allowed: Iterable<string>): string | null {
  const key = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (key === "") return null;
  for (const option of allowed) {
    if (option.toLowerCase().replace(/[^a-z]/g, "") === key) return option;
  }
  return null;
}

const MIN_AGE_YEARS = 10;

function dateIssue(raw: string): string | null {
  const v = raw.trim();
  if (v === "") return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  if (!iso) return "Use the form 1990-04-12";
  const at = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(at)) return "Not a real date";
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - MIN_AGE_YEARS);
  if (at > cutoff.getTime()) return `Customer must be at least ${MIN_AGE_YEARS} years old`;
  return null;
}

/**
 * Everything the browser can decide about one row on its own. Uniqueness
 * against the books is not in here — that answer belongs to the API, and it
 * gives it again on submit.
 */
function ownIssues(values: Record<ImportField, string>, hasCollector: boolean): RowIssue[] {
  const issues: RowIssue[] = [];
  const add = (field: ImportField | null, message: string) => issues.push({ field, message });

  if (values.fullName.trim().length < 2) add("fullName", "A name is required");
  if (!hasCollector) add("collector", "Choose the collector whose round this customer joins");

  const phone = normalizePhone(values.phone);
  if (phone === "") add("phone", "A phone number is required");
  else if (!PHONE_RE.test(phone)) add("phone", "Expected a number like 0241234567");

  const alt = normalizePhone(values.altPhone);
  if (alt !== "" && !PHONE_RE.test(alt)) add("altPhone", "Expected a number like 0241234567");
  else if (alt !== "" && alt === phone) add("altPhone", "Same as the main phone");

  const kinPhone = normalizePhone(values.kinPhone);
  if (kinPhone !== "" && !PHONE_RE.test(kinPhone)) {
    add("kinPhone", "Expected a number like 0241234567");
  } else if (kinPhone !== "" && (kinPhone === phone || kinPhone === alt)) {
    add("kinPhone", "Same as another number on this row");
  }

  const dob = dateIssue(values.dateOfBirth);
  if (dob) add("dateOfBirth", dob);

  if (values.gender.trim() && !canonicalEnum(values.gender, GENDERS)) {
    add("gender", "Male or female");
  }
  if (values.maritalStatus.trim() && !canonicalEnum(values.maritalStatus, MARITAL)) {
    add("maritalStatus", "Single, married or other");
  }

  const idType = values.idType.trim() ? canonicalEnum(values.idType, ID_TYPES) : null;
  const idNumber = values.idNumber.trim();
  if (values.idType.trim() && !idType) {
    add("idType", "Ghana Card, passport, driver's licence or voter ID");
  }
  if (idType && !idNumber) add("idNumber", "An ID type needs its number");
  if (idNumber && !idType) add("idType", "An ID number needs its type");
  if (idType && idNumber) {
    const fault = checkIdNumber(idType as IdType, idNumber);
    if (fault) add("idNumber", fault);
  }

  const kinRest = [values.kinRelationship, values.kinPhone, values.kinAddress].some(
    (v) => v.trim() !== "",
  );
  if (kinRest && values.kinFullName.trim().length < 2) {
    add("kinFullName", "Next of kin needs a name");
  }

  return issues;
}

/**
 * Re-check the whole sheet. Server issues are kept only where the cell they
 * were about has not been touched — once someone edits a flagged phone, the
 * API's "already taken" no longer describes what is in the box.
 */
export function checkRows(rows: ImportRow[], collectorIds: Set<string>): ImportRow[] {
  const firstPhone = new Map<string, number>();
  const firstId = new Map<string, number>();

  return rows.map((row) => {
    const issues = ownIssues(row.values, collectorIds.has(row.assignedCollectorId));

    const phone = normalizePhone(row.values.phone);
    if (phone !== "" && PHONE_RE.test(phone)) {
      const earlier = firstPhone.get(phone);
      if (earlier !== undefined) {
        issues.push({ field: "phone", message: `Same phone as row ${earlier}` });
      } else {
        firstPhone.set(phone, row.row);
      }
    }

    const idNumber = row.values.idNumber.trim().toUpperCase();
    if (idNumber !== "") {
      const earlier = firstId.get(idNumber);
      if (earlier !== undefined) {
        issues.push({ field: "idNumber", message: `Same ID number as row ${earlier}` });
      } else {
        firstId.set(idNumber, row.row);
      }
    }

    const kept = row.issues.filter(
      (i) => i.fromServer && !issues.some((own) => own.field === i.field),
    );
    return { ...row, issues: [...issues, ...kept] };
  });
}
