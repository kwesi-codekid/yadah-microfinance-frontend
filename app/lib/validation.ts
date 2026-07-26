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

/* ------------------------------------------------------------------ *
 * Input masks
 *
 * The two fields with a fixed shape punctuate themselves as they are typed,
 * so nobody has to reach for the hyphen key and nobody gets rejected for
 * leaving it out. Both are written against the patterns above, and both are
 * idempotent — running one over its own output changes nothing, which is what
 * lets them be applied on every keystroke.
 *
 * They only ever *add* punctuation and case. Anything that isn't a letter or a
 * digit is dropped, so pasting `GHA-123456789-0` or `gha 123456789 0` lands in
 * the same place.
 *
 * One known limitation: rewriting the value sends the caret to the end, so
 * editing the middle of an already-typed number jumps to the end. Fine for
 * typing left to right, which is how these are entered.
 * ------------------------------------------------------------------ */

/** `GHA-123456789-0` — the prefix is constant, so typing digits alone works. */
export function formatGhanaCard(value: string): string {
  const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const digits = clean.replace(/[^0-9]/g, "").slice(0, 10);

  // Nothing to hang a prefix on yet — let them type G, GH, GHA.
  if (!digits) return clean.slice(0, 3);

  const serial = digits.slice(0, 9);
  const check = digits.slice(9);
  return check ? `GHA-${serial}-${check}` : `GHA-${serial}`;
}

/**
 * `GA-183-9832` — two letters, then 3–4 digits, then 4.
 *
 * The middle group's length isn't knowable until the end, so the split is
 * decided from the total: seven digits means 3+4, eight means 4+4. Typing an
 * eighth digit therefore shifts the second hyphen left by one. It looks odd for
 * one keystroke and it always lands on a valid address, which beats guessing
 * wrong and leaving the user to fix punctuation they never asked for.
 */
export function formatGhanaPostGps(value: string): string {
  const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const letters = clean.replace(/[^A-Z]/g, "").slice(0, 2);
  const digits = clean.replace(/[^0-9]/g, "").slice(0, 8);

  // The region code comes first and is always two letters; until both are
  // there, there is nothing to punctuate.
  if (letters.length < 2 || !digits) return letters;

  const split = digits.length > 7 ? 4 : 3;
  const head = digits.slice(0, split);
  const tail = digits.slice(split);
  return tail ? `${letters}-${head}-${tail}` : `${letters}-${head}`;
}
