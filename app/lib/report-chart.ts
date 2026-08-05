/**
 * Turns a read report into something chartable.
 *
 * The payloads are shapeless — see [report-shape.ts](app/lib/report-shape.ts) —
 * so the columns worth drawing are picked at runtime: a date or a name to run
 * along the axis, and a money column to measure it by. When neither is there,
 * nothing is drawn and the page falls back to the table alone.
 */

import { formatDate } from "~/lib/format";
import {
  isDateString,
  isIdKey,
  isMoneyKey,
  labelOf,
  type Row,
} from "~/lib/report-shape";

/** One line — money over a run of days, or across a ranked handful of names. */
export interface LineChart {
  /** Short form, on the axis. */
  labels: string[];
  /** Long form, in the tooltip. */
  titles: string[];
  /** Integer pesewas, in the same order. */
  values: number[];
  /** A second line per point — a count, a day figure. Empty when none. */
  feet: string[];
  /** The money column being measured — "Total amount". */
  valueLabel: string;
  /** The column running along the axis — "Collector", "Date". */
  labelLabel: string;
  /** True when the axis is time, so the line means progression and not rank. */
  overTime: boolean;
  /** Points that didn't make the cut, so the caption can own up to them. */
  hidden: number;
}

/** Slices of one total — "what the revenue was made of". */
export interface SplitChart {
  labels: string[];
  values: number[];
  total: number;
  /** Under the middle of the ring. */
  centreLabel: string;
}

/** How many names an undated report ranks before the table takes over. */
const MAX_POINTS = 8;

/** Names that read as the thing being counted rather than a fact about it. */
const NAMES = /(name|staff|collector|customer|bucket|label|title|period|month|branch|item)/i;

function values(rows: Row[], key: string): unknown[] {
  return rows.map((row) => row[key]);
}

/** The column that names each row — a plain string, never a date or an id. */
function labelColumn(rows: Row[], columns: string[]): string | null {
  const usable = columns.filter((column) => {
    if (isIdKey(column)) return false;
    const cells = values(rows, column).filter((v) => v !== null && v !== "");
    return (
      cells.length > 0 &&
      cells.every((v) => typeof v === "string" && !isDateString(v))
    );
  });
  return usable.find((column) => NAMES.test(column)) ?? usable[0] ?? null;
}

/** The money column to measure by — the first one carrying anything. */
function moneyColumn(rows: Row[], columns: string[]): string | null {
  return (
    columns.find(
      (column) =>
        isMoneyKey(column) &&
        values(rows, column).some(
          (v) => typeof v === "number" && Number.isFinite(v) && v !== 0,
        ),
    ) ?? null
  );
}

/** The column that dates each row, if one does — the line's own axis. */
function dateColumn(rows: Row[], columns: string[]): string | null {
  return (
    columns.find((column) => {
      const cells = values(rows, column).filter((v) => v !== null && v !== "");
      return cells.length > 1 && cells.every(isDateString);
    }) ?? null
  );
}

/** A count or a day figure to hang under each point. */
function countColumn(rows: Row[], columns: string[]): string | null {
  return (
    columns.find(
      (column) =>
        !isMoneyKey(column) &&
        !isIdKey(column) &&
        values(rows, column).some((v) => typeof v === "number"),
    ) ?? null
  );
}

/** Enough of a name to sit on an axis. */
function shorten(value: string, max = 18): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** `2026-07-25T09:14:00Z` → `25 Jul`. The year lives in the tooltip. */
function axisDate(iso: string): string {
  return formatDate(iso).split(" ").slice(0, 2).join(" ");
}

/** `depositCount` 180 → "180 deposits"; `daysOverdue` 12 → "12 days overdue". */
function foot(key: string, count: number): string {
  const bare = key.replace(/[_ ]?count$/i, "");
  if (bare === key) return `${count} ${labelOf(key).toLowerCase()}`;
  const word = labelOf(bare).toLowerCase();
  // A column called just `count` names nothing to pluralise.
  if (!word) return `×${count}`;
  return `${count} ${word}${word.endsWith("s") ? "" : "s"}`;
}

