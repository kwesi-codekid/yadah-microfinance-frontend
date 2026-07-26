/**
 * Money helpers.
 *
 * Every amount in the API is an **integer number of pesewas** — GHS 10.50 is
 * `1050`. Nothing in this app should hold a cedi float: `0.1 + 0.2` is the
 * classic example, but the one that bites here is a susu cycle, where a daily
 * amount is multiplied by 31 and then compared against a server-computed total.
 * Off by one pesewa is a failed reconciliation, not a rounding cosmetic.
 *
 * So: pesewas everywhere, converted only at the two edges — reading a form
 * field, and painting a screen.
 *
 * Client-safe (no server-only imports), same as
 * [customer-client.ts](app/lib/customer-client.ts).
 */

export const PESEWAS_PER_CEDI = 100;

/**
 * Pesewas → cedis, as a number.
 *
 * Lossy by nature and only for the rare caller that needs arithmetic in cedis
 * (a chart axis, say). To put an amount on screen use `formatGhs`, and to put
 * one in an input use `toAmountInput` — neither goes through a float.
 */
export function pesewasToGhs(pesewas: number): number {
  return pesewas / PESEWAS_PER_CEDI;
}

/**
 * Cedis → pesewas.
 *
 * `Math.round` is not decoration: `10.55 * 100` is `1054.9999999999998` in
 * binary floating point, and truncating that loses a pesewa. Prefer
 * `parseGhsAmount` when the value came from a user — it reads the digits
 * directly and never builds a float at all.
 */
export function ghsToPesewas(ghs: number): number {
  return Math.round(ghs * PESEWAS_PER_CEDI);
}

/** Digits, an optional decimal point, and at most two places after it. */
const AMOUNT_RE = /^\d+(?:\.\d{1,2})?$/;

/**
 * Read a typed amount into pesewas, or `null` if it isn't one.
 *
 * Tolerant of what people actually type: `GHS 1,050.50`, `₵10`, `10.5`, and
 * stray whitespace all parse. Deliberately *not* tolerant of a third decimal —
 * `10.555` is not an amount of money, and silently rounding it would take a
 * cedi off someone's payout without telling them.
 *
 * The two halves are parsed as separate integers rather than as one float, so
 * the result is exact regardless of magnitude.
 */
export function parseGhsAmount(value: string): number | null {
  const cleaned = value
    .trim()
    .replace(/^(?:gh₵|ghs|gh¢|₵|¢)\s*/i, "")
    .replace(/,/g, "")
    .trim();
  if (!AMOUNT_RE.test(cleaned)) return null;

  const [cedis, fraction = ""] = cleaned.split(".");
  // One decimal place means tens of pesewas: the `5` in `10.5` is fifty, not
  // five. Pad right before reading it as an integer.
  const pesewas = fraction.padEnd(2, "0");
  return Number(cedis) * PESEWAS_PER_CEDI + Number(pesewas);
}

export interface AmountRules {
  /** Field name for the message, e.g. "Daily amount". */
  label?: string;
  /** Inclusive lower bound in pesewas. Defaults to 1 — the API's minimum. */
  min?: number;
  /** Inclusive upper bound in pesewas. */
  max?: number;
}

/**
 * Returns an error message, or null when valid — the same shape as the
 * validators in [validation.ts](app/lib/validation.ts), so form code treats
 * amounts like any other field.
 *
 * Each failure gets its own message. Answering "must be at least GHS 0.01" to
 * someone who typed `abc` tells them to fix a bound that isn't the problem.
 */
export function validateGhsAmount(
  value: string,
  { label = "Amount", min = 1, max }: AmountRules = {},
): string | null {
  const raw = value.trim();
  if (!raw) return `Enter ${label.toLowerCase()}.`;

  const pesewas = parseGhsAmount(raw);
  if (pesewas === null) {
    return `${label} must be an amount in cedis (e.g. 10.50).`;
  }
  if (pesewas < min) return `${label} must be at least ${formatGhs(min)}.`;
  if (max !== undefined && pesewas > max) {
    return `${label} cannot be more than ${formatGhs(max)}.`;
  }
  return null;
}

/**
 * Pesewas → the bare `10.50` an `<input>` should be prefilled with.
 *
 * No symbol and no grouping: this is a value going back into a text field, and
 * a comma in it would fail `parseGhsAmount` on the next submit.
 */
export function toAmountInput(pesewas: number): string {
  const sign = pesewas < 0 ? "-" : "";
  const abs = Math.abs(Math.round(pesewas));
  const cedis = Math.floor(abs / PESEWAS_PER_CEDI);
  const rest = abs % PESEWAS_PER_CEDI;
  return `${sign}${cedis}.${String(rest).padStart(2, "0")}`;
}

export interface FormatGhsOptions {
  /** Currency prefix. `null` drops it, for tables that label the column instead. */
  symbol?: string | null;
  /**
   * Drop `.00` on whole-cedi amounts. Useful in dense views; leave it off for
   * anything a customer reconciles against, where a ragged decimal column is
   * harder to scan than a repetitive one.
   */
  trimZeroPesewas?: boolean;
}

/**
 * Pesewas → a display string, e.g. `GHS 1,050.50`.
 *
 * Formatted by hand rather than with `Intl.NumberFormat`. This app renders on
 * the server and hydrates in the browser, and the two runtimes do not always
 * ship the same ICU data — `GH₵` on one side and `GHS` on the other is a
 * hydration mismatch that only shows up on someone else's machine. Grouping
 * digits with a regex is dull, but it is the same string everywhere.
 */
export function formatGhs(
  pesewas: number,
  { symbol = "GHS", trimZeroPesewas = false }: FormatGhsOptions = {},
): string {
  const sign = pesewas < 0 ? "-" : "";
  const abs = Math.abs(Math.round(pesewas));
  const cedis = Math.floor(abs / PESEWAS_PER_CEDI);
  const rest = abs % PESEWAS_PER_CEDI;

  const grouped = String(cedis).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body =
    trimZeroPesewas && rest === 0
      ? grouped
      : `${grouped}.${String(rest).padStart(2, "0")}`;

  return `${sign}${symbol ? `${symbol} ` : ""}${body}`;
}
