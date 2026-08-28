/**
 * The one place the customer registration form is turned into an API body.
 * Registration (`POST`) and editing (`PATCH`) post identical field names, so
 * they share this parser rather than drifting apart field by field.
 *
 * Client-safe: it touches `FormData` and nothing else, so the form component
 * can reuse the same field-name constants the actions read.
 */

import type {
  CreateCustomerInput,
  Customer,
  Gender,
  IdType,
  MaritalStatus,
  UpdateCustomerInput,
} from "~/lib/customers";

/** Turn a `yyyy-mm-dd` date field into the UTC datetime the API stores. */
export function toIso(day?: string): string | undefined {
  if (!day) return undefined;
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** The `yyyy-mm-dd` a stored datetime should prefill a `DateField` with. */
export function toDay(iso?: string): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

/**
 * Every field the form submits, as one object. Blank fields become `undefined`
 * so they are omitted from a `POST` body — the API rejects empty strings
 * against its `minLength` rules. Clearing a field is an edit's concern, and
 * `diffCustomer` turns "was set, now blank" into the `null` a `PATCH` wants.
 *
 * Free-text branch data is recorded in capitals, matching how the entry form
 * shows it and how v1 stored it. Email and phone numbers keep their case.
 */
export function parseCustomerForm(form: FormData): CreateCustomerInput {
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const up = (k: string) => get(k)?.toUpperCase();

  const input: CreateCustomerInput = {
    fullName: up("fullName") ?? "",
    phone: get("phone") ?? "",
    photoUrl: get("photoUrl") ?? "",
    idDocumentFrontUrl: get("idDocumentFrontUrl") ?? "",
    idDocumentBackUrl: get("idDocumentBackUrl") ?? "",
    assignedCollectorId: get("assignedCollectorId") ?? "",
    dateOfBirth: toIso(get("dateOfBirth")),
    gender: get("gender") as Gender | undefined,
    nationality: up("nationality"),
    maritalStatus: get("maritalStatus") as MaritalStatus | undefined,
    mothersMaidenName: up("mothersMaidenName"),
    residentialAddress: up("residentialAddress"),
    ghanaPostGps: up("ghanaPostGps"),
    postalAddress: up("postalAddress"),
    altPhone: get("altPhone"),
    email: get("email"),
    occupation: up("occupation"),
    employerOrBusiness: up("employerOrBusiness"),
    purposeOfAccount: up("purposeOfAccount"),
  };

  const idType = get("idType") as IdType | undefined;
  const idNumber = up("idNumber");
  if (idType && idNumber) {
    input.identification = {
      idType,
      idNumber,
      idExpiryDate: toIso(get("idExpiryDate")),
      idPlaceOfIssue: up("idPlaceOfIssue"),
    };
  }

  const kinName = up("kinFullName");
  if (kinName) {
    input.nextOfKin = {
      fullName: kinName,
      relationship: up("kinRelationship"),
      phone: get("kinPhone"),
      address: up("kinAddress"),
    };
  }

  return input;
}

/**
 * The three the record cannot be without, whether it is being made or edited.
 */
function missingProfile(input: CreateCustomerInput): boolean {
  return !input.fullName || !input.phone || !input.photoUrl;
}

/**
 * The six fields `POST /customers` insists on, in the order the form shows
 * them: the three above, both sides of the ID document, and the collector —
 * every customer joins somebody's round at registration, and the API refuses
 * the record without one.
 */
export function missingRequired(input: CreateCustomerInput): boolean {
  return (
    missingProfile(input) ||
    !input.idDocumentFrontUrl ||
    !input.idDocumentBackUrl ||
    !input.assignedCollectorId
  );
}

/**
 * The same check for an edit, which is a shorter list.
 *
 * `PATCH` has no collector field — a round moves only through the admin-only
 * `PATCH /customers/{id}/collector` — so the edit form does not post one, and
 * holding it to the registration check would refuse every save. The ID scans
 * are not held to it either: an edit that leaves them blank leaves them alone.
 */
export function missingRequiredForEdit(input: CreateCustomerInput): boolean {
  return missingProfile(input);
}

const SCALARS = [
  "fullName",
  "dateOfBirth",
  "gender",
  "nationality",
  "maritalStatus",
  "mothersMaidenName",
  "residentialAddress",
  "ghanaPostGps",
  "postalAddress",
  "phone",
  "altPhone",
  "email",
  "occupation",
  "employerOrBusiness",
  "purposeOfAccount",
  "photoUrl",
  "idDocumentFrontUrl",
  "idDocumentBackUrl",
] as const satisfies readonly (keyof CreateCustomerInput)[];

/**
 * The ones a `PATCH` may blank with `null`. The rest — name, phone, photo,
 * the ID scans — the record cannot be without, so a blank there is "leave it
 * alone", never "clear it".
 */
const CLEARABLE = new Set<(typeof SCALARS)[number]>([
  "dateOfBirth",
  "gender",
  "nationality",
  "maritalStatus",
  "mothersMaidenName",
  "residentialAddress",
  "ghanaPostGps",
  "postalAddress",
  "altPhone",
  "email",
  "occupation",
  "employerOrBusiness",
  "purposeOfAccount",
]);

/** Dates come back with a time on them; compare the day, not the timestamp. */
function sameDate(a?: string, b?: string): boolean {
  return toDay(a) === toDay(b);
}

/** Set on the record, in the sense the API means it: present and not blank. */
function held(value: unknown): boolean {
  return value != null && value !== "";
}

/**
 * The `PATCH` body for an edit: only what actually changed. Resending an
 * unchanged phone or ID number would have the API check it for uniqueness
 * against every *other* record and, worse, makes the audit trail claim an edit
 * that never happened. Returns an empty object when nothing was touched.
 *
 * A field that was set and is now blank goes as `null`, which is how the API
 * clears it — omitting it would leave the old value standing, and a form that
 * cannot remove a wrong email is a form people work around. A field blank on
 * both sides is left out of the body altogether.
 */
export function diffCustomer(
  current: Customer,
  next: CreateCustomerInput,
): UpdateCustomerInput {
  const patch: Record<string, unknown> = {};

  for (const key of SCALARS) {
    const value = next[key];
    const was = current[key];
    if (value === undefined || value === "") {
      if (CLEARABLE.has(key) && held(was)) patch[key] = null;
      continue;
    }
    const changed =
      key === "dateOfBirth"
        ? !sameDate(value as string, was as string)
        : value !== was;
    if (changed) patch[key] = value;
  }

  if (next.identification) {
    const was = current.identification;
    const changed =
      !was ||
      was.idType !== next.identification.idType ||
      was.idNumber !== next.identification.idNumber ||
      was.idPlaceOfIssue !== next.identification.idPlaceOfIssue ||
      !sameDate(next.identification.idExpiryDate, was.idExpiryDate);
    // The API returns the whole block, so every field of it can be compared.
    // It is still sent whole: it has no partial update of its own.
    if (changed) patch.identification = next.identification;
  } else if (current.identification) {
    patch.identification = null;
  }

  if (next.nextOfKin) {
    const was = current.nextOfKin;
    const changed =
      !was ||
      was.fullName !== next.nextOfKin.fullName ||
      was.relationship !== next.nextOfKin.relationship ||
      was.phone !== next.nextOfKin.phone ||
      was.address !== next.nextOfKin.address;
    if (changed) patch.nextOfKin = next.nextOfKin;
  } else if (current.nextOfKin) {
    patch.nextOfKin = null;
  }

  return patch as UpdateCustomerInput;
}
