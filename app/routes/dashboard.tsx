import {
  BanknoteIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  ClipboardListIcon,
  EllipsisIcon,
  IdCardIcon,
  SearchIcon,
  UploadIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { data, Link, useNavigation, useSearchParams } from "react-router";

import { getDashboardPage } from "~/api/dashboard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  accraDay,
  accraDaysAgo,
  formatAccraDateTime,
  formatCedisCompact,
  formatCount,
  formatPesewas,
} from "~/lib/format";
import {
  alertPath,
  matchRate,
  MODULE_VAR,
  TXN_TYPE_LABELS,
  type CashSeries,
  type CashSeriesPoint,
  type CollectionEfficiency,
  type DashboardAlert,
  type SeriesBucket,
  type UnifiedTransaction,
} from "~/lib/reports";
import { getCollectorDashboardPage } from "~/api/collectors";
import { CollectorDashboard } from "~/components/collector-dashboard";
import { isOffice } from "~/lib/auth";
import { useCurrentUser } from "~/lib/use-current-user";
import { requireUser, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/dashboard";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Dashboard · Yadah Dynamic Enterprise" }];
}

/**
 * The office dashboard, drawn from the five `/dashboard` endpoints.
 *
 * Card by card, where each figure comes from:
 *
 *   KPI row                  GET /dashboard/summary → kpis
 *   Collections Performance  GET /dashboard/series → expected vs received
 *   Cash Flow Analytics      GET /dashboard/series → cashIn vs cashOut
 *   Portfolio Mix            GET /dashboard/summary → portfolio
 *   Collection Efficiency    GET /dashboard/efficiency
 *   Alerts                   GET /dashboard/alerts
 *   Collections Reconciliation  GET /dashboard/series → received / expected
 *   Recent Transactions      GET /dashboard/recent-transactions
 *
 * Two things about this data are easy to draw wrongly, and both are stated on
 * the cards themselves rather than left to the reader:
 *
 *   1. `expected` and `received` cover **reconciled collector days only**, so
 *      the newest buckets read as zero until the office confirms those
 *      handovers. That is a pending confirmation, not a collapse in takings.
 *   2. Efficiency measures whether field cash reached the office — susu and
 *      savings only. Loans and hire purchase are collected at the counter and
 *      never appear in it, so it is not a repayment rate.
 */

/* -------------------------------------------------------------- the period --- */

/**
 * The period switch picks a bucket size for `GET /dashboard/series`, and the
 * same span for the efficiency range so the gauge and the charts always answer
 * for the same days. The KPI tiles are deliberately outside it: they state the
 * position *now*, and a tile that changed with the chart period would read as
 * a different business.
 */
const PERIODS = {
  day: { label: "Last 30 days", bucket: "day", span: 29 },
  week: { label: "Last 12 weeks", bucket: "week", span: 83 },
  month: { label: "Last 12 months", bucket: "month", span: 364 },
} satisfies Record<string, { label: string; bucket: SeriesBucket; span: number }>;

type PeriodKey = keyof typeof PERIODS;

const DEFAULT_PERIOD: PeriodKey = "month";

/** How many ledger rows the activity panel asks for. */
const RECENT_LIMIT = 5;

function periodOf(raw: string | null): PeriodKey {
  return raw && raw in PERIODS ? (raw as PeriodKey) : DEFAULT_PERIOD;
}

export async function loader({ request }: Route.LoaderArgs) {
  // The session is the gate; the header above this page carries the identity.
  const user = await requireUser(request);
  // `GET /dashboard/summary` and the branch-wide reads refuse a collector, so
  // a collector gets the same page drawn from their own day and their own
  // handovers — the reads the API does allow them.
  if (user.role === "collector") {
    const { data: page, headers } = await withAuth(request, (token) =>
      getCollectorDashboardPage(token, user.id),
    );
    return data({ user, collector: page }, { headers });
  }

  const period = periodOf(new URL(request.url).searchParams.get("period"));
  const { bucket, span } = PERIODS[period];
  // Computed on the server and passed down, so render and hydration can never
  // disagree about which Accra day it is.
  const to = accraDay();
  const from = accraDaysAgo(span);

  const { data: page, headers } = await withAuth(request, (token) =>
    getDashboardPage(token, { from, to, bucket, recentLimit: RECENT_LIMIT }),
  );

  return data({ user, period, ...page }, { headers });
}

/* ------------------------------------------------------------------ palette --- */
/* Everything reads the theme tokens, so dark mode restyles the whole page:
   the chart slots carry the reference's coral / navy / sky in light mode and
   their night steps in dark. SVG colours go through `style` (not attributes)
   because attribute values cannot resolve CSS variables. */
const CORAL = "var(--chart-1)"; // the hot series — cash confirmed, inflow
const NAVY = "var(--chart-2)"; // the dark series — lifts to periwinkle at night
const SKY = "var(--chart-3)"; // the light series
const ACCENT = "var(--brand-coral)"; // badges and deltas — constant in both themes
const FG = "var(--color-foreground)";
const MUTED = "var(--color-muted-foreground)";
const BORDER = "var(--color-border)";
/** Pinned-tooltip ink — a dark pill reads correctly on both themes. */
const TIP = "#0a0a0b";

/** The moving chart markers all slide with the same easing. */
const SLIDE = "transition-transform duration-300 ease-out motion-reduce:transition-none";

