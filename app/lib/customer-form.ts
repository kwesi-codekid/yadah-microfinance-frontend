import {
  fromDateInput,
  isGender,
  isIdType,
  isMaritalStatus,
  type CustomerInput,
} from "~/lib/customer-client";
import {
  validateGhanaCard,
  validateGhanaPostGps,
  validatePhone,
} from "~/lib/validation";
import type { ApiFailure } from "~/lib/api/client";

/**
 * Read the customer form into a `CustomerInput`, collecting field errors.
 *
 * Shared by the register and edit routes so the two can't validate differently.
 * The rules mirror the API's request schema — see the tracker's contract notes.
 *
 * Only `fullName` and `phone` are required; the rest of the profile can be
 * filled in later, so every optional field is omitted when blank rather than
 * sent as `""` (which would fail the API's min-length rules). The flip side,
 * worth knowing: an emptied field can't clear a stored value, because omitted
 * and "make this empty" look identical over the wire.
 */
export function readCustomerForm(form: FormData): {
  input: CustomerInput;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const text = (name: string) => String(form.get(name) ?? "").trim();
  /** Bounded optional string: skipped when blank, checked when not. */
  const optional = (name: string, label: string, min: number, max: number) => {
    const v = text(name);
    if (!v) return undefined;
    if (v.length < min || v.length > max)
      fieldErrors[name] = `${label} must be ${min}–${max} characters.`;
    return v;
  };

  const fullName = text("fullName");
  if (fullName.length < 2 || fullName.length > 120)
    fieldErrors.fullName = "Full name must be 2–120 characters.";

  const phone = text("phone");
  const phoneError = validatePhone(phone);
  if (phoneError) fieldErrors.phone = phoneError;

  const altPhone = text("altPhone");
  if (altPhone) {
    const altError = validatePhone(altPhone);
    if (altError) fieldErrors.altPhone = altError;
  }

  const ghanaPostGps = text("ghanaPostGps").toUpperCase();
  const gpsError = validateGhanaPostGps(ghanaPostGps);
  if (gpsError) fieldErrors.ghanaPostGps = gpsError;

  const gender = text("gender");
  if (gender && !isGender(gender)) fieldErrors.gender = "Choose a gender.";
  const maritalStatus = text("maritalStatus");
  if (maritalStatus && !isMaritalStatus(maritalStatus))
    fieldErrors.maritalStatus = "Choose a marital status.";

  // Identification is all-or-nothing: the API requires the type and number
  // together, so half an entry is rejected here with a message that says which
  // half is missing.
  const idType = text("idType");
  // Ghana Card numbers are matched against a pattern that demands uppercase.
  // Uppercasing here rather than rejecting `gha-…` mirrors what `ghanaPostGps`
  // does; the other ID types are free-form and left exactly as typed.
  const rawIdNumber = text("idNumber");
  const idNumber =
    idType === "ghana-card" ? rawIdNumber.toUpperCase() : rawIdNumber;
  if (idType && !isIdType(idType)) fieldErrors.idType = "Choose an ID type.";
  if (idNumber && !idType) fieldErrors.idType = "Choose the ID type as well.";
  if (idType && !idNumber) fieldErrors.idNumber = "Enter the ID number.";
  if (idNumber && (idNumber.length < 3 || idNumber.length > 30))
    fieldErrors.idNumber = "ID number must be 3–30 characters.";
  // The API rejects a mis-shaped Ghana Card with a 400 the form used to show as
  // a bare "Request validation failed" banner. Same rule, checked before the
  // round trip, reported on the field itself.
  else if (idNumber && idType === "ghana-card") {
    const cardError = validateGhanaCard(idNumber);
    if (cardError) fieldErrors.idNumber = cardError;
  }

  // Next of kin hangs off the name: no name, no record.
  const kinName = text("kinFullName");
  const kinRelationship = optional("kinRelationship", "Relationship", 2, 60);
  const kinPhone = text("kinPhone");
  const kinAddress = optional("kinAddress", "Address", 2, 300);
  if (kinName && (kinName.length < 2 || kinName.length > 120))
    fieldErrors.kinFullName = "Full name must be 2–120 characters.";
  if (kinPhone) {
    const kinPhoneError = validatePhone(kinPhone);
    if (kinPhoneError) fieldErrors.kinPhone = kinPhoneError;
  }
  if (!kinName && (kinRelationship || kinPhone || kinAddress))
    fieldErrors.kinFullName = "Enter the next of kin's name.";

  const input: CustomerInput = {
    fullName,
    phone,
    dateOfBirth: fromDateInput(text("dateOfBirth")),
    gender: isGender(gender) ? gender : undefined,
    nationality: optional("nationality", "Nationality", 2, 60),
    maritalStatus: isMaritalStatus(maritalStatus) ? maritalStatus : undefined,
    mothersMaidenName: optional("mothersMaidenName", "Mother's maiden name", 2, 120),
    residentialAddress: optional("residentialAddress", "Residential address", 2, 300),
    ghanaPostGps: ghanaPostGps || undefined,
    postalAddress: optional("postalAddress", "Postal address", 2, 300),
    altPhone: altPhone || undefined,
    email: text("email") || undefined,
    identification:
      isIdType(idType) && idNumber
        ? {
            idType,
            idNumber,
            idExpiryDate: fromDateInput(text("idExpiryDate")),
            idPlaceOfIssue: optional("idPlaceOfIssue", "Place of issue", 2, 100),
          }
        : undefined,
    occupation: optional("occupation", "Occupation", 2, 120),
    employerOrBusiness: optional("employerOrBusiness", "Employer or business", 2, 120),
    purposeOfAccount: optional("purposeOfAccount", "Purpose of account", 2, 200),
    nextOfKin: kinName
      ? {
          fullName: kinName,
          relationship: kinRelationship,
          phone: kinPhone || undefined,
          address: kinAddress,
        }
      : undefined,
    assignedCollectorId: text("assignedCollectorId") || undefined,
  };

  return { input, fieldErrors };
}

