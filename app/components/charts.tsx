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

/**
 * The dashboard's small vocabulary of charts.
 *
 * Hand-built rather than pulled from a charting library, for two reasons that
 * both matter more than the hours saved. This app renders on the server and
 * hydrates in the browser, and the usual chart libraries measure the DOM before
 * they can draw — so the first paint is either empty or a different size than
 * the second. And every one of them ships its own colour, type and radius
 * scales, which would put a second design system inside a page built on
 * [app.css](app/app.css)'s tokens.
 *
 * So: percentages in CSS, laid out by flexbox. Nothing is measured, nothing is
 * animated on load, the server and the browser agree by construction, and the
 * marks inherit the same palette as everything else on the page.
 */

/* ------------------------------------------------------------------ *
 * The palette
 * ------------------------------------------------------------------ */

/**
 * One colour of the chart palette, in every form a mark needs it.
 *
 * Every class is written out in full rather than assembled from the slot name.
 * Tailwind generates utilities by scanning the source for literal strings, so
 * `bg-${tone}` or `stroke.replace("stroke-", "border-")` names a class that
 * simply does not exist in the stylesheet — it fails silently, at runtime, and
 * only in the built app. Writing the six out costs nothing and cannot.
 *
 * The slots are the `cat-` ramp from [app.css](app/app.css), which is the logo
 * ring unrolled. `cat-1` is deliberately absent: it is the brand red, and this
 * app spends red on danger and on its one interactive accent.
 *
 * `soft` and `deep` are the outlined pair — a pale fill with a darker rule
 * around it. A bar drawn that way carries its colour at its edge, where two
 * neighbouring bars meet, rather than as a block of ink; `deep` is a genuinely
 * darker shade off the same hue rather than the `cat-` slot itself, because a
 * border in the fill colour on a 15% wash of that fill is not an edge.
 */
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

/* ------------------------------------------------------------------ *
 * The analytics chart
 * ------------------------------------------------------------------ */

/**
 * A run of periods, each drawn as two floating marks rather than two columns.
 *
 * A pair of stacked or side-by-side columns compares heights from a shared
 * baseline, which is the right shape when the question is "how big". The
 * question here is "did more go out than came in *that month*", and a floating
 * mark answers it by position alone: the higher mark is the bigger number, and
 * the gap between them is the month's net.
 *
 * Colour never carries meaning on its own: the marks differ in position and
 * weight, the legend names both series, the tooltip prints both figures, and
 * the whole series is repeated as a table for screen readers.
 */
