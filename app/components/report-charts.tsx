/**
 * The drawn figures on the reports page, in the dashboard's hand: hairline
 * gridlines a step off the card, 2px lines, coral / navy / sky series read
 * from the theme tokens, and a dark pill for the pinned reading so it holds on
 * both themes. Every chart carries its figures as text somewhere — a legend, a
 * label, a caption — so nothing here has to be seen in colour to be read.
 *
 * SVG colours go through `style`, not attributes: attribute values cannot
 * resolve CSS variables, and these must restyle with the theme.
 */

import { EllipsisIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { formatCedisCompact, formatPesewas } from "~/lib/format";
import { cn } from "~/lib/utils";

/* ---------------------------------------------------------------- palette --- */

export const CORAL = "var(--chart-1)";
export const NAVY = "var(--chart-2)";
export const SKY = "var(--chart-3)";
export const SLATE = "var(--chart-4)";
export const MIST = "var(--chart-5)";
export const FG = "var(--color-foreground)";
export const MUTED = "var(--color-muted-foreground)";
export const BORDER = "var(--color-border)";
export const CARD = "var(--color-card)";
/** Pinned-tooltip ink — a dark pill reads correctly on both themes. */
export const TIP = "#0a0a0b";

const SLIDE =
  "transition-transform duration-300 ease-out motion-reduce:transition-none";

/** Cedis for a chart or a tile — `GH₵9.6k`. Never for a figure anyone keys in. */
export const gh = (pesewas: number) => `GH₵${formatCedisCompact(pesewas)}`;

/** A round number at or above `value`, for an axis that ends somewhere sane. */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const n = value / magnitude;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * magnitude;
}

/* ----------------------------------------------------------------- chrome --- */

/** The white card every block sits in, with the dashboard's header row. */
export function ReportCard({
  id,
  title,
  eyebrow,
  detailTo,
  detailLabel = "Open report",
  aside,
  note,
  className,
  children,
}: {
  id?: string;
  title: string;
  /** The module the card belongs to, set small above the title. */
  eyebrow?: string;
  detailTo?: string;
  detailLabel?: string;
  aside?: ReactNode;
  /** A line under the card saying what the figures do and do not cover. */
  note?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "min-w-0 scroll-mt-24 rounded-2xl bg-card p-4 text-card-foreground sm:p-5",
        className,
      )}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          {eyebrow && (
            <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              {eyebrow}
            </p>
          )}
          <h3 className="text-[15px] font-bold tracking-tight">{title}</h3>
        </div>
        {(aside || detailTo) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {aside}
            {detailTo && (
              <>
                <Link
                  to={detailTo}
                  prefetch="intent"
                  className="rounded-full border border-border bg-card px-3 py-1 text-[10.5px] font-medium transition-colors hover:bg-muted/60"
                >
                  {detailLabel}
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`More options for ${title}`}
                    className="flex size-6 items-center justify-center rounded-full border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <EllipsisIcon className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link to={detailTo}>{detailLabel}</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled>
                      Export this section
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        )}
      </header>
      {children}
      {note && (
        <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">
          {note}
        </p>
      )}
    </section>
  );
}

