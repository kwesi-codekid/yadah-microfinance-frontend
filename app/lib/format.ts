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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekdayLabel(iso?: string): string {
  if (!iso) return "";
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "";
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
}

const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatDayLine(iso?: string): string {
  if (!iso) return "";
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "";
  const weekday = WEEKDAYS_LONG[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const monthName = MONTHS_LONG[month - 1];
  if (!weekday || !monthName) return "";
  return `${weekday}, ${day} ${monthName}`;
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
  return new Date().toISOString().slice(0, 10);
}