export function FlowChart({
  points,
  primaryLabel,
  secondaryLabel,
  caption,
}: {
  points: FlowPoint[];
  primaryLabel: string;
  /** Omit to draw a single series — one collector's takings have no matching
      outflow to plot against them; payouts are the office's. */
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

  // A share of the plot height, floored just above the axis so a day with a
  // small-but-real figure doesn't sit *on* the baseline looking like a zero.
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

      {/* `pr-1` keeps the last column's mark off the panel's edge; the left
          gutter is where the axis labels live. */}
      <div className="relative h-56 w-full pr-1 sm:h-64">
        <Gridlines max={max} ticks={ticks} />

        {/* The plot itself, inset past the axis gutter. `onMouseLeave` here
            rather than on each column: moving between two adjacent columns
            would otherwise clear and re-set the active index every time. */}
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

          {/* The tooltip lives outside the columns so it can overflow them,
              and is positioned from the plot's own width — a popover anchored
              inside a 20px-wide column would be clipped by nothing but luck. */}
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

      {/* X labels, in the same gutter offset as the plot above them. Past
          sixteen columns every other label is dropped rather than rotated — a
          diagonal label is harder to read than a missing one, and the tooltip
          carries the period in full anyway. */}
      <div className="ml-13 flex pr-1">
        {points.map((point, index) => (
          <span
            key={point.key}
            className={`min-w-0 flex-1 truncate text-center text-[10px] tabular-nums transition-colors ${
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

      {/* The same series as a table, for anyone who can't read the marks.
          `sr-only` rather than a toggle: it costs nothing and can't drift out
          of date, because it renders from the same array.

          Two things this has to get right, and both were wrong:

          The class goes on a wrapping `div`, never on the `<table>` itself.
          `sr-only` collapses the box to 1px and clips it, but a table treats
          `height` as a *minimum* and grows back to fit its rows — so on the
          table it stayed full size, 216px of it.

          And the `figure` above is `relative` because `sr-only` is
          `position: absolute`. With no positioned ancestor it resolves against
          the initial containing block, which walks straight through the app
          shell's `overflow-hidden` — that clips only descendants it is a
          containing block for, and it isn't positioned — and stretches the
          *document*, giving the page a second scrollbar beside its own. A 1px
          box is enough to do it; the height fix alone was not sufficient. */}
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

/**
 * One period.
 *
 * A `button` because it is genuinely operable — focusing it opens the same
 * tooltip hovering does, which is the only way a keyboard reaches a month's
 * figures. The `aria-label` states them outright, so the tooltip is a
 * convenience rather than the content.
 */
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
      // The figures are in the label rather than in a `aria-describedby`
      // pointing at the table below: describing every one of thirty columns
      // with the whole table would read the whole series out thirty times.
      aria-label={label}
      onMouseEnter={onActivate}
      onFocus={onActivate}
      onBlur={onDismiss}
      className="group relative h-full min-w-0 flex-1 cursor-default outline-none"
    >
      {/* The hover column: a wash rather than a fill, so the marks stay the
          darkest thing in it. It rises to just past the day's top mark rather
          than to the ceiling — the column is there to carry the eye down to
          the axis from the figure being read, and a full-height band would
          instead read as a value of its own. */}
      <span
        aria-hidden="true"
        className={`absolute inset-x-[7%] bottom-0 rounded-t-md bg-linear-to-t from-transparent via-brand/10 to-brand/30 transition-opacity duration-150 group-focus-visible:opacity-100 ${
          isActive ? "opacity-100" : "opacity-0"
        }`}
        style={{
          height: `calc(${Math.max(primaryHeight, secondaryHeight ?? 0)}% + 8px)`,
        }}
      />

      {/* Marks. Positioned by their centre — the `-3px` is half the capsule's
          height — so the *middle* of the mark reads against the gridline
          rather than its bottom edge. */}
      {secondaryHeight !== undefined && (
        <span
          aria-hidden="true"
          className={`absolute left-1/2 h-1.5 w-[62%] -translate-x-1/2 rounded-full transition-colors ${
            isActive ? "bg-brand/50" : "bg-muted/40"
          }`}
          style={{ bottom: `calc(${secondaryHeight}% - 3px)` }}
        />
      )}
      {/* Money in is the ring's green (`cat-4`), deepening to `leaf` under the
          pointer. The active state stays inside the same hue: a mark that
          changed colour on hover would read as a change of series. */}
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

/**
 * The hover card every chart on this page shares.
 *
 * Positioned from the plot's own box in percentages rather than from a measured
 * anchor, for the reason at the top of this file: nothing here may read the DOM
 * to decide where to draw, or the server and the browser disagree.
 */
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
  // Clamped at both ends: a card centred on the first column would hang off
  // the panel, so near an edge it hinges from that edge instead.
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
      <p className="text-[11px] font-semibold text-foreground">{title}</p>
      <div className="mt-1.5 flex gap-4">
        {rows.map((row) => (
          <div key={row.label} className={`border-l-2 pl-2 ${row.className}`}>
            <p className="text-[10px] uppercase tracking-wide text-muted">
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

/**
 * The gridlines and their axis figures, shared by the three plotted charts.
 *
 * Drawn behind everything, dashed, one step lighter than the panel border —
 * they are a reading aid, not structure. The `w-11` gutter they reserve on the
 * left is what `left-13` insets each plot by.
 */
function Gridlines({ max, ticks }: { max: number; ticks: number[] }) {
  return (
    <div aria-hidden="true" className="absolute inset-0">
      {ticks.map((tick) => (
        <div
          key={tick}
          className="absolute inset-x-0 flex items-center gap-2"
          style={{ bottom: `${(tick / max) * 100}%` }}
        >
          <span className="w-11 shrink-0 text-right text-[10px] tabular-nums text-muted">
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
          className={`min-w-0 flex-1 truncate text-center text-[10px] tabular-nums transition-colors ${
            active === index ? "font-semibold text-foreground" : "text-muted"
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

/**
 * The invisible hit targets laid over a plot.
 *
 * One `button` per period, for the same reason `Column` is one: hovering and
 * focusing have to open the same card, and a keyboard has no other way to reach
 * a period's figures. The label states them outright, so the card is a
 * convenience rather than the content.
 */
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

/* ------------------------------------------------------------------ *
 * The trend chart
 * ------------------------------------------------------------------ */

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

/**
 * Two or more runs of figures over the same periods, as lines.
 *
 * Lines rather than the paired marks `FlowChart` draws, because the question
 * this one answers is "which way is it going" over twelve weeks, not "in or out"
 * within one month — and a trend is the one thing a line does better than
 * anything else.
 *
 * The plot is an SVG on a 0–100 grid stretched to the box, which is what lets it
 * render identically on the server and in the browser without measuring
 * anything. `vector-effect="non-scaling-stroke"` is load-bearing: without it the
 * stretch would squash the stroke to a hair at one end of the box and a slab at
 * the other.
 */
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

  // Percent across and percent down — SVG's y axis grows downwards, which is
  // why this is `100 -` and the CSS positions below are not.
  //
  // A point sits in the *middle* of its slot rather than at `i / (span - 1)`,
  // which would put the first point hard against the axis and the last against
  // the panel edge. The labels below are centred in equal slots, so anything
  // else would draw each point a few percent off the period it belongs to.
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

          {/* The dots are CSS rather than SVG circles: a circle on a stretched
              viewBox is an ellipse, and there is no `vector-effect` for that. */}
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

/* ------------------------------------------------------------------ *
 * The stacked bars
 * ------------------------------------------------------------------ */

/** One band of a `StackedBars` column. */
export interface BarSeries {
  key: string;
  label: string;
  data: number[];
  tone: Tone;
}

/**
 * A run of periods, each a column carrying its parts.
 *
 * Stacked by default, because the total is usually the figure being read — a
 * day's takings — and the split is the second question. Pass `grouped` when the
 * comparison between the parts is the point instead: the bars then sit side by
 * side, each measured off the axis, and the two can be read against each other
 * without subtracting one from the other by eye. The cost is that the total is
 * no longer drawn, which is why it isn't the default.
 *
 * An optional `target` draws a rule across each column: where the day should
 * have reached. It is a mark rather than a bar of its own, so a column that
 * clears it reads as covering it rather than as a taller neighbour.
 */
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
  /**
   * How tall each column stands — the sum when stacked, the tallest bar when
   * grouped. It sets the axis, and it is where the tooltip is anchored, so the
   * two cannot disagree about the top of a column.
   */
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
        {/* The swatch wears whatever the bars wear — outlined when they are
            outlined, solid when they are stacked — or the legend names a
            colour that is not on the chart. */}
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
                    /* Side by side, each bar measured off the axis rather than
                       off its neighbour. The gap is a percentage so the pair
                       stays proportionate as the column narrows. */
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

/* ------------------------------------------------------------------ *
 * The ranked list
 * ------------------------------------------------------------------ */

/** One row of a `BarList`. */
export interface BarItem {
  key: string;
  label: string;
  value: number;
  tone: Tone;
  /** A second line under the label — a count, a share, a time. */
  foot?: string;
}

/**
 * A short ranked list where the bar is a comparison and the figure is the fact.
 *
 * Widths are a share of the biggest row rather than of the total: this is used
 * for things that are not parts of one whole (five channels out of any number,
 * the top few collectors), and drawing them as shares of a total would imply
 * the list is complete when it is a top five.
 */
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
            <p className="mt-1 text-[11px] tabular-nums text-muted">
              {item.foot}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * The ring
 * ------------------------------------------------------------------ */

/** One arc of a `Donut`, and one row of the list beside it. */
export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  tone: Tone;
}

/**
 * A total split into its parts, as a ring with the total in the middle.
 *
 * The `r` is not a round number on purpose: at 15.9155 the circumference is
 * almost exactly 100, so a segment's arc length *is* its percentage and the
 * dash arithmetic needs no scale factor. Rotated a quarter turn so the first
 * segment starts at twelve o'clock, where a reader starts.
 */
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
          <span className="text-[10px] leading-tight text-muted">
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

/* ------------------------------------------------------------------ *
 * The small stuff
 * ------------------------------------------------------------------ */

/** One slice of the book — see `SegmentedBar`. */
export interface Segment {
  label: string;
  value: number;
  /** A `bg-*` class from the `cat-` ramp in [app.css](app/app.css). */
  className: string;
}

/**
 * A total split into its parts, as one bar and a list.
 *
 * The bar is for proportion — which part of the book is the big one — and the
 * list under it carries the figures, because nobody reconciles against a
 * rectangle. Parts too small to draw are still listed: a segment under half a
 * percent would render as a sliver indistinguishable from a gap, so it is
 * dropped from the bar and kept in the list where its number is exact.
 */
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

/**
 * Progress towards a figure that is a target rather than a limit — the day's
 * round, a cycle's 31 days.
 *
 * Over-shooting is not an error here (a catch-up payment covers four days at
 * once), so the bar clamps at full and the caption keeps the real numbers.
 */
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

/**
 * Period on period, e.g. "↑ 12% vs yesterday".
 *
 * Green for up and red for down would be wrong on half of these — a fall in
 * payouts is not a bad day — so direction is carried by an arrow and the
 * comparison is spelled out, leaving the reader to decide which way is good.
 */
export function Delta({
  change,
  caption,
  fallback,
}: {
  change: Change | null;
  caption: string;
  /** Shown when there is no basis for a percentage (the previous figure was
      zero). Usually the previous figure itself. */
  fallback?: string;
}) {
  if (!change) {
    return (
      <p className="mt-1 text-[11px] text-muted">
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
    <p className="mt-1 flex items-center gap-1 text-[11px] text-muted">
      <Icon size={12} aria-hidden="true" className="shrink-0" />
      <span className="font-semibold tabular-nums text-foreground">
        {change.percent}%
      </span>
      {caption}
    </p>
  );
}