/** A headline tile — the number first, its name under it, a tinted icon square. */
export function StatTile({
  value,
  label,
  icon: Icon,
  tint,
  delta,
  hint,
}: {
  value: string;
  label: string;
  icon: React.ComponentType<{
    className?: string;
    style?: React.CSSProperties;
  }>;
  tint: 1 | 2 | 3 | 4 | 5 | 6;
  /** A reading against the previous period. `up` says which way is good. */
  delta?: { text: string; good: boolean | null };
  hint?: string;
}) {
  return (
    <div className="relative rounded-2xl bg-card p-4">
      <span
        className="absolute top-3.5 right-3.5 rounded-lg p-2"
        style={{ background: `var(--tint-${tint}-bg)` }}
      >
        <Icon className="size-4" style={{ color: `var(--tint-${tint}-fg)` }} />
      </span>
      <p
        key={value}
        className="animate-in fade-in slide-in-from-bottom-1 pr-10 text-[22px] font-bold tracking-tight tabular-nums duration-300 motion-reduce:animate-none"
      >
        {value}
      </p>
      <p className="mt-1 pr-10 text-xs text-muted-foreground">{label}</p>
      {delta ? (
        <p
          className={cn(
            "mt-1 text-[10px] font-medium",
            delta.good === null
              ? "text-muted-foreground"
              : delta.good
                ? "text-success"
                : "text-danger",
          )}
        >
          {delta.text}
        </p>
      ) : (
        hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** A figure inside a card — smaller than a tile, no icon. */
export function Figure({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[10.5px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold tracking-tight tabular-nums">
        {value}
      </p>
      {hint && <p className="text-[10.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The identity key for a chart with more than one series. */
export function Legend({
  items,
}: {
  items: { label: string; color: string }[];
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
      {items.map((item) => (
        <li
          key={item.label}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
        >
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: item.color }}
            aria-hidden
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------- stacked columns --- */

export interface Series {
  key: string;
  label: string;
  color: string;
}

export interface ColumnPoint {
  key: string;
  label: string;
  partial?: boolean;
  values: Record<string, number>;
}

const CX0 = 40;
const CY0 = 14;
const CY1 = 178;

/**
 * Stacked columns, one per bucket, the series in a fixed order bottom-up. The
 * running bucket is drawn faint: a short last column otherwise reads as a
 * collapse rather than a month with days left in it.
 */
export function StackedColumns({
  points,
  series,
  height = 224,
  /** ViewBox width. Wider for a full-width card, so the frame stays shallow. */
  width: frameWidth = 640,
  ariaLabel,
}: {
  points: ColumnPoint[];
  series: Series[];
  height?: number;
  width?: number;
  ariaLabel: string;
}) {
  const n = points.length;
  const [focus, setFocus] = useState(Math.max(0, n - 1));
  if (n === 0) return <EmptyChart>No movement in this range.</EmptyChart>;

  const CX1 = frameWidth - 8;
  const TIP_W = 176;
  const totals = points.map((p) =>
    series.reduce((s, k) => s + (p.values[k.key] ?? 0), 0),
  );
  const scale = niceCeil(Math.max(...totals, 1));
  const slot = (CX1 - CX0) / n;
  const width = Math.max(10, Math.min(n <= 4 ? 56 : 34, slot * 0.52));
  const cx = (i: number) => CX0 + slot * (i + 0.5);
  const y = (v: number) => CY1 - (v / scale) * (CY1 - CY0);

  const at = Math.min(focus, n - 1);
  const tipH = 26 + series.length * 14;
  const flip = cx(at) > (CX0 + CX1) / 2;
  const tipX = flip ? cx(at) - width / 2 - 12 - TIP_W : cx(at) + width / 2 + 12;

  return (
    <svg
      viewBox={`0 0 ${frameWidth} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label={ariaLabel}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line
            x1={CX0}
            x2={CX1}
            y1={y(scale * f)}
            y2={y(scale * f)}
            strokeWidth="1"
            style={{ stroke: BORDER }}
          />
          <text
            x={CX0 - 8}
            y={y(scale * f) + 3}
            textAnchor="end"
            fontSize="9"
            style={{ fill: MUTED }}
          >
            {f === 0 ? "0" : formatCedisCompact(scale * f)}
          </text>
        </g>
      ))}

      {points.map((p, i) => {
        let cursor = 0;
        return (
          <g
            key={p.key}
            opacity={p.partial ? 0.55 : 1}
            style={{ transition: "opacity 200ms" }}
          >
            {series.map((s, j) => {
              const v = p.values[s.key] ?? 0;
              const top = y(cursor + v);
              const bottom = y(cursor);
              cursor += v;
              const h = Math.max(
                0,
                bottom - top - (j < series.length - 1 ? 2 : 0),
              );
              if (h <= 0) return null;
              const isTop = j === series.length - 1;
              return (
                <path
                  key={s.key}
                  d={
                    isTop
                      ? `M ${cx(i) - width / 2} ${top + h} L ${cx(i) - width / 2} ${top + 4} Q ${cx(i) - width / 2} ${top} ${cx(i) - width / 2 + 4} ${top} L ${cx(i) + width / 2 - 4} ${top} Q ${cx(i) + width / 2} ${top} ${cx(i) + width / 2} ${top + 4} L ${cx(i) + width / 2} ${top + h} Z`
                      : `M ${cx(i) - width / 2} ${top} h ${width} v ${h} h ${-width} Z`
                  }
                  style={{
                    fill: s.color,
                    opacity: i === at ? 1 : 0.78,
                    transition: "opacity 200ms",
                  }}
                />
              );
            })}
            <text
              x={cx(i)}
              y={CY1 + 16}
              textAnchor="middle"
              fontSize="9.5"
              style={{ fill: i === at ? FG : MUTED, transition: "fill 200ms" }}
            >
              {p.label}
              {p.partial ? "*" : ""}
            </text>
          </g>
        );
      })}

      {/* the pinned reading */}
      <g
        pointerEvents="none"
        className={SLIDE}
        style={{ transform: `translate(${tipX}px, ${CY0}px)` }}
      >
        <rect x="0" y="0" width={TIP_W} height={tipH} rx="11" fill={TIP} />
        <text x="12" y="16" fontSize="9" fontWeight="700" fill="#fff">
          {points[at].label}
          {points[at].partial ? " — so far" : ""}
          <tspan fill="#B9BDC4" fontWeight="400">
            {"  "}
            {gh(totals[at])}
          </tspan>
        </text>
        {[...series].reverse().map((s, j) => (
          <g key={s.key}>
            <circle cx="15" cy={30 + j * 14} r="3" style={{ fill: s.color }} />
            <text x="23" y={33 + j * 14} fontSize="9" fill="#B9BDC4">
              {s.label}
            </text>
            <text
              x={TIP_W - 12}
              y={33 + j * 14}
              fontSize="9"
              fontWeight="700"
              fill="#fff"
              textAnchor="end"
            >
              {gh(points[at].values[s.key] ?? 0)}
            </text>
          </g>
        ))}
      </g>

      {points.map((p, i) => (
        <rect
          key={`hit${p.key}`}
          x={CX0 + slot * i}
          y={0}
          width={slot}
          height={height}
          fill="transparent"
          onMouseEnter={() => setFocus(i)}
        />
      ))}
    </svg>
  );
}

/* ----------------------------------------------------------- paired columns --- */

/**
 * Two series side by side per bucket — for a book where in and out are the
 * question rather than a composition. Same frame as the stacked chart so the
 * two read as one family.
 */
export function PairedColumns({
  points,
  series,
  height = 200,
  format = gh,
  ariaLabel,
}: {
  points: ColumnPoint[];
  series: [Series, Series];
  height?: number;
  /** How a figure reads in the pill and on the axis. Money unless told otherwise. */
  format?: (value: number) => string;
  ariaLabel: string;
}) {
  const n = points.length;
  const [focus, setFocus] = useState(Math.max(0, n - 1));
  if (n === 0) return <EmptyChart>No movement in this range.</EmptyChart>;

  // Money on the axis is compact without the currency mark — the pill states
  // it; a count is a count.
  const axisTick = (v: number) =>
    format === gh ? formatCedisCompact(v) : format(Math.round(v));
  const X0 = 40;
  const X1 = 312;
  const Y0 = 12;
  const Y1 = height - 40;
  const scale = niceCeil(
    Math.max(
      1,
      ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)),
    ),
  );
  const slot = (X1 - X0) / n;
  const bw = Math.max(5, Math.min(14, slot * 0.28));
  const cx = (i: number) => X0 + slot * (i + 0.5);
  const y = (v: number) => Y1 - (v / scale) * (Y1 - Y0);
  const at = Math.min(focus, n - 1);
  const flip = cx(at) > (X0 + X1) / 2;
  const tipX = flip ? cx(at) - bw - 10 - 128 : cx(at) + bw + 10;

  return (
    <svg
      viewBox={`0 0 320 ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label={ariaLabel}
    >
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line
            x1={X0}
            x2={X1}
            y1={y(scale * f)}
            y2={y(scale * f)}
            strokeWidth="1"
            style={{ stroke: BORDER }}
          />
          <text
            x={X0 - 8}
            y={y(scale * f) + 3}
            textAnchor="end"
            fontSize="8.5"
            style={{ fill: MUTED }}
          >
            {f === 0 ? "0" : axisTick(scale * f)}
          </text>
        </g>
      ))}
      {points.map((p, i) => (
        <g key={p.key} opacity={p.partial ? 0.55 : 1}>
          {series.map((s, j) => {
            const v = p.values[s.key] ?? 0;
            const top = y(v);
            const x = cx(i) + (j === 0 ? -bw - 1 : 1);
            const h = Math.max(0, Y1 - top);
            if (h <= 0) return null;
            return (
              <path
                key={s.key}
                d={`M ${x} ${Y1} L ${x} ${top + 3} Q ${x} ${top} ${x + 3} ${top} L ${x + bw - 3} ${top} Q ${x + bw} ${top} ${x + bw} ${top + 3} L ${x + bw} ${Y1} Z`}
                style={{
                  fill: s.color,
                  opacity: i === at ? 1 : 0.78,
                  transition: "opacity 200ms",
                }}
              />
            );
          })}
          <text
            x={cx(i)}
            y={Y1 + 15}
            textAnchor="middle"
            fontSize="9"
            style={{ fill: i === at ? FG : MUTED, transition: "fill 200ms" }}
          >
            {p.label}
            {p.partial ? "*" : ""}
          </text>
        </g>
      ))}
      <g
        pointerEvents="none"
        className={SLIDE}
        style={{ transform: `translate(${tipX}px, ${Y0}px)` }}
      >
        <rect x="0" y="0" width="128" height="52" rx="10" fill={TIP} />
        <text x="10" y="15" fontSize="8.5" fontWeight="700" fill="#fff">
          {points[at].label}
          {points[at].partial ? " — so far" : ""}
        </text>
        {series.map((s, j) => (
          <g key={s.key}>
            <circle
              cx="13"
              cy={28 + j * 13}
              r="2.5"
              style={{ fill: s.color }}
            />
            <text x="20" y={31 + j * 13} fontSize="8.5" fill="#B9BDC4">
              {s.label}
            </text>
            <text
              x="118"
              y={31 + j * 13}
              fontSize="8.5"
              fontWeight="700"
              fill="#fff"
              textAnchor="end"
            >
              {format(points[at].values[s.key] ?? 0)}
            </text>
          </g>
        ))}
      </g>
      {points.map((p, i) => (
        <rect
          key={`hit${p.key}`}
          x={X0 + slot * i}
          y={0}
          width={slot}
          height={height}
          fill="transparent"
          onMouseEnter={() => setFocus(i)}
        />
      ))}
    </svg>
  );
}

/* ---------------------------------------------------------------- area line --- */

function smoothPath(pts: [number, number][]): string {
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C ${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)}, ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/**
 * One series as a soft area with a reading that slides along it. For a
 * balance, a rate — anything where the level matters more than the bar.
 */
export function AreaLine({
  points,
  color,
  gradientId,
  format,
  baseline = 0,
  height = 150,
  ariaLabel,
}: {
  points: { key: string; label: string; value: number }[];
  color: string;
  gradientId: string;
  format: (value: number) => string;
  /** Where the y axis starts. Zero for money; a floor for a rate. */
  baseline?: number;
  height?: number;
  ariaLabel: string;
}) {
  const n = points.length;
  const [focus, setFocus] = useState(Math.max(0, n - 1));
  if (n < 2)
    return <EmptyChart>Not enough buckets to draw a trend.</EmptyChart>;

  const X0 = 10;
  const X1 = 310;
  const Y0 = 30;
  const Y1 = height - 26;
  const top = Math.max(...points.map((p) => p.value));
  const span = Math.max(top - baseline, 1e-9);
  const x = (i: number) => X0 + (i * (X1 - X0)) / (n - 1);
  const y = (v: number) => Y1 - ((v - baseline) / span) * (Y1 - Y0);
  const pts = points.map((p, i) => [x(i), y(p.value)] as [number, number]);
  const line = smoothPath(pts);
  const area = `${line} L ${X1} ${Y1} L ${X0} ${Y1} Z`;
  const at = Math.min(focus, n - 1);
  const step = (X1 - X0) / (n - 1);
  const anchor = at === 0 ? "start" : at === n - 1 ? "end" : "middle";
  // Twelve month labels will not fit across 300 units; every k-th one will.
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const showLabel = (i: number) =>
    i === at ||
    i === n - 1 ||
    (i % labelEvery === 0 &&
      i < n - 1 - labelEvery / 2 &&
      Math.abs(i - at) >= labelEvery / 2);

  return (
    <svg
      viewBox={`0 0 320 ${height}`}
      className="h-auto w-full overflow-visible"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color }} stopOpacity="0.4" />
          <stop offset="100%" style={{ stopColor: color }} stopOpacity="0.03" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        strokeWidth="2"
        strokeLinejoin="round"
        style={{ stroke: color }}
      />
      {pts.map(([px, py], i) => (
        <circle
          key={points[i].key}
          cx={px}
          cy={py}
          r={i === at ? 4.5 : 3}
          strokeWidth="2"
          style={{ fill: color, stroke: CARD, transition: "r 150ms" }}
        />
      ))}
      <g
        className={SLIDE}
        style={{ transform: `translate(${pts[at][0]}px, 0)` }}
        pointerEvents="none"
      >
        <line
          x1="0"
          y1={Y0 - 4}
          x2="0"
          y2={Y1}
          strokeWidth="1"
          strokeDasharray="3 3"
          style={{ stroke: FG }}
        />
        <text
          x="0"
          y="14"
          textAnchor={anchor}
          fontSize="13"
          fontWeight="700"
          style={{ fill: FG }}
        >
          {format(points[at].value)}
        </text>
      </g>
      {points.map((p, i) =>
        showLabel(i) ? (
          <text
            key={p.key}
            x={x(i)}
            y={height - 8}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            fontSize="9"
            style={{ fill: i === at ? FG : MUTED }}
          >
            {p.label}
          </text>
        ) : null,
      )}
      {pts.map(([px], i) => (
        <rect
          key={`hit${points[i].key}`}
          x={px - step / 2}
          y={0}
          width={step}
          height={height}
          fill="transparent"
          onMouseEnter={() => setFocus(i)}
        />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------ ranked bars --- */

/**
 * Rows ranked by a figure, each a bar against the longest, with an optional
 * second figure drawn inside it — confirmed inside recorded, HP inside total.
 */
export function RankedBars({
  rows,
  colors,
  format = gh,
}: {
  rows: {
    key: string;
    label: string;
    sub?: string;
    value: number;
    /** A part of `value`, drawn as a darker inset. */
    inner?: number;
    trailing: ReactNode;
  }[];
  colors: { outer: string; inner?: string };
  format?: (v: number) => string;
}) {
  const peak = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li
          key={row.key}
          className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-xs"
        >
          <span className="min-w-0">
            <span className="block truncate font-medium">{row.label}</span>
            {row.sub && (
              <span className="block truncate text-[10.5px] text-muted-foreground">
                {row.sub}
              </span>
            )}
          </span>
          <span
            className="relative h-3.5 overflow-hidden rounded-full bg-muted"
            aria-hidden
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${(row.value / peak) * 100}%`,
                background: colors.outer,
              }}
            />
            {row.inner !== undefined && (
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${(Math.min(row.inner, row.value) / peak) * 100}%`,
                  background: colors.inner ?? NAVY,
                }}
              />
            )}
          </span>
          <span className="flex items-baseline gap-2 tabular-nums">
            <span className="font-semibold">{format(row.value)}</span>
            {row.trailing}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- segments --- */

/** One bar split into named parts, each labelled underneath with its share. */
export function SegmentBar({
  parts,
  format,
}: {
  parts: { label: string; value: number; color: string }[];
  format: (v: number) => string;
}) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (total <= 0) return <EmptyChart>Nothing to divide.</EmptyChart>;
  return (
    <div>
      <div
        className="flex h-3.5 gap-0.5 overflow-hidden rounded-full"
        aria-hidden
      >
        {parts.map((p) => (
          <span
            key={p.label}
            style={{
              width: `${(p.value / total) * 100}%`,
              background: p.color,
            }}
          />
        ))}
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-2 text-xs">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: p.color }}
              aria-hidden
            />
            <dt className="flex-1 truncate text-muted-foreground">{p.label}</dt>
            <dd className="tabular-nums">
              <span className="font-semibold">{format(p.value)}</span>{" "}
              <span className="text-muted-foreground">
                {((p.value / total) * 100).toFixed(0)}%
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------ handover grid --- */

export interface GridCell {
  day: string;
  variance: number | null;
}

/**
 * Collectors down, days across, one mark per handover. Exact handovers are a
 * navy dot; a short one fills coral, the deeper the shorter; an over-count is
 * sky. A hollow ring is a day with no collection. The shape of a problem —
 * one collector, one weekday, a whole week — is visible before any figure is.
 */
export function HandoverGrid({
  days,
  rows,
}: {
  days: string[];
  rows: { key: string; label: string; cells: GridCell[]; total: number }[];
}) {
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  const worst = Math.max(
    100,
    ...rows.flatMap((r) => r.cells.map((c) => Math.abs(c.variance ?? 0))),
  );
  const dayLabel = (d: string) => {
    const date = new Date(`${d}T12:00:00Z`);
    return { num: date.getUTCDate(), wd: "SMTWTFS"[date.getUTCDay()] };
  };
  const cell = hover ? rows[hover.row].cells[hover.col] : null;

  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[11px]">
          <thead>
            <tr>
              <th className="pb-2 text-left font-medium text-muted-foreground">
                Collector
              </th>
              {days.map((d) => {
                const { num, wd } = dayLabel(d);
                return (
                  <th
                    key={d}
                    className="pb-2 text-center font-normal text-muted-foreground"
                  >
                    <span className="block text-[9px] uppercase">{wd}</span>
                    <span className="block tabular-nums">{num}</span>
                  </th>
                );
              })}
              <th className="pb-2 text-right font-medium text-muted-foreground">
                Net
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={row.key}>
                <td className="py-1 pr-3 font-medium whitespace-nowrap">
                  {row.label}
                </td>
                {row.cells.map((c, ci) => {
                  const v = c.variance;
                  const depth =
                    v === null ? 0 : Math.min(1, Math.abs(v) / worst);
                  const active = hover?.row === ri && hover?.col === ci;
                  return (
                    <td key={c.day} className="py-1 text-center">
                      <button
                        type="button"
                        aria-label={`${row.label}, ${c.day}: ${v === null ? "no collection" : v === 0 ? "exact" : `${v < 0 ? "short" : "over"} by ${formatPesewas(Math.abs(v))}`}`}
                        onMouseEnter={() => setHover({ row: ri, col: ci })}
                        onFocus={() => setHover({ row: ri, col: ci })}
                        onMouseLeave={() => setHover(null)}
                        onBlur={() => setHover(null)}
                        className={cn(
                          "mx-auto block size-4 rounded-full outline-none transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none",
                          active && "scale-125",
                        )}
                        style={
                          v === null
                            ? { boxShadow: `inset 0 0 0 1.5px ${BORDER}` }
                            : v === 0
                              ? {
                                  background: NAVY,
                                  transform: active
                                    ? "scale(1.25)"
                                    : "scale(0.55)",
                                }
                              : {
                                  background: v < 0 ? CORAL : SKY,
                                  opacity: 0.35 + depth * 0.65,
                                }
                        }
                      />
                    </td>
                  );
                })}
                <td
                  className={cn(
                    "py-1 pl-3 text-right font-semibold whitespace-nowrap tabular-nums",
                    row.total < 0
                      ? "text-cash-out"
                      : row.total > 0
                        ? "text-cash-in"
                        : "text-muted-foreground",
                  )}
                >
                  {row.total === 0
                    ? "exact"
                    : `${row.total < 0 ? "−" : "+"}${formatPesewas(Math.abs(row.total))}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: NAVY }} />{" "}
          Exact
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-full"
            style={{ background: CORAL }}
          />{" "}
          Short — deeper is worse
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: SKY }} />{" "}
          Over
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-full"
            style={{ boxShadow: `inset 0 0 0 1.5px ${BORDER}` }}
          />{" "}
          No collection
        </span>
        <span
          className="ml-auto min-h-4 font-medium text-foreground"
          aria-live="polite"
        >
          {cell && hover
            ? `${rows[hover.row].label} · ${dayLabel(cell.day).num} · ${cell.variance === null ? "no collection" : cell.variance === 0 ? "handed in exactly what was recorded" : `${cell.variance < 0 ? "short" : "over"} by ${formatPesewas(Math.abs(cell.variance))}`}`
            : "Hover a day for its figure."}
        </span>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- weekday --- */

/** Six small columns for a week's rhythm — Monday to Saturday. */
export function WeekdayBars({
  values,
  format = gh,
}: {
  values: number[];
  format?: (v: number) => string;
}) {
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const peak = Math.max(1, ...values);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div
      className="flex h-36 items-end justify-between gap-2"
      onMouseLeave={() => setHover(null)}
    >
      {values.map((v, i) => (
        <div
          key={labels[i]}
          className="flex flex-1 flex-col items-center justify-end gap-1.5 self-stretch"
          onMouseEnter={() => setHover(i)}
        >
          <span
            className={cn(
              "text-[10px] font-semibold tabular-nums transition-opacity",
              hover === i ? "opacity-100" : "opacity-0",
            )}
          >
            {format(v)}
          </span>
          <span
            className="w-full max-w-9 rounded-t-sm transition-opacity"
            style={{
              height: `${(v / peak) * 100}%`,
              background: i === 5 ? SKY : CORAL,
              opacity: hover === null || hover === i ? 1 : 0.5,
            }}
            aria-hidden
          />
          <span className="text-[10px] text-muted-foreground">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- empty --- */

export function EmptyChart({ children }: { children: ReactNode }) {
  return (
    <p className="py-10 text-center text-xs text-muted-foreground">
      {children}
    </p>
  );
}
