import { useId, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import {
  axisMax,
  axisTicks,
  compactGhs,
  type Change,
  type FlowPoint,
} from "~/lib/analytics";
import { formatGhs } from "~/lib/money";

export const TONES = {
  navy: {
    line: "stroke-cat-6",
    area: "fill-cat-6/10",
    fill: "bg-cat-6",
    edge: "border-cat-6",
    wash: "bg-cat-6/15",
    soft: "bg-cat-6/15",
    deep: "border-navy-dark dark:border-cat-6",
  },
  gold: {
    line: "stroke-cat-2",
    area: "fill-cat-2/10",
    fill: "bg-cat-2",
    edge: "border-cat-2",
    wash: "bg-cat-2/20",
    soft: "bg-cat-2/20",
    deep: "border-gold-dark dark:border-cat-2",
  },
  yellow: {
    line: "stroke-cat-3",
    area: "fill-cat-3/10",
    fill: "bg-cat-3",
    edge: "border-cat-3",
    wash: "bg-cat-3/25",
    soft: "bg-cat-3/25",
    deep: "border-gold-dark dark:border-cat-3",
  },
  green: {
    line: "stroke-cat-4",
    area: "fill-cat-4/10",
    fill: "bg-cat-4",
    edge: "border-cat-4",
    wash: "bg-cat-4/20",
    soft: "bg-cat-4/20",
    deep: "border-leaf dark:border-cat-4",
  },
  teal: {
    line: "stroke-cat-5",
    area: "fill-cat-5/10",
    fill: "bg-cat-5",
    edge: "border-cat-5",
    wash: "bg-cat-5/15",
    soft: "bg-cat-5/15",
    deep: "border-teal-dark dark:border-cat-5",
  },
  steel: {
    line: "stroke-cat-7",
    area: "fill-cat-7/10",
    fill: "bg-cat-7",
    edge: "border-cat-7",
    wash: "bg-cat-7/20",
    soft: "bg-cat-7/20",
    deep: "border-navy dark:border-cat-7",
  },
} as const;

export type Tone = keyof typeof TONES;

export function FlowChart({
  points,
  primaryLabel,
  secondaryLabel,
  caption,
}: {
  points: FlowPoint[];
  primaryLabel: string;
  secondaryLabel?: string;
  caption?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();

  const peak = points.reduce(
    (max, p) => Math.max(max, p.collected, secondaryLabel ? p.paidOut : 0),
    0,
  );
  const max = axisMax(peak);
  const ticks = axisTicks(max);
  const span = points.length;

  const height = (value: number) =>
    value <= 0 ? 0 : Math.max(1.5, (value / max) * 100);

  return (
    <figure className="relative w-full">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Key className="bg-cat-4" label={primaryLabel} />
        {secondaryLabel && (
          <Key className="bg-muted/40" label={secondaryLabel} />
        )}
      </div>

      <div className="relative h-56 w-full pr-1 sm:h-64">
        <Gridlines max={max} ticks={ticks} />

        <div
          className="absolute inset-y-0 left-13 right-0"
          onMouseLeave={() => setActive(null)}
        >
          <div className="flex h-full w-full items-end">
            {points.map((point, index) => (
              <Column
                key={point.key}
                point={point}
                isActive={active === index}
                primaryHeight={height(point.collected)}
                secondaryHeight={
                  secondaryLabel ? height(point.paidOut) : undefined
                }
                primaryLabel={primaryLabel}
                secondaryLabel={secondaryLabel}
                onActivate={() => setActive(index)}
                onDismiss={() => setActive(null)}
              />
            ))}
          </div>

          {active !== null && points[active] && (
            <Tooltip
              point={points[active]}
              index={active}
              total={span}
              height={Math.min(
                60,
                Math.max(
                  height(points[active].collected),
                  secondaryLabel ? height(points[active].paidOut) : 0,
                ),
              )}
              primaryLabel={primaryLabel}
              secondaryLabel={secondaryLabel}
            />
          )}
        </div>
      </div>

      <div className="ml-13 flex pr-1">
        {points.map((point, index) => (
          <span
            key={point.key}
            className={`min-w-0 flex-1 truncate text-center text-xs tabular-nums transition-colors ${
              active === index
                ? "font-semibold text-foreground"
                : "text-muted"
            }`}
          >
            {span > 16 && index % 2 === 1 && active !== index ? "" : point.label}
          </span>
        ))}
      </div>

      {caption && (
        <figcaption className="mt-3 text-xs text-muted">{caption}</figcaption>
      )}

      <div className="sr-only">
        <table id={tableId}>
          <caption>
            {primaryLabel}
            {secondaryLabel ? ` and ${secondaryLabel}` : ""} by month
          </caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">{primaryLabel}</th>
              {secondaryLabel && <th scope="col">{secondaryLabel}</th>}
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.key}>
                <th scope="row">{point.title}</th>
                <td>{formatGhs(point.collected)}</td>
                {secondaryLabel && <td>{formatGhs(point.paidOut)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function Column({
  point,
  isActive,
  primaryHeight,
  secondaryHeight,
  primaryLabel,
  secondaryLabel,
  onActivate,
  onDismiss,
}: {
  point: FlowPoint;
  isActive: boolean;
  primaryHeight: number;
  secondaryHeight?: number;
  primaryLabel: string;
  secondaryLabel?: string;
  onActivate: () => void;
  onDismiss: () => void;
}) {
  const label = [
    point.title,
    `${primaryLabel} ${formatGhs(point.collected)}`,
    secondaryLabel
      ? `${secondaryLabel} ${formatGhs(point.paidOut)}`
      : `${point.depositCount} deposits`,
  ].join(", ");

  return (
    <button
      type="button"
      aria-label={label}
      onMouseEnter={onActivate}
      onFocus={onActivate}
      onBlur={onDismiss}
      className="group relative h-full min-w-0 flex-1 cursor-default outline-none"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-x-[7%] bottom-0 rounded-t-md bg-linear-to-t from-transparent via-brand/10 to-brand/30 transition-opacity duration-150 group-focus-visible:opacity-100 ${
          isActive ? "opacity-100" : "opacity-0"
        }`}
        style={{
          height: `calc(${Math.max(primaryHeight, secondaryHeight ?? 0)}% + 8px)`,
        }}
      />

      {secondaryHeight !== undefined && (
        <span
          aria-hidden="true"
          className={`absolute left-1/2 h-1.5 w-[62%] -translate-x-1/2 rounded-full transition-colors ${
            isActive ? "bg-brand/50" : "bg-muted/40"
          }`}
          style={{ bottom: `calc(${secondaryHeight}% - 3px)` }}
        />
      )}
      <span
        aria-hidden="true"
        className={`absolute left-1/2 h-1.5 w-[62%] -translate-x-1/2 rounded-full transition-colors ${
          isActive ? "bg-leaf" : "bg-cat-4"
        }`}
        style={{ bottom: `calc(${primaryHeight}% - 3px)` }}
      />

      {/* A focus ring on the slot, since the button itself is invisible. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-[7%] inset-y-0 rounded-md opacity-0 outline-2 outline-offset-1 outline-accent group-focus-visible:opacity-100"
      />
    </button>
  );
}

function Tooltip({
  point,
  index,
  total,
  height,
  primaryLabel,
  secondaryLabel,
}: {
  point: FlowPoint;
  index: number;
  total: number;
  height: number;
  primaryLabel: string;
  secondaryLabel?: string;
}) {
  return (
    <ChartTooltip
      title={point.title}
      left={((index + 0.5) / total) * 100}
      bottom={height}
      rows={[
        {
          label: primaryLabel,
          value: formatGhs(point.collected),
          className: "border-cat-4",
        },
        secondaryLabel
          ? {
              label: secondaryLabel,
              value: formatGhs(point.paidOut),
              className: "border-muted/40",
            }
          : {
              label: "Deposits",
              value: String(point.depositCount),
              className: "border-muted/40",
            },
      ]}
    />
  );
}

/** One figure inside a chart's hover card. */
interface TooltipRow {
  label: string;
  value: string;
  /** `border-*` for the rule down its left edge — the series' own colour. */
  className: string;
}

function ChartTooltip({
  title,
  rows,
  left,
  bottom,
}: {
  title: string;
  rows: TooltipRow[];
  /** Percent across the plot. */
  left: number;
  /** Percent up the plot — the card sits above this. */
  bottom: number;
}) {
  const shift =
    left < 14
      ? "translate-x-0"
      : left > 86
        ? "-translate-x-full"
        : "-translate-x-1/2";

  return (
    <div
      role="presentation"
      className={`pointer-events-none absolute z-20 mb-3 w-max rounded-lg border-2 border-border bg-surface px-3 py-2 shadow-sm ${shift}`}
      style={{ left: `${left}%`, bottom: `${bottom}%` }}
    >
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <div className="mt-1.5 flex gap-4">
        {rows.map((row) => (
          <div key={row.label} className={`border-l-2 pl-2 ${row.className}`}>
            <p className="text-xs uppercase tracking-wide text-muted">
              {row.label}
            </p>
            <p className="font-sen text-xs font-semibold tabular-nums text-foreground">
              {row.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Gridlines({ max, ticks }: { max: number; ticks: number[] }) {
  return (
    <div aria-hidden="true" className="absolute inset-0">
      {ticks.map((tick) => (
        <div
          key={tick}
          className="absolute inset-x-0 flex items-center gap-2"
          style={{ bottom: `${(tick / max) * 100}%` }}
        >
          <span className="w-11 shrink-0 text-right text-xs tabular-nums text-muted">
            {compactGhs(tick)}
          </span>
          <span
            className={`h-0 flex-1 border-t ${
              tick === 0
                ? "border-solid border-border"
                : "border-dashed border-border"
            }`}
          />
        </div>
      ))}
    </div>
  );
}

/** The labels under a plot, in the same gutter offset as the plot itself. */
function AxisLabels({
  labels,
  active,
}: {
  labels: string[];
  active: number | null;
}) {
  return (
    <div className="ml-13 flex pr-1">
      {labels.map((label, index) => (
        <span
          key={`${label}-${index}`}
          className={`min-w-0 flex-1 truncate text-center text-xs tabular-nums transition-colors ${
            active === index ? "font-semibold text-foreground" : "text-muted"
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function HitSlots({
  labels,
  active,
  describe,
  onActivate,
  onDismiss,
}: {
  labels: string[];
  active: number | null;
  describe: (index: number) => string;
  onActivate: (index: number) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="absolute inset-0 flex">
      {labels.map((label, index) => (
        <button
          key={`${label}-${index}`}
          type="button"
          aria-label={describe(index)}
          onMouseEnter={() => onActivate(index)}
          onFocus={() => onActivate(index)}
          onBlur={onDismiss}
          className="group relative h-full min-w-0 flex-1 cursor-default outline-none"
        >
          <span
            aria-hidden="true"
            className={`absolute inset-0 rounded-md bg-brand/5 transition-opacity group-focus-visible:opacity-100 ${
              active === index ? "opacity-100" : "opacity-0"
            }`}
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-md opacity-0 outline-2 -outline-offset-1 outline-accent group-focus-visible:opacity-100"
          />
        </button>
      ))}
    </div>
  );
}

/** One line on a `TrendChart`. */
export interface TrendSeries {
  key: string;
  label: string;
  /** One figure per label, in integer pesewas. */
  data: number[];
  tone: Tone;
  /** Draw a wash under the line. Off past two series, where they overlap. */
  area?: boolean;
}

export function TrendChart({
  labels,
  titles,
  series,
  caption,
}: {
  labels: string[];
  /** Long form of each label, for the hover card. Defaults to `labels`. */
  titles?: string[];
  series: TrendSeries[];
  caption?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();

  const peak = series.reduce(
    (max, s) => s.data.reduce((m, v) => Math.max(m, v), max),
    0,
  );
  const max = axisMax(peak);
  const ticks = axisTicks(max);
  const span = labels.length;
  const title = (index: number) => titles?.[index] ?? labels[index] ?? "";

  const x = (index: number) => ((index + 0.5) / span) * 100;
  const y = (value: number) => 100 - (value / max) * 100;

  const path = (data: number[]) =>
    data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");

  return (
    <figure className="relative w-full">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        {series.map((s) => (
          <Key key={s.key} className={TONES[s.tone].fill} label={s.label} />
        ))}
      </div>

      <div className="relative h-56 w-full pr-1 sm:h-64">
        <Gridlines max={max} ticks={ticks} />

        <div
          className="absolute inset-y-0 left-13 right-0"
          onMouseLeave={() => setActive(null)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="h-full w-full overflow-visible"
          >
            {series.map((s) => (
              <g key={s.key}>
                {s.area && (
                  <path
                    d={`${path(s.data)} L${x(span - 1)},100 L${x(0)},100 Z`}
                    className={TONES[s.tone].area}
                  />
                )}
                <path
                  d={path(s.data)}
                  fill="none"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  className={TONES[s.tone].line}
                />
              </g>
            ))}
          </svg>

          {active !== null &&
            series.map((s) => (
              <span
                key={s.key}
                aria-hidden="true"
                className={`pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface ${TONES[s.tone].fill}`}
                style={{
                  left: `${x(active)}%`,
                  top: `${y(s.data[active] ?? 0)}%`,
                }}
              />
            ))}

          <HitSlots
            labels={labels}
            active={active}
            describe={(index) =>
              [
                title(index),
                ...series.map(
                  (s) => `${s.label} ${formatGhs(s.data[index] ?? 0)}`,
                ),
              ].join(", ")
            }
            onActivate={setActive}
            onDismiss={() => setActive(null)}
          />

          {active !== null && (
            <ChartTooltip
              title={title(active)}
              left={x(active)}
              bottom={Math.min(
                62,
                series.reduce(
                  (m, s) => Math.max(m, 100 - y(s.data[active] ?? 0)),
                  0,
                ),
              )}
              rows={series.map((s) => ({
                label: s.label,
                value: formatGhs(s.data[active] ?? 0),
                className: TONES[s.tone].edge,
              }))}
            />
          )}
        </div>
      </div>

      <AxisLabels labels={labels} active={active} />

      {caption && (
        <figcaption className="mt-3 text-xs text-muted">{caption}</figcaption>
      )}

      {/* `sr-only` on the wrapper, not the table — see the note in FlowChart. */}
      <div className="sr-only">
        <table id={tableId}>
          <caption>{series.map((s) => s.label).join(" and ")} by period</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              {series.map((s) => (
                <th key={s.key} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, index) => (
              <tr key={`${label}-${index}`}>
                <th scope="row">{title(index)}</th>
                {series.map((s) => (
                  <td key={s.key}>{formatGhs(s.data[index] ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** One band of a `StackedBars` column. */
export interface BarSeries {
  key: string;
  label: string;
  data: number[];
  tone: Tone;
}

export function StackedBars({
  labels,
  titles,
  series,
  target,
  targetLabel = "Expected",
  grouped = false,
  caption,
}: {
  labels: string[];
  titles?: string[];
  series: BarSeries[];
  /** One figure per label, drawn as a rule across the column. */
  target?: number[];
  targetLabel?: string;
  /** Draw the series side by side rather than one on top of the other. */
  grouped?: boolean;
  caption?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();

  const totals = labels.map((_, i) =>
    series.reduce((sum, s) => sum + (s.data[i] ?? 0), 0),
  );
  const tops = grouped
    ? labels.map((_, i) => Math.max(...series.map((s) => s.data[i] ?? 0)))
    : totals;
  const peak = Math.max(...tops, ...(target ?? [0]));
  const max = axisMax(peak);
  const ticks = axisTicks(max);
  const title = (index: number) => titles?.[index] ?? labels[index] ?? "";

  return (
    <figure className="relative w-full">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        {series.map((s) => (
          <Key
            key={s.key}
            className={
              grouped
                ? `border-2 ${TONES[s.tone].deep} ${TONES[s.tone].soft}`
                : TONES[s.tone].fill
            }
            label={s.label}
          />
        ))}
        {target && (
          <span className="flex items-center gap-2 text-xs text-muted">
            <span
              aria-hidden="true"
              className="h-0 w-5 border-t-2 border-dashed border-muted"
            />
            {targetLabel}
          </span>
        )}
      </div>

      <div className="relative h-52 w-full pr-1 sm:h-56">
        <Gridlines max={max} ticks={ticks} />

        <div
          className="absolute inset-y-0 left-13 right-0"
          onMouseLeave={() => setActive(null)}
        >
          <div aria-hidden="true" className="flex h-full w-full items-end">
            {labels.map((label, index) => {
              const total = totals[index] ?? 0;
              const dimmed =
                active === null || active === index ? "opacity-100" : "opacity-45";
              return (
                <div
                  key={`${label}-${index}`}
                  className="relative h-full min-w-0 flex-1"
                >
                  {grouped ? (
                    <div
                      className={`absolute inset-x-[14%] bottom-0 top-0 flex items-end gap-[8%] transition-opacity ${dimmed}`}
                    >
                      {series.map((s) => (
                        <span
                          key={s.key}
                          className={`min-w-0 flex-1 rounded-t-md border-2 border-b-0 ${TONES[s.tone].deep} ${TONES[s.tone].soft}`}
                          style={{
                            height: `${((s.data[index] ?? 0) / max) * 100}%`,
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div
                      className={`absolute inset-x-[22%] bottom-0 flex flex-col-reverse overflow-hidden rounded-t-sm transition-opacity ${dimmed}`}
                      style={{ height: `${(total / max) * 100}%` }}
                    >
                      {series.map((s) => (
                        <span
                          key={s.key}
                          className={TONES[s.tone].fill}
                          style={{
                            height: total > 0
                              ? `${((s.data[index] ?? 0) / total) * 100}%`
                              : "0%",
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {target?.[index] !== undefined && (
                    <span
                      className="absolute inset-x-[14%] h-0 border-t-2 border-dashed border-muted"
                      style={{ bottom: `${(target[index] / max) * 100}%` }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <HitSlots
            labels={labels}
            active={active}
            describe={(index) =>
              [
                title(index),
                ...series.map(
                  (s) => `${s.label} ${formatGhs(s.data[index] ?? 0)}`,
                ),
                target?.[index] !== undefined
                  ? `${targetLabel} ${formatGhs(target[index])}`
                  : "",
              ]
                .filter(Boolean)
                .join(", ")
            }
            onActivate={setActive}
            onDismiss={() => setActive(null)}
          />

          {active !== null && (
            <ChartTooltip
              title={title(active)}
              left={((active + 0.5) / labels.length) * 100}
              bottom={Math.min(62, ((tops[active] ?? 0) / max) * 100)}
              rows={[
                ...series.map((s) => ({
                  label: s.label,
                  value: formatGhs(s.data[active] ?? 0),
                  className: grouped ? TONES[s.tone].deep : TONES[s.tone].edge,
                })),
                ...(target?.[active] !== undefined
                  ? [
                      {
                        label: targetLabel,
                        value: formatGhs(target[active]),
                        className: "border-muted/40",
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </div>
      </div>

      <AxisLabels labels={labels} active={active} />

      {caption && (
        <figcaption className="mt-3 text-xs text-muted">{caption}</figcaption>
      )}

      {/* `sr-only` on the wrapper, not the table — see the note in FlowChart. */}
      <div className="sr-only">
        <table id={tableId}>
          <caption>{series.map((s) => s.label).join(" and ")} by period</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              {series.map((s) => (
                <th key={s.key} scope="col">
                  {s.label}
                </th>
              ))}
              {target && <th scope="col">{targetLabel}</th>}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, index) => (
              <tr key={`${label}-${index}`}>
                <th scope="row">{title(index)}</th>
                {series.map((s) => (
                  <td key={s.key}>{formatGhs(s.data[index] ?? 0)}</td>
                ))}
                {target && <td>{formatGhs(target[index] ?? 0)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** One row of a `BarList`. */
export interface BarItem {
  key: string;
  label: string;
  value: number;
  tone: Tone;
  /** A second line under the label — a count, a share, a time. */
  foot?: string;
}

export function BarList({
  items,
  emptyText = "Nothing to show.",
}: {
  items: BarItem[];
  emptyText?: string;
}) {
  const peak = items.reduce((max, item) => Math.max(max, item.value), 0);

  if (items.length === 0) {
    return <p className="text-xs text-muted">{emptyText}</p>;
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.key}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-xs text-foreground">
              {item.label}
            </span>
            <span className="shrink-0 font-sen text-xs font-semibold tabular-nums text-foreground">
              {formatGhs(item.value)}
            </span>
          </div>
          <div
            aria-hidden="true"
            className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-tertiary"
          >
            <span
              className={`block h-full rounded-full ${TONES[item.tone].fill}`}
              style={{ width: `${peak > 0 ? (item.value / peak) * 100 : 0}%` }}
            />
          </div>
          {item.foot && (
            <p className="mt-1 text-xs tabular-nums text-muted">
              {item.foot}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** One arc of a `Donut`, and one row of the list beside it. */
export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  tone: Tone;
}

export function Donut({
  segments,
  total,
  centreLabel,
}: {
  segments: DonutSegment[];
  total: number;
  /** Under the total in the middle — "under management", "this month". */
  centreLabel: string;
}) {
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0">
        <svg
          viewBox="0 0 42 42"
          aria-hidden="true"
          className="size-28 -rotate-90"
        >
          <circle
            cx="21"
            cy="21"
            r="15.9155"
            fill="none"
            strokeWidth="4"
            className="stroke-surface-tertiary"
          />
          {total > 0 &&
            segments.map((segment) => {
              const share = (segment.value / total) * 100;
              const dash = Math.max(0, share);
              const node = (
                <circle
                  key={segment.key}
                  cx="21"
                  cy="21"
                  r="15.9155"
                  fill="none"
                  strokeWidth="4"
                  strokeDasharray={`${dash} ${100 - dash}`}
                  strokeDashoffset={100 - offset}
                  className={TONES[segment.tone].line}
                />
              );
              offset += share;
              return node;
            })}
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
          <span className="truncate font-sen text-sm font-semibold tabular-nums text-foreground">
            {compactGhs(total)}
          </span>
          <span className="text-xs leading-tight text-muted">
            {centreLabel}
          </span>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-2">
        {segments.map((segment) => (
          <li
            key={segment.key}
            className="flex items-baseline justify-between gap-3 text-xs"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className={`size-2.5 shrink-0 rounded-xs ${TONES[segment.tone].fill}`}
              />
              <span className="truncate text-muted">{segment.label}</span>
            </span>
            <span className="shrink-0 font-sen font-semibold tabular-nums text-foreground">
              {formatGhs(segment.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-2 text-xs text-muted">
      <span aria-hidden="true" className={`h-1.5 w-5 rounded-full ${className}`} />
      {label}
    </span>
  );
}

/** One slice of the book — see `SegmentedBar`. */
export interface Segment {
  label: string;
  value: number;
  /** A `bg-*` class from the `cat-` ramp in [app.css](app/app.css). */
  className: string;
}

export function SegmentedBar({
  segments,
  total,
}: {
  segments: Segment[];
  total: number;
}) {
  return (
    <>
      <div
        aria-hidden="true"
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-tertiary"
      >
        {total > 0 &&
          segments
            .filter((s) => s.value / total >= 0.005)
            .map((segment) => (
              <span
                key={segment.label}
                className={`rounded-full ${segment.className}`}
                style={{ width: `${(segment.value / total) * 100}%` }}
              />
            ))}
      </div>

      <ul className="mt-4 space-y-2.5">
        {segments.map((segment) => (
          <li
            key={segment.label}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className={`size-2.5 shrink-0 rounded-xs ${segment.className}`}
              />
              <span className="truncate text-muted">{segment.label}</span>
            </span>
            <span className="shrink-0 font-sen font-semibold tabular-nums text-foreground">
              {formatGhs(segment.value)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Meter({
  value,
  max,
  className = "bg-brand",
}: {
  value: number;
  max: number;
  className?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 w-full overflow-hidden rounded-full bg-surface-tertiary"
    >
      <span
        className={`block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${className}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function Delta({
  change,
  caption,
  fallback,
}: {
  change: Change | null;
  caption: string;
  fallback?: string;
}) {
  if (!change) {
    return (
      <p className="mt-1 text-xs text-muted">
        {fallback ?? "Nothing to compare against"}
      </p>
    );
  }

  const Icon =
    change.direction === "up"
      ? ArrowUp
      : change.direction === "down"
        ? ArrowDown
        : ArrowRight;

  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-muted">
      <Icon size={12} aria-hidden="true" className="shrink-0" />
      <span className="font-semibold tabular-nums text-foreground">
        {change.percent}%
      </span>
      {caption}
    </p>
  );
}
