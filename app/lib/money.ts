export const PESEWAS_PER_CEDI = 100;

export function pesewasToGhs(pesewas: number): number {
  return pesewas / PESEWAS_PER_CEDI;
}

export function ghsToPesewas(ghs: number): number {
  return Math.round(ghs * PESEWAS_PER_CEDI);
}

/** Digits, an optional decimal point, and at most two places after it. */
const AMOUNT_RE = /^\d+(?:\.\d{1,2})?$/;

export function parseGhsAmount(value: string): number | null {
  const cleaned = value
    .trim()
    .replace(/^(?:gh₵|ghs|gh¢|₵|¢)\s*/i, "")
    .replace(/,/g, "")
    .trim();
  if (!AMOUNT_RE.test(cleaned)) return null;

  const [cedis, fraction = ""] = cleaned.split(".");
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

export function toAmountInput(pesewas: number): string {
  const sign = pesewas < 0 ? "-" : "";
  const abs = Math.abs(Math.round(pesewas));
  const cedis = Math.floor(abs / PESEWAS_PER_CEDI);
  const rest = abs % PESEWAS_PER_CEDI;
  return `${sign}${cedis}.${String(rest).padStart(2, "0")}`;
}

export const CEDI = "₵";

export interface FormatGhsOptions {
  symbol?: string | null;
  trimZeroPesewas?: boolean;
}

export function formatGhs(
  pesewas: number,
  { symbol = CEDI, trimZeroPesewas = false }: FormatGhsOptions = {},
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

  const prefix = symbol ? (/[a-z]$/i.test(symbol) ? `${symbol} ` : symbol) : "";
  return `${sign}${prefix}${body}`;
}
