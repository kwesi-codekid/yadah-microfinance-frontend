/**
 * The report page's two charts, drawn with Chart.js.
 *
 * Colours come from the CSS custom properties the rest of the app is painted
 * with, re-read whenever the theme flips, so a canvas can't drift from the page
 * around it. Both charts mount client-side only — nothing here renders on the
 * server, where there is no canvas to draw on.
 */

import { useEffect, useState } from "react";
import { useTheme } from "@heroui/react";
import {
  ArcElement,
  CategoryScale,
  Chart,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type TooltipItem,
} from "chart.js";
import { Doughnut, Line } from "react-chartjs-2";
import { compactGhs } from "~/lib/analytics";
import type { LineChart, SplitChart } from "~/lib/report-chart";
import { formatGhs } from "~/lib/money";

Chart.register(
  ArcElement,
  CategoryScale,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
);

const HEADING = '"Sen", ui-sans-serif, system-ui, sans-serif';

interface ChartTheme {
  foreground: string;
  muted: string;
  border: string;
  surface: string;
  /** The seven categorical colours, in `--color-cat-*` order. */
  series: string[];
}

const FALLBACK_SERIES = [
  "#3f9a49",
  "#178175",
  "#1c5f96",
  "#e5a600",
  "#6b8fae",
  "#f5cf3f",
  "#b8232f",
];

/** The wash under the line: the same colour, mostly transparent. */
function tint(colour: string, alpha = 0.12): string {
  const hex = colour.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return colour;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Reads the live theme off the document — null until the browser has it. */
function useChartTheme(): ChartTheme | null {
  const { resolvedTheme } = useTheme("light");
  const [theme, setTheme] = useState<ChartTheme | null>(null);

  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) =>
      css.getPropertyValue(name).trim() || fallback;

    setTheme({
      foreground: read("--foreground", "#161a1f"),
      muted: read("--muted", "#6b7280"),
      border: read("--border", "#e8eaee"),
      surface: read("--surface", "#ffffff"),
      // Green first, then away through teal and navy to the warm end.
      series: [4, 5, 6, 2, 7, 3, 1].map((n, i) =>
        read(`--color-cat-${n}`, FALLBACK_SERIES[i] ?? "#3f9a49"),
      ),
    });
  }, [resolvedTheme]);

  return theme;
}

function tooltipStyle(theme: ChartTheme) {
  return {
    backgroundColor: theme.surface,
    titleColor: theme.foreground,
    bodyColor: theme.muted,
    borderColor: theme.border,
    borderWidth: 2,
    cornerRadius: 8,
    padding: 10,
    displayColors: false,
    titleFont: { family: HEADING, size: 13, weight: 600 as const },
    bodyFont: { family: HEADING, size: 13 },
  };
}

/** A placeholder the size of the chart, so the panel doesn't jump on mount. */
function ChartFrame({
  height,
  children,
}: {
  height: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`relative w-full ${height}`}>{children}</div>
  );
}

export function SeriesLine({
  chart,
  caption,
}: {
  chart: LineChart;
  caption?: string;
}) {
  const theme = useChartTheme();
  const line = theme?.series[0] ?? FALLBACK_SERIES[0]!;

  return (
    <figure className="w-full">
      <ChartFrame height="h-64">
        {theme && (
          <Line
            data={{
              labels: chart.labels,
              datasets: [
                {
                  label: chart.valueLabel,
                  data: chart.values,
                  borderColor: line,
                  backgroundColor: tint(line),
                  fill: true,
                  tension: 0.32,
                  borderWidth: 2,
                  pointRadius: chart.values.length > 20 ? 0 : 3,
                  pointHoverRadius: 5,
                  pointBackgroundColor: line,
                  pointBorderColor: theme.surface,
                  pointBorderWidth: 2,
                },
              ],
            }}
            options={{
              maintainAspectRatio: false,
              animation: { duration: 320 },
              interaction: { mode: "index", intersect: false },
              plugins: {
                legend: { display: false },
                tooltip: {
                  ...tooltipStyle(theme),
                  callbacks: {
                    title: (items: TooltipItem<"line">[]) =>
                      chart.titles[items[0]?.dataIndex ?? 0] ?? "",
                    label: (item: TooltipItem<"line">) =>
                      `${chart.valueLabel} ${formatGhs(item.parsed.y ?? 0)}`,
                    afterLabel: (item: TooltipItem<"line">) =>
                      chart.feet[item.dataIndex] || "",
                  },
                },
              },
              scales: {
                x: {
                  border: { display: false },
                  grid: { display: false },
                  ticks: {
                    color: theme.muted,
                    font: { family: HEADING, size: 12 },
                    autoSkip: true,
                    maxTicksLimit: 8,
                    maxRotation: 0,
                  },
                },
                y: {
                  beginAtZero: true,
                  border: { display: false },
                  grid: { color: theme.border },
                  ticks: {
                    color: theme.muted,
                    font: { family: HEADING, size: 12 },
                    maxTicksLimit: 5,
                    callback: (value: string | number) =>
                      compactGhs(Number(value)),
                  },
                },
              },
            }}
          />
        )}
      </ChartFrame>

      {caption && (
        <figcaption className="mt-3 text-xs text-muted">{caption}</figcaption>
      )}

      {/* The canvas says nothing to a screen reader; this table does. */}
      <div className="sr-only">
        <table>
          <caption>
            {chart.valueLabel} by {chart.labelLabel.toLowerCase()}
          </caption>
          <thead>
            <tr>
              <th scope="col">{chart.labelLabel}</th>
              <th scope="col">{chart.valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {chart.titles.map((title, index) => (
              <tr key={`${title}-${index}`}>
                <th scope="row">{title}</th>
                <td>{formatGhs(chart.values[index] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

export function SplitRing({ chart }: { chart: SplitChart }) {
  const theme = useChartTheme();

  return (
    <figure className="flex flex-wrap items-center gap-5">
      <div className="relative size-36 shrink-0">
        {theme && (
          <Doughnut
            data={{
              labels: chart.labels,
              datasets: [
                {
                  data: chart.values,
                  backgroundColor: chart.values.map(
                    (_, index) =>
                      theme.series[index % theme.series.length] ?? theme.muted,
                  ),
                  borderColor: theme.surface,
                  borderWidth: 2,
                  hoverOffset: 6,
                },
              ],
            }}
            options={{
              cutout: "68%",
              maintainAspectRatio: false,
              animation: { duration: 320 },
              plugins: {
                legend: { display: false },
                tooltip: {
                  ...tooltipStyle(theme),
                  callbacks: {
                    label: (item: TooltipItem<"doughnut">) =>
                      `${formatGhs(item.parsed)} · ${
                        chart.total > 0
                          ? Math.round((item.parsed / chart.total) * 100)
                          : 0
                      }%`,
                  },
                },
              },
            }}
          />
        )}

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
          <span className="truncate font-sen text-sm font-semibold tabular-nums text-foreground">
            {compactGhs(chart.total)}
          </span>
          <span className="text-xs leading-tight text-muted">
            {chart.centreLabel}
          </span>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-2">
        {chart.labels.map((label, index) => (
          <li
            key={`${label}-${index}`}
            className="flex items-baseline justify-between gap-3 text-xs"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-xs"
                style={{
                  backgroundColor:
                    theme?.series[index % theme.series.length] ??
                    FALLBACK_SERIES[index % FALLBACK_SERIES.length],
                }}
              />
              <span className="truncate text-muted">{label}</span>
            </span>
            <span className="shrink-0 font-sen font-semibold tabular-nums text-foreground">
              {formatGhs(chart.values[index] ?? 0)}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
