/**
 * The handover dashboard's two figures.
 *
 * Same rules as `dashboard-charts`: colour carries meaning, never rank; every
 * series is named in a key; 2px lines and hairline grid. The volume chart adds
 * one thing the rest of the app does not have — alternating month bands under
 * the plot — because with three lines crossing, the eye needs a way to hold a
 * month still while reading it.
 */

import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import { ChartContainer, ChartTooltip, type ChartConfig } from "~/components/ui/chart";
import { formatCount, formatPercent, formatPesewas } from "~/lib/format";
import { cn } from "~/lib/utils";

/* ------------------------------------------------------------------ volume --- */

export interface MonthPoint {
  /** `YYYY-MM` */
  month: string;
  /** Short axis label — `Jan`. */
  label: string;
  balanced: number;
  gap: number;
  awaiting: number;
}

const VOLUME_CONFIG = {
  balanced: { label: "Balanced", color: "var(--foreground)" },
  gap: { label: "With a gap", color: "var(--danger)" },
  awaiting: { label: "Awaiting count", color: "var(--info)" },
} satisfies ChartConfig;

const VOLUME_SERIES: (keyof typeof VOLUME_CONFIG)[] = ["gap", "balanced", "awaiting"];

export function VolumeKey() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {VOLUME_SERIES.map((k) => (
        <li key={k} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: VOLUME_CONFIG[k].color }}
            aria-hidden
          />
          {VOLUME_CONFIG[k].label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Twelve months of closed days as three lines: the days that balanced, the
 * days with a gap, and the days still waiting for the office to count.
 */
export function VolumeChart({ points }: { points: MonthPoint[] }) {
  return (
    <ChartContainer
      config={VOLUME_CONFIG}
      className="aspect-auto h-64 w-full"
      initialDimension={{ width: 640, height: 256 }}
    >
      <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid
          horizontal={false}
          vertical
          stroke="var(--border)"
          strokeDasharray="0"
          verticalFill={["transparent", "var(--muted)"]}
          fillOpacity={0.55}
        />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          interval={0}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={36}
          tickMargin={4}
          allowDecimals={false}
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => formatCount(v)}
        />
        <ChartTooltip
          cursor={{ stroke: "var(--foreground)", strokeWidth: 1, strokeDasharray: "4 4" }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as MonthPoint;
            return (
              <DarkTip title={monthLong(row.month) ?? String(label)}>
                {VOLUME_SERIES.map((k) => (
                  <TipRow
                    key={k}
                    color={VOLUME_CONFIG[k].color}
                    label={VOLUME_CONFIG[k].label}
                    value={formatCount(row[k])}
                  />
                ))}
              </DarkTip>
            );
          }}
        />
        <Line
          dataKey="gap"
          type="monotone"
          stroke="var(--color-gap)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
          isAnimationActive={false}
        />
        <Line
          dataKey="balanced"
          type="monotone"
          stroke="var(--color-balanced)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
          isAnimationActive={false}
        />
        <Line
          dataKey="awaiting"
          type="monotone"
          stroke="var(--color-awaiting)"
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}

function monthLong(ym: string): string | null {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return null;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/* --------------------------------------------------------------- breakdown --- */

export interface WeekdayPoint {
  /** `mon` … `sun` */
  label: string;
  /** Shortfall on that weekday over the range, in pesewas. */
  short: number;
  /** Share of the range's total shortfall, 0–1. */
  share: number;
  /** Days with a gap on that weekday. */
  days: number;
}

const BREAKDOWN_CONFIG = {
  short: { label: "Short", color: "var(--danger)" },
} satisfies ChartConfig;

/**
 * Where in the week the cash goes missing. One red line across the seven
 * weekdays, filled underneath, each point labelled with its share of the
 * range's total shortfall — the reference's "40% / 30% / 20% / 10%" reading.
 */
export function BreakdownChart({ points }: { points: WeekdayPoint[] }) {
  const labelled = points.filter((p) => p.share > 0);
  return (
    <ChartContainer
      config={BREAKDOWN_CONFIG}
      className="aspect-auto h-64 w-full"
      initialDimension={{ width: 420, height: 256 }}
    >
      <AreaChart data={points} margin={{ top: 40, right: 20, bottom: 0, left: 20 }}>
        <defs>
          <linearGradient id="breakdown-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--danger)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--danger)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid horizontal={false} vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          interval={0}
          tick={{ fontSize: 11 }}
        />
        <YAxis hide domain={[0, "dataMax"]} />
        <ChartTooltip
          cursor={false}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as WeekdayPoint;
            return (
              <DarkTip title={WEEKDAY_LONG[row.label] ?? row.label}>
                <TipRow color="var(--danger)" label="Short" value={formatPesewas(row.short)} />
                <TipRow color="var(--muted-foreground)" label="Days with a gap" value={formatCount(row.days)} />
              </DarkTip>
            );
          }}
        />
        <Area
          dataKey="short"
          type="linear"
          stroke="var(--color-short)"
          strokeWidth={2}
          fill="url(#breakdown-fill)"
          dot={{ r: 4, strokeWidth: 2, stroke: "var(--color-short)", fill: "var(--card)" }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--color-short)", fill: "var(--card)" }}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="share"
            content={(props) => {
              const { x, y, index } = props as { x?: number; y?: number; index?: number };
              const p = index == null ? undefined : points[index];
              if (!p || p.share === 0 || x == null || y == null) return null;
              const big = labelled.length <= 4 || p.share >= 0.15;
              if (!big) return null;
              return (
                <text x={x} y={y - 12} textAnchor="middle" className="fill-foreground">
                  <tspan x={x} className="text-[11px] font-semibold">
                    {formatPercent(p.share, 0)}
                  </tspan>
                </text>
              );
            }}
          />
        </Area>
      </AreaChart>
    </ChartContainer>
  );
}

const WEEKDAY_LONG: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/* ------------------------------------------------------------------ tooltip --- */

/** The reference's dark tooltip: a black pill, one row a series. */
function DarkTip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-40 rounded-lg bg-foreground px-3 py-2 text-background shadow-lg">
      <p className="mb-1 text-[11px] font-medium opacity-70">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function TipRow({ color, label, value, className }: { color: string; label: string; value: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="flex-1 opacity-80">{label}</span>
      <span className="tabular font-semibold">{value}</span>
    </div>
  );
}
