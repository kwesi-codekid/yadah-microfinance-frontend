import { accraDay, accraDaysAgo } from "~/lib/format";

/**
 * Reporting periods, named the way somebody asks for them out loud.
 *
 * A report screen is nearly always answering one of a handful of questions —
 * this month, last month, the year so far — and typing two dates to ask one of
 * them is work the screen can do instead. The custom range stays, because the
 * tenth question is always the one nobody anticipated.
 *
 * Everything here is an inclusive Accra day pair, which is what the API takes.
 * Ghana is UTC+0 year-round, so the UTC calendar is the Accra calendar.
 */

export interface DayRange {
  from: string;
  to: string;
}

export interface PeriodPreset {
  id: string;
  label: string;
  range: () => DayRange;
}

/** `YYYY-MM-DD` for the first day of the month `offset` months from this one. */
function monthStart(offset = 0): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return accraDay(d);
}

/** The last day of the month `offset` months from this one. */
function monthEnd(offset = 0): string {
  const now = new Date();
  // Day 0 of the next month is the last day of this one.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0));
  return accraDay(d);
}

export const PERIOD_PRESETS: PeriodPreset[] = [
  { id: "today", label: "Today", range: () => ({ from: accraDay(), to: accraDay() }) },
  {
    id: "last7",
    label: "Last 7 days",
    range: () => ({ from: accraDaysAgo(6), to: accraDay() }),
  },
  {
    id: "last30",
    label: "Last 30 days",
    range: () => ({ from: accraDaysAgo(29), to: accraDay() }),
  },
  {
    id: "thisMonth",
    label: "This month",
    range: () => ({ from: monthStart(), to: accraDay() }),
  },
  {
    id: "lastMonth",
    label: "Last month",
    range: () => ({ from: monthStart(-1), to: monthEnd(-1) }),
  },
  {
    id: "thisYear",
    label: "This year",
    range: () => ({
      from: accraDay(new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1))),
      to: accraDay(),
    }),
  },
];

/** The preset a range matches exactly, so the chosen one can be marked. */
export function matchPreset(from: string, to: string): string | null {
  for (const preset of PERIOD_PRESETS) {
    const r = preset.range();
    if (r.from === from && r.to === to) return preset.id;
  }
  return null;
}

/** How far back a report reaches when nobody says. Matches the API's own default. */
export const DEFAULT_RANGE_DAYS = 30;

/**
 * The period a report is actually showing.
 *
 * A report with no dates is not showing everything — the API quietly answers
 * with the last thirty days — so the screen resolves the default itself and
 * says so. `active` is what separates a chosen range from a defaulted one: it
 * decides whether the filter reads as set, and whether Clear does anything.
 */
export function resolveReportRange(
  from: string,
  to: string,
): { from: string; to: string; active: boolean } {
  const active = Boolean(from || to);
  const resolvedTo = to || accraDay();
  const resolvedFrom = from || accraDaysAgo(DEFAULT_RANGE_DAYS, new Date(`${resolvedTo}T00:00:00.000Z`));
  return { from: resolvedFrom, to: resolvedTo, active };
}

/** A `YYYY-MM-DD` search param, or empty when it is anything else. */
export function readDay(params: URLSearchParams, key: string): string {
  const value = params.get(key) ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

/** The range as query string pairs, for an export link. */
export function rangeQuery(from: string, to: string): string {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return params.toString();
}
