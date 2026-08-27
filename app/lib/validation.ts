/**
 * Client-side pre-checks. They catch typos before a round trip; the API is
 * still the authority, and its `VALIDATION_ERROR` details win on conflict.
 */

export function validateUsername(value: string): string | null {
  if (!value) return "Enter your username.";
  if (value.length < 3) return "Usernames are at least 3 characters.";
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return "Enter your password.";
  if (value.length < 8) return "Passwords are at least 8 characters.";
  return null;
}

/** Ghana numbers: 10 digits starting 0, or +233 followed by 9. */
export function validatePhone(value: string): string | null {
  if (!value) return "Enter your phone number.";
  const digits = value.replace(/[\s-]/g, "");
  if (!/^(0\d{9}|\+233\d{9})$/.test(digits)) {
    return "Enter a Ghana number, like 0244123456.";
  }
  return null;
}

export function validateOtp(value: string): string | null {
  if (!value) return "Enter the 6-digit code.";
  if (!/^\d{6}$/.test(value)) return "The code is 6 digits.";
  return null;
}
