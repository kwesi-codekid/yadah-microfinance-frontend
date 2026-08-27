/**
 * The dashboard's drawn figures.
 *
 * Everything here follows the same three rules, so the charts read as one
 * system rather than five different opinions:
 *
 *   - **Colour carries meaning, never rank.** Cash in is green and cash out is
 *     red everywhere in this app; the four books wear their `--module-*` hues;
 *     gold is revenue and nothing else. A filter that drops a series never
 *     repaints the ones that are left.
 *   - **Colour is never the only channel.** Every series is named in a legend
 *     and its figures are readable as text — in a label, a caption, or the
 *     table behind the toggle. A screen that has to be seen in colour to be
 *     read is a screen half the counter cannot use.
 *   - **The data is the only loud thing.** 2px lines, bars capped at 24px,
 *     hairline gridlines a single step off the surface, no dashes.
 */

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "~/components/ui/chart";
import {
  formatAccraDate,
  formatAmount,
  formatCedisCompact,
  formatCount,
  formatPesewas,
} from "~/lib/format";
import type { AgingBucket, DayPoint, RevenueMonth } from "~/lib/demo-dashboard";
import { cn } from "~/lib/utils";

/* ---------------------------------------------------------------- legend --- */

/**
 * The identity key for a chart, set above the plot rather than under it. A
 * legend is present whenever there is more than one series — colour matching is
 * never the only way to tell two lines apart.
 */
export function ChartKey({
  items,
}: {
  items: { label: string; className: string }[];
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("size-2 shrink-0 rounded-full", item.className)} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------- cash flow --- */

const CASH_FLOW_CONFIG = {
  cashIn: { label: "In", color: "var(--cash-in)" },
  cashOut: { label: "Out", color: "var(--cash-out)" },
} satisfies ChartConfig;

/**
 * A month of counter activity as two lines.
 *
 * The gap between them *is* the branch's month, so they share one axis — two
 * scales would invent a relationship that is not in the figures. The weekly
 * shape is the thing to read: susu is collected six days a week, Sunday drops
 * to nothing, and the payout and disbursement spikes cluster at month end.
 *
 * The table behind the toggle is not a courtesy. A tooltip is a fine way to
 * enhance a chart and a poor way to be the only route to a number, so every
 * figure the lines draw is also readable as text, in order, in a column.
 */
export function CashFlowChart({ points }: { points: DayPoint[] }) {
  const [view, setView] = useState<"chart" | "table">("chart");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ChartKey
          items={[
            { label: "Cash in", className: "bg-cash-in" },
            { label: "Cash out", className: "bg-cash-out" },
          ]}
        />
        <ViewToggle view={view} onChange={setView} />
      </div>

      {view === "chart" ? (
        <ChartContainer
          config={CASH_FLOW_CONFIG}
          className="aspect-auto h-64 w-full"
          initialDimension={{ width: 640, height: 256 }}
        >
          <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              minTickGap={28}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={44}
              tickMargin={4}
              tickFormatter={(value: number) => formatCedisCompact(value)}
            />
            <ChartTooltip
              cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    const day = payload?.[0]?.payload?.day as string | undefined;
                    return day ? formatAccraDate(`${day}T12:00:00Z`) : "";
                  }}
                  formatter={(value, name) => <TooltipRow name={String(name)} value={Number(value)} />}
                />
              }
            />
            <Line
              dataKey="cashIn"
              name="cashIn"
              type="monotone"
              stroke="var(--color-cashIn)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              isAnimationActive={false}
            />
            <Line
              dataKey="cashOut"
              name="cashOut"
              type="monotone"
              stroke="var(--color-cashOut)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      ) : (
        <CashFlowTable points={points} />
      )}
    </div>
  );
}

/**
 * One tooltip row: the series' colour as a dot beside its name, the figure in
 * cedis. The dot carries identity so the text never has to wear the series
 * colour — a pale hue is unreadable as type on the popover's surface.
 */