/**
 * Nested request paths back to the flat input names the form actually uses.
 * Anything not listed falls back to its last segment, which already matches
 * (`ghanaPostGps`, `fullName`, …).
 */
const API_PATH_TO_FIELD: Record<string, string> = {
  "identification.idType": "idType",
  "identification.idNumber": "idNumber",
  "identification.idExpiryDate": "idExpiryDate",
  "identification.idPlaceOfIssue": "idPlaceOfIssue",
  "nextOfKin.fullName": "kinFullName",
  "nextOfKin.relationship": "kinRelationship",
  "nextOfKin.phone": "kinPhone",
  "nextOfKin.address": "kinAddress",
};

/**
 * Turn a 400's `details` into per-field errors.
 *
 * The API says exactly what it objected to — `{ in: "body", path:
 * "identification.idNumber", message: "Ghana Card numbers look like …" }` —
 * and showing only the envelope's "Request validation failed" throws that away,
 * leaving the user to guess which of twenty fields is wrong. Mapped back to a
 * field name, the message lands under the input and the stepper jumps to it.
 *
 * Returns an empty object for anything that isn't a body validation failure, so
 * the caller still shows its banner for genuine server-side errors.
 */
export function fieldErrorsFromFailure(
  failure: ApiFailure,
): Record<string, string> {
  /**
   * The two 409s are about a field just as much as a 400 is — they mean this
   * phone or this ID already belongs to somebody — but they arrive as a bare
   * code with no `details` to map. Put them on the input that caused them: a
   * banner saying "Phone already registered" over twenty fields leaves the user
   * to work out which one, and the answer is usually "this person is already on
   * the system", which is worth saying plainly.
   */
  if (failure.status === 409) {
    if (failure.code === "PHONE_TAKEN")
      return {
        phone: "This phone number is already registered to another customer.",
      };
    if (failure.code === "ID_TAKEN")
      return {
        idNumber: "This ID number is already registered to another customer.",
      };
  }

  if (!Array.isArray(failure.details)) return {};
  const fieldErrors: Record<string, string> = {};
  for (const issue of failure.details) {
    if (!issue || typeof issue !== "object") continue;
    const { in: where, path, message } = issue as Record<string, unknown>;
    // `params` / `query` failures aren't about anything the user typed.
    if (where !== "body") continue;
    if (typeof path !== "string" || typeof message !== "string") continue;
    const name = API_PATH_TO_FIELD[path] ?? path.split(".").pop();
    // First message wins: the API lists them in schema order, and later ones
    // for the same field are usually the same complaint restated.
    if (name && !fieldErrors[name]) fieldErrors[name] = message;
  }
  return fieldErrors;
}

/** Mirrors the API's upload limits, so we can fail before the round trip. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Returns an error message for a rejected upload, or null when it's fine. */
export function validateUpload(file: unknown): string | null {
  if (!(file instanceof File) || file.size === 0) return "Choose a file to upload.";
  if (file.size > MAX_UPLOAD_BYTES) return "File must be 5 MB or smaller.";
  if (!UPLOAD_TYPES.includes(file.type)) return "Use a JPEG, PNG or WebP image.";
  return null;
}
