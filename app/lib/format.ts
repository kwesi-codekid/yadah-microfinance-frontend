/**
 * Shared display formatters.
 */

/**
 * Grouped by hand rather than via `toLocaleString`, so the server and the
 * browser can never disagree about separators and trip a hydration mismatch.
 */
export function formatCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * The Accra calendar day (`YYYY-MM-DD`) an instant falls on. Business days are
 * Accra days, so day boundaries must be measured there, never in the browser's
 * timezone. These helpers are meant to run in loaders — call them on the server
 * and pass the resulting string down, so render and hydration always agree.
 */
export function accraDay(instant: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** A human date in Accra, e.g. `12 Aug 2026`. */
export function formatAccraDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Accra",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

const dayNumber = (accra: string) => Date.parse(`${accra}T00:00:00Z`) / 86_400_000;

/**
 * A relative label for a past instant, counted in Accra days:
 * `Today`, `Yesterday`, `5 days ago`, `3 weeks ago`, then an absolute date.
 */
export function relativeDayLabel(iso: string, now: Date = new Date()): string {
  const days = dayNumber(accraDay(now)) - dayNumber(accraDay(new Date(iso)));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "Last week";
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return formatAccraDate(iso);
}

/** Whole years between a date of birth and now, in Accra. Null if unparseable. */
export function ageInYears(dobIso: string, now: Date = new Date()): number | null {
  const dob = new Date(dobIso);
  if (Number.isNaN(dob.getTime())) return null;
  const [ny, nm, nd] = accraDay(now).split("-").map(Number);
  const [by, bm, bd] = accraDay(dob).split("-").map(Number);
  let age = ny - by;
  if (nm < bm || (nm === bm && nd < bd)) age -= 1;
  return age < 0 ? null : age;
}
/**
 * Integer pesewas as Ghana cedis — `1050` → `GH₵ 10.50`. Every money value the
 * API returns is an integer minor unit, so nothing is ever divided before it
 * reaches here. Grouped by hand for the same reason `formatCount` is.
 */
export function formatPesewas(pesewas: number): string {
  return `GH₵ ${formatAmount(pesewas)}`;
}

/**
 * The same figure without the currency mark, for columns of money where the
 * unit is stated once in the header. Repeating `GH₵` down a column adds width
 * and no meaning, and it breaks the digit alignment `.tabular` exists to keep.
 */
export function formatAmount(pesewas: number): string {
  const negative = pesewas < 0;
  const abs = Math.abs(Math.trunc(pesewas));
  const major = formatCount(Math.floor(abs / 100));
  const minor = String(abs % 100).padStart(2, "0");
  return `${negative ? "−" : ""}${major}.${minor}`;
}

/** The Accra day `n` days before `from`, as `YYYY-MM-DD`. */
export function accraDaysAgo(days: number, from: Date = new Date()): string {
  return accraDay(new Date(from.getTime() - days * 86_400_000));
}

/**
 * An inclusive Accra-day range as one line, e.g. `1 Jul – 31 Jul 2026`. Either
 * end may be empty: a filter is often open at one side, and `From 1 Jul 2026`
 * says that far better than a dash against a blank.
 */
export function formatDayRange(from: string, to: string): string {
  const day = (d: string) => formatAccraDate(`${d}T12:00:00Z`);
  if (from && to) return from === to ? day(from) : `${day(from)} – ${day(to)}`;
  if (from) return `From ${day(from)}`;
  if (to) return `Until ${day(to)}`;
  return "Any date";
}

/**
 * Cedis typed into a box, as the integer pesewas the API wants. `10`, `10.5`
 * and `10.50` all become `1050`; anything that is not a number becomes null,
 * which the caller reports rather than silently sending a zero.
 *
 * Rounded rather than truncated: a third decimal is a typo, and `10.505`
 * meaning GHS 10.50 loses the branch half a pesewa every time it is trusted.
 */
export function parseCedis(input: string): number | null {
  const cleaned = input.replace(/[\s,]/g, "");
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === "" || cleaned === ".") {
    return null;
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** The `10.50` a pesewa figure should prefill a cedis box with. */
export function toCedisInput(pesewas: number): string {
  return (Math.trunc(pesewas) / 100).toFixed(2);
}

/**
 * An instant as the branch reads it off a receipt: `25 Aug 2026, 1:32 pm`.
 * Accra, like every other date in the app — a deposit recorded at 11pm belongs
 * to the day the collector recorded it on, not to whatever the browser thinks.
 */
export function formatAccraDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Accra",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(iso));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  // Assembled by hand: `en-GB` puts the comma and the meridiem where it likes,
  // and the same string has to come off the server and the browser identically.
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod").toLowerCase()}`;
}

/**
 * A money figure compact enough for an axis tick — `18k`, `1.2m`, `640`. Cedis,
 * not pesewas, and the unit is stated once in the axis label rather than on
 * every tick. Only for chart furniture: a figure anyone might key into a
 * receipt is always written out in full by `formatPesewas`.
 */
export function formatCedisCompact(pesewas: number): string {
  const cedis = Math.trunc(pesewas) / 100;
  const abs = Math.abs(cedis);
  const sign = cedis < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${trimZero(abs / 1_000_000)}m`;
  if (abs >= 1_000) return `${sign}${trimZero(abs / 1_000)}k`;
  return `${sign}${Math.round(abs)}`;
}

/** `1.0` reads as noise on an axis; `1` does not. */
function trimZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/** A fraction as a percentage to one decimal — `0.0503` → `5.0%`. */
export function formatPercent(fraction: number, decimals = 1): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}
