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

export function readCustomerForm(form: FormData): {
  input: CustomerInput;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const text = (name: string) => String(form.get(name) ?? "").trim();
  /** Typed free text, in the caps the form shows — never an email or a key. */
  const caps = (name: string) => text(name).toUpperCase();
  /** Bounded optional string: skipped when blank, checked when not. */
  const optional = (name: string, label: string, min: number, max: number) => {
    const v = caps(name);
    if (!v) return undefined;
    if (v.length < min || v.length > max)
      fieldErrors[name] = `${label} must be ${min}–${max} characters.`;
    return v;
  };

  const fullName = caps("fullName");
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

  const ghanaPostGps = caps("ghanaPostGps");
  const gpsError = validateGhanaPostGps(ghanaPostGps);
  if (gpsError) fieldErrors.ghanaPostGps = gpsError;

  const gender = text("gender");
  if (gender && !isGender(gender)) fieldErrors.gender = "Choose a gender.";
  const maritalStatus = text("maritalStatus");
  if (maritalStatus && !isMaritalStatus(maritalStatus))
    fieldErrors.maritalStatus = "Choose a marital status.";

  const idType = text("idType");
  const idNumber = caps("idNumber");
  if (idType && !isIdType(idType)) fieldErrors.idType = "Choose an ID type.";
  if (idNumber && !idType) fieldErrors.idType = "Choose the ID type as well.";
  if (idType && !idNumber) fieldErrors.idNumber = "Enter the ID number.";
  if (idNumber && (idNumber.length < 3 || idNumber.length > 30))
    fieldErrors.idNumber = "ID number must be 3–30 characters.";
  else if (idNumber && idType === "ghana-card") {
    const cardError = validateGhanaCard(idNumber);
    if (cardError) fieldErrors.idNumber = cardError;
  }

  // Next of kin hangs off the name: no name, no record.
  const kinName = caps("kinFullName");
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
  };

  return { input, fieldErrors };
}

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

export function fieldErrorsFromFailure(
  failure: ApiFailure,
): Record<string, string> {
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
