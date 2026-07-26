/**
 * Client-safe customer types, mirroring the API's `components.schemas`.
 * Safe to import from browser components (no server-only code here) — the same
 * split as [auth-client.ts](app/lib/auth-client.ts), which owns the staff side.
 *
 * Source of truth: GET https://yadah-backend-staging.adamusgh.com/api/v1/openapi.json
 */

export type Gender = "male" | "female";
export type MaritalStatus = "single" | "married" | "other";
export type IdType = "ghana-card" | "passport" | "drivers-license" | "voter-id";
export type CustomerStatus = "active" | "inactive";

export const GENDERS: Gender[] = ["male", "female"];
export const MARITAL_STATUSES: MaritalStatus[] = ["single", "married", "other"];
export const ID_TYPES: IdType[] = [
  "ghana-card",
  "passport",
  "drivers-license",
  "voter-id",
];

export const GENDER_LABELS: Record<Gender, string> = {
  male: "Male",
  female: "Female",
};

export const MARITAL_STATUS_LABELS: Record<MaritalStatus, string> = {
  single: "Single",
  married: "Married",
  other: "Other",
};

export const ID_TYPE_LABELS: Record<IdType, string> = {
  "ghana-card": "Ghana Card",
  passport: "Passport",
  "drivers-license": "Driver's licence",
  "voter-id": "Voter ID",
};

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  active: "Active",
  inactive: "Inactive",
};

/** Required as a pair — an ID number without a type is meaningless. */
export interface Identification {
  idType: IdType;
  idNumber: string;
  idExpiryDate?: string;
  idPlaceOfIssue?: string;
}

export interface NextOfKin {
  fullName: string;
  relationship?: string;
  phone?: string;
  address?: string;
}

/** The `Customer` schema — what the API returns for a customer. */
export interface Customer {
  id: string;
  fullName: string;
  dateOfBirth?: string;
  gender?: Gender;
  nationality?: string;
  maritalStatus?: MaritalStatus;
  mothersMaidenName?: string;
  residentialAddress?: string;
  ghanaPostGps?: string;
  postalAddress?: string;
  phone: string;
  altPhone?: string;
  email?: string;
  identification?: Identification;
  occupation?: string;
  employerOrBusiness?: string;
  purposeOfAccount?: string;
  nextOfKin?: NextOfKin;
  photoUrl?: string;
  /**
   * Both sides of the ID, stored as hosted URLs.
   *
   * These replaced a single `idDocumentUrl`, and they are plain strings rather
   * than uploads: the file goes to `POST /uploads/images` first and the URL it
   * hands back is what gets written here. See [uploads.ts](app/lib/api/uploads.ts).
   */
  idDocumentFrontUrl?: string;
  idDocumentBackUrl?: string;
  registeredById: string;
  status: CustomerStatus;
  createdAt: string;
}

/**
 * The write shape for create and update. It lives here rather than beside the
 * `apiFetch` wrappers so the form code — which runs on both sides of the wire —
 * can name it without pulling in a server-only module.
 */
export interface CustomerInput {
  fullName: string;
  phone: string;
  dateOfBirth?: string;
  gender?: Gender;
  nationality?: string;
  maritalStatus?: MaritalStatus;
  mothersMaidenName?: string;
  residentialAddress?: string;
  ghanaPostGps?: string;
  postalAddress?: string;
  altPhone?: string;
  email?: string;
  identification?: Identification;
  occupation?: string;
  employerOrBusiness?: string;
  purposeOfAccount?: string;
  nextOfKin?: NextOfKin;
  /**
   * Image URLs from `POST /uploads/images`, not files. The customer endpoints
   * take no multipart body at all — a picture is uploaded on its own and only
   * its URL is written to the record, on create or on update alike.
   */
  photoUrl?: string;
  idDocumentFrontUrl?: string;
  idDocumentBackUrl?: string;
}

export function isGender(v: unknown): v is Gender {
  return typeof v === "string" && (GENDERS as string[]).includes(v);
}

export function isMaritalStatus(v: unknown): v is MaritalStatus {
  return typeof v === "string" && (MARITAL_STATUSES as string[]).includes(v);
}

export function isIdType(v: unknown): v is IdType {
  return typeof v === "string" && (ID_TYPES as string[]).includes(v);
}

/**
 * `dateOfBirth` / `idExpiryDate` come back as ISO date-times but are entered
 * through `<input type="date">`, which only speaks `YYYY-MM-DD`. Slicing the
 * date part off is deliberate: parsing to a local `Date` would shift the day
 * backwards for anyone west of UTC, which is every user of this app.
 */
export function toDateInput(iso?: string): string {
  return iso ? iso.slice(0, 10) : "";
}

/** The inverse — the API stores UTC (see the tracker's date convention). */
export function fromDateInput(value: string): string | undefined {
  return value ? `${value}T00:00:00.000Z` : undefined;
}