function TooltipRow({ name, value }: { name: string; value: number }) {
  const label = name === "cashIn" ? "In" : name === "cashOut" ? "Out" : name;
  return (
    <div className="flex w-full items-center gap-2">
      <span
        className={cn(
          "size-2.5 shrink-0 rounded-[2px]",
          name === "cashIn" ? "bg-cash-in" : "bg-cash-out",
        )}
        aria-hidden
      />
      <span className="flex-1 text-muted-foreground">{label}</span>
      <span className="tabular font-medium text-foreground">{formatPesewas(value)}</span>
    </div>
  );
}

function CashFlowTable({ points }: { points: DayPoint[] }) {
  // Newest first: the question asked of a table of days is almost always about
  // the recent end of it, and scrolling to the bottom to find today is a chore.
  const rows = [...points].reverse();
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
          <tr className="text-left">
            <th className="eyebrow px-3 py-2 font-medium text-muted-foreground">Day</th>
            <th className="eyebrow px-3 py-2 text-right font-medium text-muted-foreground">
              In (GH₵)
            </th>
            <th className="eyebrow px-3 py-2 text-right font-medium text-muted-foreground">
              Out (GH₵)
            </th>
            <th className="eyebrow px-3 py-2 text-right font-medium text-muted-foreground">
              Net (GH₵)
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((point) => (
            <tr key={point.day} className="border-t border-border">
              <td className="px-3 py-1.5 whitespace-nowrap">
                {formatAccraDate(`${point.day}T12:00:00Z`)}
              </td>
              <td className="tabular px-3 py-1.5 text-right">{formatAmount(point.cashIn)}</td>
              <td className="tabular px-3 py-1.5 text-right">{formatAmount(point.cashOut)}</td>
              <td
                className={cn(
                  "tabular px-3 py-1.5 text-right font-medium",
                  point.net > 0 && "text-cash-in",
                  point.net < 0 && "text-cash-out",
                )}
              >
                {point.net > 0 ? "+" : ""}
                {formatAmount(point.net)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: "chart" | "table";
  onChange: (view: "chart" | "table") => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border p-0.5" role="group">
      {(["chart", "table"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={view === option}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            view === option
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- revenue --- */

const REVENUE_CONFIG = {
  total: { label: "Revenue", color: "var(--revenue)" },
} satisfies ChartConfig;

/**
 * Six months of what the branch kept, in gold — the one colour in this app that
 * means earnings.
 *
 * One series, so there is no legend: the heading already says what is plotted,
 * and a box with a single swatch would only restate it. Every bar is labelled
 * instead, which is affordable at six and is what makes the gold legible
 * against a white card, where it is a fill and never a figure.
 *
 * The running month is drawn faint and marked "so far". A short last bar
 * otherwise reads as a collapse rather than as a month with days left in it.
 */
export function RevenueChart({ months }: { months: RevenueMonth[] }) {
  return (
    <ChartContainer
      config={REVENUE_CONFIG}
      className="aspect-auto h-48 w-full"
      initialDimension={{ width: 480, height: 192 }}
    >
      <BarChart data={months} margin={{ top: 20, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          tickMargin={4}
          tickFormatter={(value: number) => formatCedisCompact(value)}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)" }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const month = payload?.[0]?.payload as RevenueMonth | undefined;
                if (!month) return "";
                return month.partial ? `${month.label} — so far` : month.label;
              }}
              formatter={(value) => (
                <div className="flex w-full items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-[2px] bg-revenue" aria-hidden />
                  <span className="flex-1 text-muted-foreground">Revenue</span>
                  <span className="tabular font-medium text-foreground">
                    {formatPesewas(Number(value))}
                  </span>
                </div>
              )}
            />
          }
        />
        <Bar
          dataKey="total"
          name="total"
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          isAnimationActive={false}
          shape={(props) => <RevenueBar {...props} />}
          label={{
            position: "top",
            offset: 8,
            fill: "var(--muted-foreground)",
            fontSize: 11,
            formatter: (value) => (value == null ? "" : formatCedisCompact(Number(value))),
          }}
        />
      </BarChart>
    </ChartContainer>
  );
}

/**
 * Recharts has no per-bar opacity, so the running month's bar is drawn by hand.
 * Square at the baseline, 4px rounded at the data end — the cap is where the
 * figure is, so that is the only corner the eye should have to find.
 */
function RevenueBar(props: {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  payload?: unknown;
}) {
  const x = Number(props.x);
  const y = Number(props.y);
  const width = Number(props.width);
  const height = Number(props.height);
  const partial = Boolean((props.payload as RevenueMonth | undefined)?.partial);
  if (!Number.isFinite(height) || height <= 0) return <g />;

  const r = Math.min(4, width / 2, height);
  const path = `M ${x} ${y + height} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + width - r} ${y} Q ${x + width} ${y} ${x + width} ${y + r} L ${x + width} ${y + height} Z`;

  return (
    <path d={path} fill="var(--revenue)" fillOpacity={partial ? 0.4 : 1} />
  );
}

/* ----------------------------------------------------------- balance beam --- */

/**
 * What the branch holds against what it has lent, on one scale.
 *
 * This is the question underneath every other figure on the page and it has no
 * card of its own anywhere else in the app: a microfinance branch is solvent
 * while customers' deposits cover the book it has written against them. Two
 * bars on a shared scale answer it without arithmetic — the shorter bar is the
 * safer one — and the segments say which product each side is made of.
 *
 * Not a gauge and not a ratio dial: the amounts are the point, and a dial
 * throws them away to show one needle.
 */
export function BalanceBeam({
  held,
  lent,
}: {
  held: { label: string; amount: number; className: string }[];
  lent: { label: string; amount: number; className: string }[];
}) {
  const heldTotal = held.reduce((total, part) => total + part.amount, 0);
  const lentTotal = lent.reduce((total, part) => total + part.amount, 0);
  const peak = Math.max(heldTotal, lentTotal, 1);

  return (
    <div className="space-y-4">
      <BeamRow label="Held for customers" total={heldTotal} peak={peak} parts={held} />
      <BeamRow label="Lent out" total={lentTotal} peak={peak} parts={lent} />
    </div>
  );
}

function BeamRow({
  label,
  total,
  peak,
  parts,
}: {
  label: string;
  total: number;
  peak: number;
  parts: { label: string; amount: number; className: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="tabular font-heading text-lg font-bold tracking-tight">
          {formatPesewas(total)}
        </span>
      </div>

      {/* Segments are separated by a 2px gap in the surface colour rather than
          by a stroke: a border around a fill is ink that is not data. */}
      <div
        className="flex h-3 gap-0.5 overflow-hidden rounded-full"
        style={{ width: `${(total / peak) * 100}%` }}
        aria-hidden
      >
        {parts.map((part) => (
          <div
            key={part.label}
            className={cn("h-full first:rounded-l-full last:rounded-r-full", part.className)}
            style={{ width: `${(part.amount / total) * 100}%` }}
          />
        ))}
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-0.5">
        {parts.map((part) => (
          <div key={part.label} className="flex items-center gap-1.5 text-xs">
            <span className={cn("size-2 shrink-0 rounded-full", part.className)} aria-hidden />
            <dt className="text-muted-foreground">{part.label}</dt>
            <dd className="tabular font-medium">{formatAmount(part.amount)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------ aging --- */

/**
 * Arrears in the four buckets the loan report uses, worst at the bottom.
 *
 * The fills escalate amber to red because here the colour genuinely means
 * severity rather than identity — but every bucket carries its name, its
 * balance and its account count as text, so the ranking survives being printed
 * in grey or read by someone who cannot separate the two hues.
 */
const AGING_FILL: Record<string, string> = {
  "1-30": "bg-warning/55",
  "31-60": "bg-warning",
  "61-90": "bg-danger/70",
  "90+": "bg-danger",
};

export function AgingBars({ buckets }: { buckets: AgingBucket[] }) {
  const peak = Math.max(...buckets.map((b) => b.amount), 1);

  return (
    <ul className="space-y-2.5">
      {buckets.map((bucket) => (
        <li key={bucket.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">{bucket.label}</span>
            <span className="text-muted-foreground">
              <span className="tabular font-medium text-foreground">
                {formatAmount(bucket.amount)}
              </span>{" "}
              · {formatCount(bucket.count)}{" "}
              {bucket.count === 1 ? "account" : "accounts"}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className={cn("h-full rounded-full", AGING_FILL[bucket.key])}
              style={{ width: `${(bucket.amount / peak) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
