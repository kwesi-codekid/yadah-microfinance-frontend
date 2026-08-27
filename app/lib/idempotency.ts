/**
 * Idempotency keys for the money-moving endpoints.
 *
 * Twelve endpoints take one in the JSON body. A retry carrying the same key
 * returns the original record with `200` instead of recording the movement
 * twice — which is the difference between a slow network and a customer being
 * charged for two days of susu they only paid once.
 *
 * The key must therefore be minted once per *intent*, not once per request:
 * generated when the form opens and carried in a hidden field, so a double
 * click, a resubmit after an error, or a browser retry all send the same one.
 */

/** A fresh key. 32–36 characters, inside the API's 8–128 range. */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Older Safari, and any page served over plain http.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