const MONTH_ABBR = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const WEEKDAY_INITIAL = ["s", "m", "t", "w", "t", "f", "s"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ------------------------------------------------------------------ figures --- */

/** Cedis for a chart or a tile — `GH₵9.6k`. Never for a figure anyone keys in. */
const gh = (pesewas: number) => `GH₵${formatCedisCompact(pesewas)}`;

/**
 * A bucket key as an axis tick. Day keys are `2026-08-27`, week keys
 * `2026-W35`, month keys `2026-08` — the API's own encoding, read rather than
 * re-derived, so a bucket is labelled with the day it actually covers.
 */
function tickLabel(key: string, bucket: SeriesBucket): string {
  if (bucket === "week") return `w${key.split("-W")[1] ?? ""}`;
  if (bucket === "month") return MONTH_ABBR[Number(key.slice(5, 7)) - 1] ?? key;
  return key.slice(8);
}

/** The same bucket spelled out, for a tooltip that has room for it. */
function bucketLabel(key: string, bucket: SeriesBucket): string {
  if (bucket === "week") return `Week ${key.split("-W")[1] ?? ""}, ${key.slice(0, 4)}`;
  if (bucket === "month") {
    const month = MONTH_ABBR[Number(key.slice(5, 7)) - 1] ?? "";
    return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${key.slice(0, 4)}`;
  }
  const month = MONTH_ABBR[Number(key.slice(5, 7)) - 1] ?? "";
  return `${Number(key.slice(8))} ${month}`;
}

/** The weekday a day bucket falls on. Accra is UTC, so the key parses exactly. */
function weekdayOf(key: string): number {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}

/** A round number at or above `value`, for an axis that ends somewhere sane. */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const n = value / magnitude;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Tween a number to its target — the gauge counts instead of snapping. */
function useAnimatedNumber(target: number): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  shownRef.current = shown;

  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(target);
      return;
    }
    const start = performance.now();
    const duration = 500;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return shown;
}

/* --------------------------------------------------------------------- page --- */

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  if ("collector" in loaderData) {
    return <CollectorDashboard data={loaderData.collector} />;
  }
  return <OfficeDashboard loaderData={loaderData} />;
}

function OfficeDashboard({
  loaderData,
}: {
  loaderData: Exclude<Route.ComponentProps["loaderData"], { collector: unknown }>;
}) {
  const { period, summary, series, efficiency, alerts, recent } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const [query, setQuery] = useState("");

  // A period change is a navigation, so the charts dim while the API answers
  // rather than sitting on figures that belong to the previous range.
  const switching =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/dashboard";

  // Sliced as well as asked for: `limit` is the API's to honour, and the panel
  // is sized for five rows whatever it sends back.
  const rows = (recent?.items ?? []).slice(0, RECENT_LIMIT);
  const q = query.trim().toLowerCase();
  const visibleTx = q
    ? rows.filter((tx) => searchText(tx).includes(q))
    : rows;

  const k = summary.kpis;
  const p = summary.portfolio;

  const pickPeriod = (key: PeriodKey) => {
    const next = new URLSearchParams(searchParams);
    if (key === DEFAULT_PERIOD) next.delete("period");
    else next.set("period", key);
    setSearchParams(next, { preventScrollReset: true });
  };

  return (
    <div className="min-h-full bg-background px-5 pt-1 pb-5 text-foreground sm:px-8">
      {/* ------------------------------------------------------- KPI row --- */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Stat
          value={formatCount(k.totalCustomers)}
          label="Total Customers"
          icon={UsersIcon}
          tint={1}
          hint="Active on the books"
        />
        <Stat
          value={formatCount(k.activeAccounts)}
          label="Active Accounts"
          icon={IdCardIcon}
          tint={3}
          hint="Susu, savings, loans and HP"
        />
        <Stat
          value={formatCount(k.pendingSusuPayouts.count)}
          label="Pending Susu Payouts"
          icon={ClipboardListIcon}
          tint={2}
          hint={`${gh(k.pendingSusuPayouts.amount)} owed to customers`}
        />
        <Stat
          value={gh(k.amountCollectedToday)}
          label="Amount Collected"
          icon={BanknoteIcon}
          tint={1}
          delta={collectedDelta(k.amountCollectedChangePercent)}
        />
        <Stat
          value={formatCount(k.inArrears)}
          label="In Arrears"
          icon={CircleAlertIcon}
          tint={4}
          hint="Loans and hire purchase"
        />
      </div>

      {/* ----------------------------------------------------- two columns --- */}
      <div
        className={cn(
          "mt-4 grid items-start gap-4 transition-opacity duration-200 xl:grid-cols-[minmax(0,1.66fr)_minmax(0,1fr)]",
          switching && "opacity-60",
        )}
      >
        {/* left column */}
        <div className="space-y-4">
          <Card
            title="Collections Performance"
            detailTo="/reports/collections"
          >
            {series ? (
              <CollectionsChart key={period} series={series} />
            ) : (
              <Unavailable what="the cash series" />
            )}
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Cash Flow Analytics" detailTo="/transactions">
              {series ? (
                <CashFlow key={period} series={series} />
              ) : (
                <Unavailable what="the cash series" />
              )}
            </Card>
            <Card title="Portfolio Mix" detailTo="/reports">
              <PortfolioDonut
                key={period}
                slices={[
                  { label: "Susu held", color: CORAL, amount: p.susu.valueHeld },
                  { label: "Savings", color: NAVY, amount: p.savings.totalBalance },
                  {
                    label: "Credit out",
                    color: SKY,
                    amount: p.loans.outstanding + p.hirePurchase.outstanding,
                  },
                ]}
              />
            </Card>
          </div>
        </div>

        {/* right column */}
        <div className="space-y-4">
          <div className="flex justify-end gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                {PERIODS[period].label}
                <ChevronDownIcon className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(Object.keys(PERIODS) as PeriodKey[]).map((key) => (
                  <DropdownMenuItem key={key} onSelect={() => pickPeriod(key)}>
                    {PERIODS[key].label}
                    {key === period && <CheckIcon className="ml-auto size-3.5" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              onClick={() => exportCsv(visibleTx)}
              disabled={visibleTx.length === 0}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
            >
              Export
              <UploadIcon className="size-3" />
            </button>
          </div>

          <Card
            title="Collection Efficiency"
            centered
            plain
            note={
              efficiency
                ? efficiencyNote(efficiency)
                : undefined
            }
          >
            {efficiency ? (
              <Gauge percent={efficiency.percent} />
            ) : (
              <Unavailable what="collection efficiency" />
            )}
          </Card>

          {/* Not the notifications bell: a notification is one past event sent
              to one person, an alert is a condition that stays true until the
              work is done and reads the same for everyone in the office. The
              card carries no "see all" for that reason — this *is* all of them. */}
          <Card title="Alerts needing action" plain>
            {!alerts ? (
              <Unavailable what="alerts" />
            ) : alerts.alerts.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                Nothing is waiting on anyone. Alerts appear here the moment a
                payout, an arrears case or an unconfirmed handover needs work.
              </p>
            ) : (
              <div className="space-y-5">
                {alerts.alerts.map((alert) => (
                  <Notice key={alert.key} alert={alert} />
                ))}
              </div>
            )}
          </Card>

          <Card
            title="Collections Reconciliation"
            detailTo="/reconciliation"
          >
            {series ? (
              <ReconTrend key={period} series={series} />
            ) : (
              <Unavailable what="the cash series" />
            )}
          </Card>
        </div>
      </div>

      {/* ------------------------------------------------- transactions table --- */}
      <div className="mt-4">
        <Card
          title="Recent Transactions"
          detailTo="/transactions"
          aside={
            <label className="flex w-40 items-center gap-2 rounded-full bg-secondary px-3 py-1.5 focus-within:ring-2 focus-within:ring-ring/40 sm:w-52">
              <SearchIcon className="size-3 shrink-0 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter these rows..."
                className="w-full bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
              />
            </label>
          }
        >
          {recent ? (
            <TransactionsTable rows={visibleTx} query={query} total={rows.length} />
          ) : (
            <Unavailable what="recent transactions" />
          )}
        </Card>
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Live figures from the reporting API, read at{" "}
        {formatAccraDateTime(summary.generatedAt)}. Money is shown in cedis;
        every amount is held as pesewas.
      </p>
    </div>
  );
}

/**
 * The reading under Amount Collected. A null change means yesterday took
 * nothing — there is no percentage change from zero, and printing `0%` would
 * claim a flat day when there was no day to compare against.
 */
function collectedDelta(
  percent: number | null,
): { text: string; up: boolean | null } {
  if (percent === null) {
    return { text: "no cash taken yesterday", up: null };
  }
  const sign = percent >= 0 ? "+" : "−";
  return {
    text: `${sign}${Math.abs(percent).toFixed(1)}% vs yesterday`,
    up: percent >= 0,
  };
}

/** What the gauge is actually saying, in a line under it. */
function efficiencyNote(e: CollectionEfficiency): string {
  if (e.daysReconciled === 0) {
    return "No collector day in this range has been reconciled yet, so there is nothing to measure.";
  }
  const short = e.netVariance < 0;
  const variance =
    e.netVariance === 0
      ? "no net variance"
      : `${short ? "short by" : "over by"} ${formatPesewas(Math.abs(e.netVariance))}`;
  return `${formatPesewas(e.received)} confirmed of ${formatPesewas(e.expected)} recorded across ${formatCount(e.daysReconciled)} reconciled ${e.daysReconciled === 1 ? "day" : "days"} — ${variance}. Susu and savings only.`;
}

/** Everything a row can be filtered on, lowercased once per row. */
function searchText(tx: UnifiedTransaction): string {
  return [
    tx.customerName,
    tx.ref.accountNumber ?? "",
    TXN_TYPE_LABELS[tx.type],
    tx.status,
    tx.detail ?? "",
    tx.recordedByName ?? "",
    tx.recordedByKind,
  ]
    .join(" ")
    .toLowerCase();
}

/** The rows on screen as a file, in cedis, the way a spreadsheet wants them. */
function exportCsv(rows: UnifiedTransaction[]) {
  const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const lines = [
    "Reference,Recorded,Customer,Account,Type,Direction,Amount (GHS),Fee (GHS),Status,Recorded by,Recorded by type",
    ...rows.map((tx) =>
      [
        tx.id,
        formatAccraDateTime(tx.createdAt),
        tx.customerName,
        tx.ref.accountNumber ?? "",
        TXN_TYPE_LABELS[tx.type],
        tx.direction,
        (tx.amount / 100).toFixed(2),
        (tx.fee / 100).toFixed(2),
        tx.status,
        tx.recordedByName ?? "",
        // Appended, never inserted: the office reads these by column.
        tx.recordedByKind,
      ]
        .map(cell)
        .join(","),
    ),
  ];
  const url = URL.createObjectURL(
    new Blob([lines.join("\n")], { type: "text/csv" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `yadah-recent-transactions-${accraDay()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/* --------------------------------------------------------------- chrome bits --- */

/**
 * The white card every block sits in, with the reference header row.
 * `detailTo` makes See Detail and the ⋯ menu real doors into the module.
 *
 * Every one of those doors opens on reports or the ledger, which are the
 * office's. A teller reads the same figures — the summary is theirs — but is
 * not offered a door that would only turn them around at it.
 */
function Card({
  title,
  detailTo,
  centered = false,
  plain = false,
  aside,
  note,
  children,
}: {
  title: string;
  detailTo?: string;
  /** Centered title, no buttons — the gauge card in the reference. */
  centered?: boolean;
  plain?: boolean;
  /** Extra control rendered beside the header buttons — e.g. a row filter. */
  aside?: ReactNode;
  /** A line under the card saying what the figures do and do not cover. */
  note?: string;
  children: ReactNode;
}) {
  // The card's own filter stays whoever is reading; only the way out goes.
  const door = isOffice(useCurrentUser()) ? detailTo : undefined;

  return (
    <section className="rounded-2xl bg-card p-4 text-card-foreground sm:p-5">
      <header
        className={cn(
          "mb-4 flex flex-wrap items-center gap-2",
          centered ? "justify-center" : "justify-between",
        )}
      >
        <h3 className="text-[15px] font-bold tracking-tight">{title}</h3>
        {!plain && (aside || door) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {aside}
            {door && (
              <>
                <Link
                  to={door}
                  className="rounded-full border border-border bg-card px-3 py-1 text-[10.5px] font-medium"
                >
                  See Detail
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
                      <Link to={door}>Open full report</Link>
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

/**
 * What a card shows when its own endpoint failed. Named rather than generic:
 * "could not load" on four cards at once reads as an outage, and knowing which
 * read is missing is the difference between waiting and calling someone.
 */
function Unavailable({ what }: { what: string }) {
  return (
    <p className="py-8 text-center text-xs text-muted-foreground">
      Could not read {what}. The rest of the page is current — reload to try
      this card again.
    </p>
  );
}

function Stat({
  value,
  label,
  icon: Icon,
  tint,
  delta,
  hint,
}: {
  value: string;
  label: string;
  icon: typeof IdCardIcon;
  /** Which avatar-tint family colours the icon square — themed in both modes. */
  tint: 1 | 2 | 3 | 4;
  /** A reading against yesterday. `up: null` is "no comparison to make". */
  delta?: { text: string; up: boolean | null };
  /** A plain line of context, where there is no comparison to draw. */
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
      {/* keyed so a refresh re-enters the number instead of snapping */}
      <p
        key={value}
        className="animate-in fade-in slide-in-from-bottom-1 text-[22px] font-bold tracking-tight duration-300 motion-reduce:animate-none"
      >
        {value}
      </p>
      <p className="mt-1 pr-10 text-xs text-muted-foreground">{label}</p>
      {delta && (
        <p
          key={delta.text}
          className="animate-in fade-in mt-1 text-[10px] font-medium duration-300 motion-reduce:animate-none"
          style={{ color: delta.up ? ACCENT : MUTED }}
        >
          {delta.up === null ? "" : delta.up ? "▲ " : "▼ "}
          {delta.text}
        </p>
      )}
      {!delta && hint && (
        <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** The border colour that carries an alert's severity. */
const SEVERITY_ACCENT: Record<DashboardAlert["severity"], string> = {
  critical: "var(--danger)",
  warning: "var(--warning)",
  info: SKY,
};

function Notice({ alert }: { alert: DashboardAlert }) {
  return (
    <div
      className="border-l-2 pl-3"
      style={{ borderColor: SEVERITY_ACCENT[alert.severity] }}
    >
      <p className="text-[13px] font-semibold">{alert.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {alert.body}
      </p>
      <p className="mt-1 text-[10.5px] font-medium text-muted-foreground">
        {formatCount(alert.count)} {alert.count === 1 ? "case" : "cases"}
        {alert.amount !== null && ` · ${formatPesewas(alert.amount)}`}
      </p>
      <Link
        to={alertPath(alert)}
        className="mt-2.5 inline-block rounded-full bg-primary px-3.5 py-1.5 text-[11px] font-medium text-primary-foreground transition-transform duration-150 hover:scale-[1.03] motion-reduce:transition-none"
      >
        Take Action
      </Link>
    </div>
  );
}

/* ------------------------------------------------------- collections chart --- */

const FX0 = 42;
const FX1 = 632;
const FY0 = 12;
const FY1 = 188;

/**
 * Recorded field cash against confirmed receipts, bucket by bucket.
 *
 * Both series come from reconciled days only, so a run of zeroes at the right
 * edge is the office not having confirmed those handovers yet. The card says
 * so underneath; drawing it any other way would read as collections stopping.
 */
function CollectionsChart({ series }: { series: CashSeries }) {
  const points = series.points;
  const n = points.length;
  // Opens on the last bucket — the one someone came to the page to see.
  const [focus, setFocus] = useState(Math.max(0, n - 1));

  if (n < 2) {
    return (
      <p className="py-12 text-center text-xs text-muted-foreground">
        Not enough reconciled buckets in this range to draw a trend yet.
      </p>
    );
  }

  const received = points.map((p) => p.received);
  const expected = points.map((p) => p.expected);
  const scale = niceCeil(Math.max(...received, ...expected, 1));

  const fx = (i: number) => FX0 + (i * (FX1 - FX0)) / (n - 1);
  const fy = (v: number) => FY1 - (v / scale) * (FY1 - FY0);

  const step = (FX1 - FX0) / (n - 1);
  const barWidth = Math.max(4, Math.min(32, step - 3));
  // 30 daily ticks will not fit; every k-th one will.
  const labelEvery = Math.max(1, Math.ceil(n / 13));

  const at = Math.min(focus, n - 1);
  const px = fx(at);
  const py = fy(received[at]);
  const area = `M ${FX0} ${FY1} ${received.map((v, i) => `L ${fx(i)} ${fy(v)}`).join(" ")} L ${FX1} ${FY1} Z`;

  const previous = at > 0 ? received[at - 1] : 0;
  const delta =
    at > 0 && previous > 0 ? ((received[at] - previous) / previous) * 100 : null;
  const flip = at >= n - Math.ceil(n / 3); // keep the tooltip inside the frame

  return (
    <svg
      viewBox="0 0 640 252"
      className="h-auto w-full"
      role="img"
      aria-label="Field cash recorded against cash confirmed at the office, by bucket"
    >
      <defs>
        <radialGradient id="collect-glow" gradientUnits="userSpaceOnUse" cx={px} cy={py} r={130}>
          <stop offset="0%" stopColor="#F0503A" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#F0503A" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* bucket gridlines */}
      {points.map((p, i) => (
        <line key={p.key} x1={fx(i)} y1={FY0} x2={fx(i)} y2={FY1} strokeWidth="1" style={{ stroke: BORDER }} />
      ))}

      {/* y-axis, in cedis */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <text
          key={f}
          x={FX0 - 12}
          y={fy(scale * f) + 3}
          textAnchor="end"
          fontSize="9"
          style={{ fill: MUTED }}
        >
          {f === 0 ? "0" : formatCedisCompact(scale * f)}
        </text>
      ))}

      {/* glow under the coral line, concentrated around the pinned point */}
      <path d={area} fill="url(#collect-glow)" />

      <polyline
        points={expected.map((v, i) => `${fx(i)},${fy(v)}`).join(" ")}
        fill="none"
        strokeWidth="2"
        strokeLinejoin="round"
        style={{ stroke: NAVY }}
      />
      <polyline
        points={received.map((v, i) => `${fx(i)},${fy(v)}`).join(" ")}
        fill="none"
        strokeWidth="2"
        strokeLinejoin="round"
        style={{ stroke: CORAL }}
      />

      {/* the pinned reading — the whole group slides to the hovered bucket */}
      <g className={SLIDE} style={{ transform: `translate(${px}px, ${py}px)` }}>
        <line x1="0" y1="0" x2="0" y2={FY1 - py} strokeWidth="1" strokeDasharray="3 3" style={{ stroke: FG }} />
        <circle cx="0" cy="0" r="4.5" strokeWidth="2" style={{ fill: CORAL, stroke: "var(--color-card)" }} />
      </g>

      <g pointerEvents="none" className={SLIDE} style={{ transform: `translate(${px}px, 0)` }}>
        <rect x={flip ? -166 : 14} y={FY0 + 6} width="152" height="60" rx="11" fill={TIP} />
        <text x={(flip ? -166 : 14) + 12} y={FY0 + 22} fontSize="9" fontWeight="700" fill="#fff">
          {bucketLabel(points[at].key, series.bucket)}
        </text>
        <circle cx={(flip ? -166 : 14) + 15} cy={FY0 + 35} r="3" style={{ fill: CORAL }} />
        <text x={(flip ? -166 : 14) + 23} y={FY0 + 38} fontSize="9" fill="#B9BDC4">
          Confirmed <tspan fill="#fff" fontWeight="700">{gh(received[at])}</tspan>
        </text>
        <circle cx={(flip ? -166 : 14) + 15} cy={FY0 + 51} r="3" style={{ fill: NAVY }} />
        <text x={(flip ? -166 : 14) + 23} y={FY0 + 54} fontSize="9" fill="#B9BDC4">
          Recorded <tspan fill="#fff" fontWeight="700">{gh(expected[at])}</tspan>
        </text>
      </g>

      {delta !== null && (
        <g pointerEvents="none" className={SLIDE} style={{ transform: `translate(${px}px, 0)` }}>
          <rect x="-22" y="148" width="44" height="17" rx="8.5" style={{ fill: ACCENT }} />
          <text x="0" y="160" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#fff">
            {delta >= 0 ? "+" : "−"}
            {Math.abs(delta).toFixed(1)}%
          </text>
        </g>
      )}

      {/* the segment bar and bucket labels from the reference */}
      {points.map((p, i) => (
        <g key={`tick${p.key}`}>
          <rect
            x={fx(i) - barWidth / 2}
            y={202}
            width={barWidth}
            height="5"
            rx="2.5"
            style={{ fill: i === at ? MUTED : BORDER, transition: "fill 200ms" }}
          />
          {(i % labelEvery === 0 || i === at) && (
            <text
              x={fx(i)}
              y={230}
              textAnchor="middle"
              fontSize="9.5"
              style={{ fill: i === at ? FG : MUTED, transition: "fill 200ms" }}
            >
              {tickLabel(p.key, series.bucket)}
            </text>
          )}
        </g>
      ))}

      {/* invisible hover strips, one per bucket */}
      {points.map((p, i) => (
        <rect
          key={`hit${p.key}`}
          x={fx(i) - step / 2}
          y={0}
          width={step}
          height={240}
          fill="transparent"
          onMouseEnter={() => setFocus(i)}
        />
      ))}
    </svg>
  );
}

/* ---------------------------------------------------------------- cash flow --- */

/** How tall a full column of dots gets. Beyond this the card outgrows its half. */
const DOT_MAX = 6;

/**
 * The last seven buckets as stacked dots: cash out below, cash in above.
 *
 * Dots are a proportion of the tallest bucket on screen, not an absolute scale
 * — the exact figures are in the tooltip and the totals above it, and a
 * hovering reader wants the shape first.
 */
function CashFlow({ series }: { series: CashSeries }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const columns = series.points.slice(-7);

  if (columns.length === 0) {
    return (
      <p className="py-10 text-center text-xs text-muted-foreground">
        No cash moved in this range.
      </p>
    );
  }

  const peak = Math.max(
    1,
    ...columns.map((p) => Math.max(p.cashIn.amount, p.cashOut.amount)),
  );
  const dots = (amount: number) =>
    amount <= 0 ? 0 : Math.max(1, Math.round((amount / peak) * DOT_MAX));

  const label = (point: CashSeriesPoint, short: boolean) => {
    if (series.bucket === "day") {
      const day = weekdayOf(point.key);
      return short ? WEEKDAY_INITIAL[day] : WEEKDAY_NAMES[day];
    }
    return short
      ? tickLabel(point.key, series.bucket)
      : bucketLabel(point.key, series.bucket);
  };

  return (
    <div className="animate-in fade-in duration-300 motion-reduce:animate-none">
      <div className="mb-4 flex flex-col items-end gap-1 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: CORAL }} />
          <span className="text-muted-foreground">Inflow</span>
          <span className="font-bold">{gh(series.totals.cashIn.amount)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: NAVY }} />
          <span className="text-muted-foreground">Outflow</span>
          <span className="font-bold">{gh(series.totals.cashOut.amount)}</span>
        </span>
      </div>

      <div
        className="flex items-start justify-between px-1"
        onMouseLeave={() => setHovered(null)}
      >
        {columns.map((point, i) => (
          <div
            key={point.key}
            className={cn(
              "relative flex flex-col items-center gap-1.25 transition-opacity duration-200",
              hovered !== null && hovered !== i && "opacity-40",
            )}
            onMouseEnter={() => setHovered(i)}
          >
            {hovered === i && (
              <span
                className="animate-in fade-in zoom-in-95 absolute -top-8 left-1/2 z-10 -translate-x-1/2 rounded-full px-2.5 py-1 text-[9px] font-medium whitespace-nowrap text-white duration-150 motion-reduce:animate-none"
                style={{ background: TIP }}
              >
                {label(point, false)} · In {gh(point.cashIn.amount)} · Out{" "}
                {gh(point.cashOut.amount)}
              </span>
            )}
            {Array.from({ length: dots(point.cashOut.amount) }, (_, j) => (
              <span
                key={`n${j}`}
                className="h-2.75 w-7 rounded-full"
                style={{ background: NAVY, opacity: 1 - j * 0.07 }}
              />
            ))}
            {Array.from({ length: dots(point.cashIn.amount) }, (_, j) => (
              <span
                key={`c${j}`}
                className="h-2.75 w-7 rounded-full"
                style={{ background: CORAL, opacity: Math.max(0.14, 0.95 - j * 0.13) }}
              />
            ))}
            {dots(point.cashIn.amount) === 0 && dots(point.cashOut.amount) === 0 && (
              <span
                className="h-0.5 w-7 rounded-full"
                style={{ background: BORDER }}
                aria-hidden
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex justify-between px-1">
        {columns.map((point) => (
          <span
            key={point.key}
            className="w-7 text-center text-[10px] text-muted-foreground"
          >
            {label(point, true)}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- donut --- */

/** Point on a circle, angle in degrees clockwise from 12 o'clock. */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

interface Slice {
  label: string;
  color: string;
  /** Pesewas. */
  amount: number;
}

function PortfolioDonut({ slices }: { slices: Slice[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const cx = 100;
  const cy = 96;
  const r = 66;

  const book = slices.reduce((sum, s) => sum + s.amount, 0);
  if (book <= 0) {
    return (
      <p className="py-12 text-center text-xs text-muted-foreground">
        The branch is holding nothing yet — no susu, savings or credit balances.
      </p>
    );
  }

  const share = (amount: number) => (amount / book) * 100;

  // The three books share the 270° that is not gap, in proportion. Drawn
  // credit-first from the top, like the reference. Endpoint gaps are wide
  // because the round caps grow each arc back out; what survives on screen is
  // a slim slot.
  const GAP = 30;
  const spans = slices.map((s) => (270 * s.amount) / book);
  // display order around the ring: sky (credit), navy (savings), coral (susu)
  const order = [2, 1, 0];
  let cursor = -spans[2] / 2;
  const arcs = order.map((idx) => {
    const from = cursor;
    const to = cursor + spans[idx];
    cursor = to + GAP;
    return { idx, from, to };
  });

  const ticks = Array.from({ length: 72 }, (_, i) => {
    const [x1, y1] = polar(cx, cy, 34, i * 5);
    const [x2, y2] = polar(cx, cy, 40, i * 5);
    return [x1, y1, x2, y2] as const;
  });

  return (
    <div className="animate-in fade-in duration-300 motion-reduce:animate-none">
      <svg
        viewBox="0 0 200 196"
        className="mx-auto h-auto w-full max-w-56"
        role="img"
        aria-label={`Portfolio mix — ${gh(book)} across susu, savings and credit`}
      >
        {ticks.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="1.2" style={{ stroke: BORDER }} />
        ))}
        {arcs.map(({ idx, from, to }) =>
          to > from ? (
            <path
              key={idx}
              d={arcPath(cx, cy, r, from, to)}
              fill="none"
              strokeWidth={hovered === idx ? 28 : 24}
              strokeLinecap="round"
              className="cursor-pointer"
              style={{ stroke: slices[idx].color, transition: "stroke-width 150ms" }}
              onMouseEnter={() => setHovered(idx)}
              onMouseLeave={() => setHovered(null)}
            />
          ) : null,
        )}
        {hovered === null ? (
          <>
            <text x={cx} y={cy + 2} textAnchor="middle" fontSize="17" fontWeight="700" style={{ fill: FG }} pointerEvents="none">
              {gh(book)}
            </text>
            <text x={cx} y={cy + 16} textAnchor="middle" fontSize="8.5" style={{ fill: MUTED }} pointerEvents="none">
              total book
            </text>
          </>
        ) : (
          <>
            <text x={cx} y={cy - 2} textAnchor="middle" fontSize="24" fontWeight="700" style={{ fill: FG }} pointerEvents="none">
              {share(slices[hovered].amount).toFixed(0)}%
            </text>
            <text x={cx} y={cy + 13} textAnchor="middle" fontSize="9" style={{ fill: MUTED }} pointerEvents="none">
              {slices[hovered].label}
            </text>
            <text x={cx} y={cy + 26} textAnchor="middle" fontSize="9.5" fontWeight="700" style={{ fill: FG }} pointerEvents="none">
              {gh(slices[hovered].amount)}
            </text>
          </>
        )}
      </svg>

      <div className="mt-4 flex justify-around">
        {slices.map((slice, i) => (
          <button
            key={slice.label}
            className="cursor-pointer text-center"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(i)}
            onBlur={() => setHovered(null)}
          >
            <span className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: slice.color }} />
              {slice.label}
            </span>
            <span className="mt-1 block text-base font-bold">
              {share(slice.amount).toFixed(0)}%
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- gauge --- */

function lerpColor(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(",")})`;
}

function Gauge({ percent }: { percent: number | null }) {
  // Null means nothing was due in the range. The dial still draws — an empty
  // card reads as a broken widget — but the figure is a dash, because there is
  // no percentage of zero.
  const shown = useAnimatedNumber(percent === null ? 0 : Math.round(percent));
  const cx = 140;
  const cy = 142;
  const count = 64;
  const ticks = Array.from({ length: count }, (_, i) => {
    const deg = 180 - (i * 180) / (count - 1); // sweep left → right
    const rad = (deg * Math.PI) / 180;
    // A deterministic "waveform" — random lengths would tear hydration apart.
    const len = 12 + 20 * (0.5 + 0.5 * Math.sin(i * 1.7)) + 6 * (0.5 + 0.5 * Math.sin(i * 0.37));
    const r1 = 88;
    const r2 = 96 + len;
    return {
      x1: cx + r1 * Math.cos(rad),
      y1: cy - r1 * Math.sin(rad),
      x2: cx + r2 * Math.cos(rad),
      y2: cy - r2 * Math.sin(rad),
      // The gradient runs between the reference's saturated ends — bright
      // enough to hold on the dark canvas too.
      color: lerpColor("#EE3D22", "#74A5D7", i / (count - 1)),
    };
  });

  return (
    <svg
      viewBox="0 0 280 152"
      className="mx-auto h-auto w-full max-w-80"
      role="img"
      aria-label={
        percent === null
          ? "Collection efficiency: nothing was due in this range"
          : `Collection efficiency: ${Math.round(percent)}%`
      }
    >
      {ticks.map((tick, i) => (
        <line
          key={i}
          x1={tick.x1}
          y1={tick.y1}
          x2={tick.x2}
          y2={tick.y2}
          stroke={percent === null ? BORDER : tick.color}
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}
      {/* the three reference markers: ends pointing in, apex pointing down */}
      <polygon points="2,136 2,148 12,142" style={{ fill: FG }} />
      <polygon points="278,136 278,148 268,142" style={{ fill: FG }} />
      <polygon points="134,2 146,2 140,11" style={{ fill: FG }} />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="34" fontWeight="700" style={{ fill: FG }}>
        {percent === null ? "—" : `${shown}%`}
      </text>
    </svg>
  );
}

/* ---------------------------------------------------------------- recon wave --- */

function smoothPath(pts: [number, number][]): string {
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

const RX0 = 8;
const RX1 = 312;
const RY_BASE = 118;
const RY_SPAN = 82; // 100% sits at y = 36

/**
 * How much of each bucket's recorded field cash reached the office.
 *
 * Buckets with nothing recorded are dropped rather than plotted at zero: a
 * quiet week is not a week when collectors handed in nothing, and a zero there
 * would drag the trend down for a reason that has no meaning.
 */
function ReconTrend({ series }: { series: CashSeries }) {
  const rated = series.points
    .map((point) => ({ key: point.key, rate: matchRate(point) }))
    .filter((p): p is { key: string; rate: number } => p.rate !== null);

  const [focus, setFocus] = useState(Math.max(0, rated.length - 1));

  if (rated.length < 2) {
    return (
      <p className="py-10 text-center text-xs text-muted-foreground">
        Fewer than two buckets in this range have a reconciled handover to
        compare, so there is no trend to draw yet.
      </p>
    );
  }

  const n = rated.length;
  const rx = (i: number) => RX0 + (i * (RX1 - RX0)) / (n - 1);
  // Rates above 100 happen — a collector can hand in more than the system
  // recorded. The line is clamped so it stays in frame; the figure is not.
  const ry = (rate: number) => RY_BASE - (Math.min(rate, 120) / 100) * RY_SPAN;

  const pts = rated.map((p, i) => [rx(i), ry(p.rate)] as [number, number]);
  const line = smoothPath(pts);
  const area = `${line} L ${RX1} ${RY_BASE} L ${RX0} ${RY_BASE} Z`;

  const at = Math.min(focus, n - 1);
  const markX = pts[at][0];
  const step = (RX1 - RX0) / (n - 1);
  // Five evenly spread dots, however many readings there are.
  const dotEvery = Math.max(1, Math.floor((n - 1) / 4));

  return (
    <div>
      <svg
        viewBox="0 0 320 126"
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label={`Collections reconciliation trend, currently ${rated[at].rate.toFixed(0)}%`}
      >
        <defs>
          <linearGradient id="recon-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#74A5D7" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#74A5D7" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        <path d={area} fill="url(#recon-fill)" />
        <path d={line} fill="none" strokeWidth="1.5" style={{ stroke: SKY }} />

        {pts.map(([x, y], i) =>
          i % dotEvery === 0 ? (
            <circle
              key={rated[i].key}
              cx={x}
              cy={y}
              r="4"
              strokeWidth="2"
              style={{ fill: SKY, stroke: "var(--color-card)" }}
            />
          ) : null,
        )}

        {/* the reading slides along the wave */}
        <g className={SLIDE} style={{ transform: `translate(${markX}px, 0)` }} pointerEvents="none">
          <line x1="0" y1="28" x2="0" y2={RY_BASE} strokeWidth="1" strokeDasharray="3 3" style={{ stroke: FG }} />
          <text x="0" y="18" textAnchor="middle" fontSize="15" fontWeight="700" style={{ fill: FG }}>
            {rated[at].rate.toFixed(0)}%
          </text>
          <polygon points={`-4,${RY_BASE} 4,${RY_BASE} 0,${RY_BASE + 7}`} style={{ fill: FG }} />
        </g>

        {/* invisible hover strips, one per reading */}
        {pts.map(([x], i) => (
          <rect
            key={`hit${rated[i].key}`}
            x={x - step / 2}
            y={0}
            width={step}
            height={126}
            fill="transparent"
            onMouseEnter={() => setFocus(i)}
          />
        ))}
      </svg>

      <div className="relative mt-1.5">
        <div
          className="h-2 w-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${CORAL}, ${NAVY} 55%, ${SKY})` }}
          aria-hidden
        />
        <span
          className="absolute inset-y-0 w-0.5 bg-card transition-[left] duration-300 ease-out motion-reduce:transition-none"
          style={{ left: `calc(${((markX / 320) * 100).toFixed(1)}% - 1px)` }}
          aria-hidden
        />
      </div>

      <p className="mt-2 text-center text-[10.5px] text-muted-foreground">
        {bucketLabel(rated[at].key, series.bucket)}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- transactions --- */

/** The badge a row's status wears. Only Paystack rows are ever not completed. */
const STATUS_BADGE: Record<UnifiedTransaction["status"], string> = {
  completed: "bg-cash-in-subtle text-cash-in",
  pending: "bg-warning-subtle text-warning",
  failed: "bg-danger-subtle text-danger",
};

const STATUS_LABEL: Record<UnifiedTransaction["status"], string> = {
  completed: "Completed",
  pending: "Pending",
  failed: "Failed",
};

/** Where a row's own record lives, when it has one of its own. */
function rowPath(tx: UnifiedTransaction): string | null {
  switch (tx.ref.kind) {
    case "susu-account":
      return `/susu/${tx.ref.id}`;
    case "savings-account":
      return `/savings/${tx.ref.id}`;
    case "loan":
      return `/loans/${tx.ref.id}`;
    case "hp-agreement":
      return `/hire-purchase/${tx.ref.id}`;
    case "hp-sale":
      return `/sales/${tx.ref.id}`;
    default:
      // A transfer has no page of its own — its legs are the record.
      return null;
  }
}

function TransactionsTable({
  rows,
  query,
  total,
}: {
  rows: UnifiedTransaction[];
  query: string;
  /** How many rows the panel holds before the filter, for the empty message. */
  total: number;
}) {
  const office = isOffice(useCurrentUser());

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-2xl text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
            <th className="pb-2.5 font-medium">Date</th>
            <th className="pb-2.5 font-medium">Customer</th>
            <th className="pb-2.5 font-medium">Account</th>
            <th className="pb-2.5 font-medium">Type</th>
            <th className="pb-2.5 text-right font-medium">Amount</th>
            <th className="pb-2.5 pl-6 font-medium">Status</th>
            <th className="pb-2.5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="py-6 text-center text-xs text-muted-foreground">
                {total === 0
                  ? "No money has moved in the last 30 days."
                  : `No transactions match “${query}”. Clear the search to see all ${formatCount(total)} rows.`}
              </td>
            </tr>
          )}
          {rows.map((tx) => {
            const to = rowPath(tx);
            const internal = tx.direction === "internal";
            return (
              <tr
                key={tx.id}
                className="animate-in fade-in border-b border-border/60 duration-200 last:border-0 motion-reduce:animate-none"
              >
                <td className="py-3 whitespace-nowrap text-muted-foreground">
                  {formatAccraDateTime(tx.createdAt)}
                </td>
                <td className="py-3 font-medium whitespace-nowrap">{tx.customerName}</td>
                <td className="py-3 whitespace-nowrap text-muted-foreground">
                  {tx.ref.accountNumber ?? "—"}
                </td>
                <td className="py-3 whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: MODULE_VAR[tx.module] }}
                    />
                    {TXN_TYPE_LABELS[tx.type]}
                  </span>
                </td>
                <td
                  className={cn(
                    "py-3 text-right font-semibold whitespace-nowrap tabular-nums",
                    internal
                      ? "text-muted-foreground"
                      : tx.direction === "out"
                        ? "text-cash-out"
                        : "text-foreground",
                  )}
                >
                  {/* A transfer leg carries no sign: no cash crossed the counter. */}
                  {internal ? "" : tx.direction === "out" ? "−" : "+"}
                  {formatPesewas(tx.amount)}
                </td>
                <td className="py-3 pl-6">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-medium",
                      STATUS_BADGE[tx.status],
                    )}
                  >
                    {STATUS_LABEL[tx.status]}
                  </span>
                </td>
                <td className="py-3 pl-3 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`Actions for ${TXN_TYPE_LABELS[tx.type]}, ${tx.customerName}`}
                      className="inline-flex size-6 items-center justify-center rounded-full border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <EllipsisIcon className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild disabled={!to}>
                        {to ? (
                          <Link to={to}>Open the account</Link>
                        ) : (
                          <span>Open the account</span>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to={`/customers/${tx.customerId}`}>Open customer</Link>
                      </DropdownMenuItem>
                      {office && (
                        <DropdownMenuItem asChild>
                          <Link to="/transactions">Open the ledger</Link>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
