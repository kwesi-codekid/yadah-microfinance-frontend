/**
 * Field validators mirroring the API's request schemas so the client can fail
 * fast with the same rules the server enforces. Keep these in sync with the
 * OpenAPI spec (v0.1.0).
 */

export const PHONE_RE = /^0[25]\d{8}$/;
export const USERNAME_RE = /^[a-z0-9._-]+$/;
export const OTP_RE = /^\d{6}$/;
/** GhanaPost digital address, e.g. `GA-183-9832`. Uppercase region prefix. */
export const GHANA_POST_GPS_RE = /^[A-Z]{2}-\d{3,4}-\d{4}$/;
/** Ghana Card number, e.g. `GHA-123456789-0` — nine digits then a check digit. */
export const GHANA_CARD_RE = /^GHA-\d{9}-\d$/;

/**
 * Returns an error message, or null when valid.
 *
 * Each failure gets its own message. Reporting "3–30 characters" for a username
 * that is the right length but has a capital letter or a space in it tells the
 * user to fix something that isn't wrong.
 */
export function validateUsername(value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return "Enter your username.";
  if (v.length < 3) return "Username must be at least 3 characters.";
  if (v.length > 30) return "Username must be 30 characters or fewer.";
  if (!USERNAME_RE.test(v)) {
    // Overwhelmingly this is a capital letter or a space, so name the rule.
    return "Invalid username. Use lowercase letters, numbers, and . _ - only.";
  }
  return null;
}

export function validatePassword(value: string): string | null {
  if (value.length < 1) return "Enter your password.";
  return null;
}

export function validatePhone(value: string): string | null {
  const v = value.trim();
  if (!PHONE_RE.test(v)) {
    return "Enter a valid Ghana phone number (e.g. 0241234567).";
  }
  return null;
}

/**
 * Optional field — an empty value is valid. Case is not corrected here: the
 * API's pattern demands uppercase, so the form uppercases as it goes rather
 * than rejecting someone for typing `ga-183-9832`.
 */
export function validateGhanaPostGps(value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return null;
  if (!GHANA_POST_GPS_RE.test(v)) {
    return "Enter a valid GhanaPost address (e.g. GA-183-9832).";
  }
  return null;
}

/**
 * Only Ghana Cards have a checkable shape — the API applies this pattern to
 * `identification.idNumber` when the type is `ghana-card` and answers 400
 * otherwise, so it's checked here to save the round trip. Passports, licences
 * and voter IDs are free-form.
 */
export function validateGhanaCard(value: string): string | null {
  if (!GHANA_CARD_RE.test(value.trim())) {
    return "Ghana Card numbers look like GHA-123456789-0.";
  }
  return null;
}

export function validateOtp(value: string): string | null {
  if (!OTP_RE.test(value.trim())) return "Enter the 6-digit code.";
  return null;
}