/**
 * The line the report is worth drawing. A report that only dates its rows runs
 * left to right in date order, every point kept; one that names them ranks the
 * biggest few instead, which is an order rather than a progression. Rows under
 * the same name are one point, added up.
 */
export function plotRows(rows: Row[], columns: string[]): LineChart | null {
  if (rows.length < 2) return null;

  const moneyKey = moneyColumn(rows, columns);
  if (!moneyKey) return null;

  const countKey = countColumn(rows, columns);
  // A name beats a date: "by collector" says more than one loan per due date.
  const named = labelColumn(rows, columns);
  const dateKey = named ? null : dateColumn(rows, columns);
  const nameKey = named ?? dateKey;
  if (!nameKey) return null;

  const merged = new Map<string, { value: number; count: number | null }>();
  for (const row of rows) {
    const at = String(row[nameKey] ?? "");
    if (at === "") continue;
    const count = countKey ? row[countKey] : null;
    const seen = merged.get(at) ?? { value: 0, count: null };
    merged.set(at, {
      value: seen.value + (typeof row[moneyKey] === "number" ? row[moneyKey] : 0),
      count:
        typeof count === "number" ? (seen.count ?? 0) + count : seen.count,
    });
  }

  const points = [...merged]
    .map(([at, totals]) => ({ at, ...totals }))
    .filter((point) => dateKey !== null || point.value > 0);

  if (points.length < 2) return null;

  if (dateKey) points.sort((a, b) => a.at.localeCompare(b.at));
  else points.sort((a, b) => b.value - a.value);

  const drawn = dateKey ? points : points.slice(0, MAX_POINTS);

  return {
    labels: drawn.map((point) =>
      dateKey ? axisDate(point.at) : shorten(point.at),
    ),
    titles: drawn.map((point) =>
      dateKey ? formatDate(point.at) : (point.at || "—"),
    ),
    values: drawn.map((point) => point.value),
    feet: drawn.map((point) =>
      countKey && point.count !== null ? foot(countKey, point.count) : "",
    ),
    valueLabel: labelOf(moneyKey),
    labelLabel: labelOf(nameKey),
    overTime: dateKey !== null,
    hidden: points.length - drawn.length,
  };
}

/**
 * The scalars beside the table, when two or more of them are money. A figure
 * that equals the sum of the others is the grand total, not another slice.
 */
export function splitFigures(
  figures: { key: string; value: unknown }[],
  centreLabel: string,
): SplitChart | null {
  const money = figures.filter(
    (figure) =>
      typeof figure.value === "number" &&
      figure.value > 0 &&
      isMoneyKey(figure.key),
  ) as { key: string; value: number }[];

  if (money.length < 2) return null;

  const sum = money.reduce((total, figure) => total + figure.value, 0);
  const grand = money.find((figure) => figure.value * 2 === sum);
  const parts = grand ? money.filter((figure) => figure !== grand) : money;
  if (parts.length < 2) return null;

  return {
    labels: parts.map((figure) => labelOf(figure.key)),
    values: parts.map((figure) => figure.value),
    total: grand ? grand.value : sum,
    centreLabel,
  };
}

/** The same ring, built from a short table — arrears buckets, mostly. */
export function splitRows(
  rows: Row[],
  columns: string[],
  centreLabel: string,
): SplitChart | null {
  if (rows.length < 2 || rows.length > 6) return null;

  const nameKey = labelColumn(rows, columns);
  const moneyKey = moneyColumn(rows, columns);
  if (!nameKey || !moneyKey) return null;

  const parts = rows
    .map((row) => ({
      label: String(row[nameKey] ?? "—"),
      value: typeof row[moneyKey] === "number" ? (row[moneyKey] as number) : 0,
    }))
    .filter((part) => part.value > 0);

  if (parts.length < 2) return null;

  return {
    labels: parts.map((part) => part.label),
    values: parts.map((part) => part.value),
    total: parts.reduce((sum, part) => sum + part.value, 0),
    centreLabel,
  };
}
