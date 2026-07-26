/**
 * Date formatting, shared so the pages can't render the same timestamp two
 * different ways.
 *
 * Everything here reads the ISO string's own digits rather than going through a
 * `Date`. Two reasons, and both have bitten this kind of app before:
 *
 * - Parsing an ISO *date* to a local `Date` shifts the day backwards for anyone
 *   west of UTC, so a customer registered on the 1st shows as the 31st.
 * - Formatting through the browser's locale and timezone gives one answer on
 *   the server and another after hydration, which React reports as a mismatch
 *   on someone else's machine and never on yours.
 *
 * The API stores UTC and Ghana is UTC+0 all year, so the UTC digits are already
 * the local time for every user of this app.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `2026-07-25T09:14:00Z` → `25 Jul 2026`. */
export function formatDate(iso?: string): string {
  if (!iso) return "";
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return "";
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/** `2026-07-25T09:14:00Z` → `Jul 2026`. For labelling a run of days. */
export function formatMonth(iso?: string): string {
  if (!iso) return "";
  const [year, month] = iso.slice(0, 7).split("-");
  if (!year || !month) return "";
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

/** `2026-07-25T14:05:00Z` → `25 Jul 2026, 2:05 pm`. */
export function formatDateTime(iso?: string): string {
  const date = formatDate(iso);
  if (!date) return "";
  const time = formatTime(iso);
  return time ? `${date}, ${time}` : date;
}

/** Just the clock part — `2:05 pm`. For a column of same-day timestamps. */
export function formatTime(iso?: string): string {
  if (!iso) return "";
  const [hours, minutes] = iso.slice(11, 16).split(":");
  if (hours === undefined || minutes === undefined) return "";
  const h = Number(hours);
  if (!Number.isFinite(h)) return "";
  const suffix = h < 12 ? "am" : "pm";
  // 0 and 12 both read as 12 on a clock face.
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${minutes} ${suffix}`;
}

/** Today in Accra as `YYYY-MM-DD` — the shape `/susu/summary` takes. */
export function accraToday(): string {
  // Ghana keeps UTC+0 with no daylight saving, so the UTC date *is* the Accra
  // calendar day the API reconciles against.
  return new Date().toISOString().slice(0, 10);
}
