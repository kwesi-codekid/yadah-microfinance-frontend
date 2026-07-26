/**
 * Idempotency keys, shared by every endpoint that moves money.
 *
 * Susu deposits, collect-all, savings deposits and savings withdrawals all
 * require one (8–128 chars) and answer a repeat with the *original* result
 * instead of taking the money twice — which is the whole point on a phone with
 * one bar of signal, where a collector taps "Record" again because the first tap
 * seemed to do nothing.
 *
 * Client-safe (no server-only imports).
 */

/**
 * Mint a key for one write.
 *
 * The protection only works if the retry carries the *same* key, so generate
 * this **in the loader** and render it into a hidden field. A key minted in the
 * action is new on every submit and protects nothing; a key minted during render
 * differs between the server's HTML and the browser's hydration.
 *
 * One key per *write the user might repeat*, not one per page: a screen offering
 * both a deposit and a withdrawal mints two, so that recording one doesn't leave
 * the other holding a spent key.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Read the key back off a submitted form, collecting the error if it isn't one.
 *
 * The key comes from a hidden field the loader filled in, so a missing or
 * malformed one is a bug in this app, not something the user typed. It is still
 * checked rather than passed through: without it the API would reject the
 * request anyway, and the whole double-charge protection would be off.
 */
export function readIdempotencyKey(
  form: FormData,
  fieldErrors: Record<string, string>,
): string {
  const key = String(form.get("idempotencyKey") ?? "").trim();
  if (key.length < 8 || key.length > 128) {
    fieldErrors.idempotencyKey =
      "This form went stale. Reload the page and try again.";
  }
  return key;
}
