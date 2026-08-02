export const PHONE_RE = /^0[25]\d{8}$/;
export const USERNAME_RE = /^[a-z0-9._-]+$/;
export const OTP_RE = /^\d{6}$/;
/** GhanaPost digital address, e.g. `GA-183-9832`. Uppercase region prefix. */
export const GHANA_POST_GPS_RE = /^[A-Z]{2}-\d{3,4}-\d{4}$/;
/** Ghana Card number, e.g. `GHA-123456789-0` — nine digits then a check digit. */
export const GHANA_CARD_RE = /^GHA-\d{9}-\d$/;

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

export function validateGhanaPostGps(value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return null;
  if (!GHANA_POST_GPS_RE.test(v)) {
    return "Enter a valid GhanaPost address (e.g. GA-183-9832).";
  }
  return null;
}

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

export function formatGhanaPostGps(value: string): string {
  const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const letters = clean.replace(/[^A-Z]/g, "").slice(0, 2);
  const digits = clean.replace(/[^0-9]/g, "").slice(0, 8);

  if (letters.length < 2 || !digits) return letters;

  const split = digits.length > 7 ? 4 : 3;
  const head = digits.slice(0, split);
  const tail = digits.slice(split);
  return tail ? `${letters}-${head}-${tail}` : `${letters}-${head}`;
}
