import {
  BanknoteIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  ClipboardListIcon,
  EllipsisIcon,
  HandCoinsIcon,
  IdCardIcon,
  LandmarkIcon,
  PiggyBankIcon,
  SearchIcon,
  TrendingUpIcon,
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
  formatCedisWhole,
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
  type DashboardFinancials,
  type SeriesBucket,
  type StaffPerformance,
  type UnifiedTransaction,
} from "~/lib/reports";
import { getCollectorDashboardPage } from "~/api/collectors";
import { CollectorDashboard } from "~/components/collector-dashboard";
import {
  GlassPopover,
  GlassPopoverAnchor,
  GlassPopoverContent,
} from "~/components/glassyui/glass-popover";
import { TileFigure } from "~/components/tile-figure";
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
  month: { label: "This year", bucket: "month", span: 364 },
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
  // The month view is the calendar year, January to December; months still to
  // come draw as empty buckets. Days and weeks look back from today.
  const today = accraDay();
  const year = today.slice(0, 4);
  const from = bucket === "month" ? `${year}-01-01` : accraDaysAgo(span);
  const to = bucket === "month" ? `${year}-12-31` : today;

  const { data: page, headers } = await withAuth(request, (token) =>
    getDashboardPage(token, {
      from,
      to,
      bucket,
      recentLimit: RECENT_LIMIT,
      office: isOffice(user),
    }),
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
const gh = (pesewas: number) => formatPesewas(pesewas);

/**
 * A bucket key as an axis tick. Day keys are `2026-08-27`, week keys
 * `2026-W35`, month keys `2026-08` — the API's own encoding, read rather than
 * re-derived, so a bucket is labelled with the day it actually covers.
 */
function tickLabel(key: string, bucket: SeriesBucket): string {
  if (bucket === "week") return `w${key.split("-W")[1] ?? ""}`;
  if (bucket === "month") {
    return (MONTH_ABBR[Number(key.slice(5, 7)) - 1] ?? key).toUpperCase();
  }
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

type OfficeData = Exclude<Route.ComponentProps["loaderData"], { collector: unknown }>;

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  if ("collector" in loaderData) {
    return <CollectorDashboard data={loaderData.collector} />;
  }
  // Admin and manager get the money-first page; the counter, who is not sent
  // the financials, keeps the collections view.
  if (loaderData.financials) {
    return (
      <FinancialDashboard
        loaderData={loaderData}
        financials={loaderData.financials}
      />
    );
  }
  return <OfficeDashboard loaderData={loaderData} />;
}

/**
 * A period change is a navigation, so the charts dim while the API answers
 * rather than sitting on figures that belong to the previous range.
 */
function useSwitching(): boolean {
  const navigation = useNavigation();
  return (
    navigation.state === "loading" &&
    navigation.location?.pathname === "/dashboard"
  );
}

/** The recent rows and the filter typed over them, shared by table and export. */
function useRecentRows(recent: OfficeData["recent"]) {
  const [query, setQuery] = useState("");
  // Sliced as well as asked for: `limit` is the API's to honour, and the panel
  // is sized for five rows whatever it sends back.
  const rows = (recent?.items ?? []).slice(0, RECENT_LIMIT);
  const q = query.trim().toLowerCase();
  const visible = q ? rows.filter((tx) => searchText(tx).includes(q)) : rows;
  return { query, setQuery, rows, visible };
}

function OfficeDashboard({ loaderData }: { loaderData: OfficeData }) {
  const { period, summary, series, efficiency, alerts, recent } = loaderData;
  const switching = useSwitching();
  const recentRows = useRecentRows(recent);

  const k = summary.kpis;
  const p = summary.portfolio;

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
          value={formatCount(k.activeSusuPlans)}
          label="Susu Plans Running"
          icon={ClipboardListIcon}
          tint={2}
          hint={`${gh(p.susu.valueHeld)} held for customers`}
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
          <PeriodControls period={period} exportRows={recentRows.visible} />

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

          <AlertsCard alerts={alerts} />

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
        <RecentCard recent={recent} {...recentRows} />
      </div>

      <ReadAt at={summary.generatedAt} />
    </div>
  );
}

/* ------------------------------------------------- the financial dashboard --- */

/**
 * The admin and manager page: money first. What the business holds, what it
 * owes customers, what is out on loan, and what it has earned — then how the
 * money moved. Counts and the field-cash check drop to the strip at the foot.
 *
 *   KPI row            GET /dashboard/financials → cash, deposits, loanBook, profit
 *   Cash Flow          GET /dashboard/series → cashIn vs cashOut
 *   Loan Book          GET /dashboard/financials → loanBook
 *   Deposits Mix       GET /dashboard/financials → deposits
 *   Liquidity          GET /dashboard/financials → liquidityPercent
 *   Net Profit Trend   GET /dashboard/financials → trend
 *   Staff Performance  GET /dashboard/staff-performance
 */
function FinancialDashboard({
  loaderData,
  financials: f,
}: {
  loaderData: OfficeData;
  financials: DashboardFinancials;
}) {
  const { period, summary, series, recent, staffPerformance } = loaderData;
  const switching = useSwitching();
  const recentRows = useRecentRows(recent);

  const k = summary.kpis;
  const book = f.loanBook;
  const { thisMonth } = f.profit;

  return (
    <div className="min-h-full bg-background px-5 pt-1 pb-5 text-foreground sm:px-8">
      {/* ------------------------------------------------ financial position --- */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Stat
          value={formatCount(k.totalCustomers)}
          label="Total Customers"
          icon={UsersIcon}
          tint={1}
        />
        <Stat
          value={gh(f.deposits.total)}
          label="Customer Deposits"
          icon={PiggyBankIcon}
          tint={3}
        />
        <Stat
          value={gh(book.outstanding)}
          label="Loans Outstanding"
          icon={HandCoinsIcon}
          tint={2}
        />
        <Stat
          value={gh(f.commissionAllTime)}
          label="Total Commission"
          icon={TrendingUpIcon}
          tint={1}
        />
        <Stat
          value={ghSigned(thisMonth.netProfit)}
          label="Net Profit This Month"
          icon={LandmarkIcon}
          tint={4}
        />
      </div>

      {/* ----------------------------------------------------- two columns --- */}
      <div
        className={cn(
          "mt-4 grid gap-4 transition-opacity duration-200 xl:grid-cols-[minmax(0,1.66fr)_minmax(0,1fr)]",
          switching && "opacity-60",
        )}
      >
        {/* left column — stretched like the right one, its bottom row taking the
            slack, so both columns end level whichever is taller */}
        <div className="flex flex-col gap-4">
          <Card
            title="Cash Flow"
            detailTo="/transactions"
            note="Money received from and paid out to customers. Moves between the business's own accounts are left out."
          >
            {series ? (
              <CashFlowChart key={period} series={series} />
            ) : (
              <Unavailable what="the cash series" />
            )}
          </Card>

          <div className="grid flex-1 gap-4 md:grid-cols-2">
            <Card title="Loan Book" detailTo="/loans">
              <LoanBook book={book} />
            </Card>
            <Card title="Deposits Mix" detailTo="/accounting/balance-sheet">
              <PortfolioDonut
                ariaLabel="Customer deposits"
                caption="held for customers"
                empty="No customer money is held yet — no susu, savings or loan-linked balances."
                slices={[
                  { label: "Susu", color: CORAL, amount: f.deposits.susu },
                  { label: "Savings", color: NAVY, amount: f.deposits.savings },
                  {
                    label: "Loan-linked",
                    color: SKY,
                    amount: f.deposits.susuLoan + f.deposits.collateral,
                  },
                ]}
              />
            </Card>
          </div>
        </div>

        {/* right column — stretched to the left one's height, with the staff
            card taking up the slack so both columns end level */}
        <div className="flex flex-col gap-4">
          <Card title="Liquidity" centered plain note={liquidityNote(f)}>
            <Gauge
              percent={f.liquidityPercent}
              label="Liquidity"
              emptyText="no customer deposits are held"
            />
          </Card>

          <Card title="Net Profit Trend" detailTo="/accounting/profit-loss">
            <ProfitTrend key={period} trend={f.trend} />
          </Card>

          <div className="flex-1 [&>section]:h-full">
            <Card
              title="Staff Performance"
              detailTo="/transactions"
            >
              {staffPerformance ? (
                <StaffChart key={period} performance={staffPerformance} />
              ) : (
                <Unavailable what="staff performance" />
              )}
            </Card>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------- transactions table --- */}
      <div className="mt-4">
        <RecentCard recent={recent} {...recentRows} />
      </div>
    </div>
  );
}

/** A minus sign before the currency, where a figure can go negative. */
function ghSigned(pesewas: number): string {
  return pesewas < 0 ? `−${gh(-pesewas)}` : gh(pesewas);
}

function liquidityNote(f: DashboardFinancials): string {
  if (f.liquidityPercent === null) {
    return `${formatPesewas(f.cash.total)} on hand and no customer deposits held.`;
  }
  return `${formatPesewas(f.cash.total)} on hand against ${formatPesewas(f.deposits.total)} owed to customers, across ${formatCount(f.cash.accounts.length)} cash ${f.cash.accounts.length === 1 ? "account" : "accounts"} and the commission account.`;
}

/** One labelled money line inside a card. */
function MoneyRow({
  label,
  amount,
  sub,
  strong = false,
  color,
}: {
  label: string;
  amount: string;
  sub?: string;
  strong?: boolean;
  color?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className={cn("flex items-center gap-1.5", strong ? "font-semibold" : "text-muted-foreground")}>
        {color && <span className="size-2 rounded-full" style={{ background: color }} />}
        {label}
        {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
      </span>
      <span className={cn("tabular-nums", strong ? "font-bold" : "font-medium")}>{amount}</span>
    </div>
  );
}

function LoanBook({ book }: { book: DashboardFinancials["loanBook"] }) {
  const arrears = book.loans.arrearsAmount + book.hirePurchase.arrearsAmount;
  const arrearsCases = book.loans.arrearsCount + book.hirePurchase.arrearsCount;
  const par = book.parPercent ?? 0;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <MoneyRow label="Outstanding" amount={formatPesewas(book.outstanding)} strong />
        <MoneyRow
          label="Loans"
          amount={formatPesewas(book.loans.outstanding)}
          sub={`${formatCount(book.loans.open)} open`}
        />
        <MoneyRow
          label="Hire purchase"
          amount={formatPesewas(book.hirePurchase.outstanding)}
          sub={`${formatCount(book.hirePurchase.open)} open`}
        />
      </div>

      <div className="space-y-1.5">
        <MoneyRow
          label="In arrears"
          amount={formatPesewas(arrears)}
          sub={`${formatCount(arrearsCases)} ${arrearsCases === 1 ? "case" : "cases"}`}
          strong
          color="var(--danger)"
        />
        <div className="h-2 rounded-full" style={{ background: BORDER }}>
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${Math.min(100, par)}%`, background: "var(--danger)" }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          {book.parPercent === null
            ? "Nothing is out on loan."
            : `${book.parPercent.toFixed(1)}% of the book is at risk (PAR).`}
        </p>
      </div>

      <div className="space-y-1.5 border-t border-border pt-2.5">
        <MoneyRow
          label="Paid out this month"
          amount={formatPesewas(book.disbursedThisMonth.amount)}
          sub={`×${book.disbursedThisMonth.count}`}
        />
        <MoneyRow
          label="Repaid this month"
          amount={formatPesewas(book.repaidThisMonth.amount)}
          sub={`×${book.repaidThisMonth.count}`}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------- shared page parts --- */

function PeriodControls({
  period,
  exportRows,
}: {
  period: PeriodKey;
  exportRows: UnifiedTransaction[];
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const pickPeriod = (key: PeriodKey) => {
    const next = new URLSearchParams(searchParams);
    if (key === DEFAULT_PERIOD) next.delete("period");
    else next.set("period", key);
    setSearchParams(next, { preventScrollReset: true });
  };

  return (
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
        onClick={() => exportCsv(exportRows)}
        disabled={exportRows.length === 0}
        className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
      >
        Export
        <UploadIcon className="size-3" />
      </button>
    </div>
  );
}

/* Not the notifications bell: a notification is one past event sent to one
   person, an alert is a condition that stays true until the work is done and
   reads the same for everyone in the office. The card carries no "see all"
   for that reason — this *is* all of them. */
function AlertsCard({ alerts }: { alerts: OfficeData["alerts"] }) {
  return (
    <Card title="Alerts needing action" plain>
      {!alerts ? (
        <Unavailable what="alerts" />
      ) : alerts.alerts.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          Nothing is waiting on anyone. Alerts appear here the moment a payout,
          an arrears case or an unconfirmed handover needs work.
        </p>
      ) : (
        <div className="space-y-5">
          {alerts.alerts.map((alert) => (
            <Notice key={alert.key} alert={alert} />
          ))}
        </div>
      )}
    </Card>
  );
}

function RecentCard({
  recent,
  query,
  setQuery,
  rows,
  visible,
}: { recent: OfficeData["recent"] } & ReturnType<typeof useRecentRows>) {
  return (
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
        <TransactionsTable rows={visible} query={query} total={rows.length} />
      ) : (
        <Unavailable what="recent transactions" />
      )}
    </Card>
  );
}

function ReadAt({ at }: { at: string }) {
  return (
    <p className="mt-4 text-[11px] text-muted-foreground">
      Live figures from the reporting API, read at {formatAccraDateTime(at)}.
      Money is shown in cedis; every amount is held as pesewas.
    </p>
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
    <section className="flex flex-col rounded-lg bg-card p-4 text-card-foreground sm:p-5">
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
              <Link
                to={door}
                className="rounded-full border border-border bg-card px-3 py-1 text-[10.5px] font-medium"
              >
                See Detail
              </Link>
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
    <div className="relative rounded-lg bg-card p-4">
      <span
        className="absolute top-3.5 right-3.5 rounded-lg p-2"
        style={{ background: `var(--tint-${tint}-bg)` }}
      >
        <Icon className="size-4" style={{ color: `var(--tint-${tint}-fg)` }} />
      </span>
      {/* keyed so a refresh re-enters the number instead of snapping */}
      <p
        key={value}
        className={cn(
          "animate-in fade-in slide-in-from-bottom-1 pr-10 font-bold leading-tight tracking-tight tabular-nums duration-300 motion-reduce:animate-none",
          // Full amounts, never abbreviated — a long one steps down a size,
          // and on a phone drops below the icon to get the tile's full width.
          value.length > 14
            ? "text-base max-sm:pt-9 max-sm:pr-0 sm:text-lg"
            : "text-lg sm:text-[22px]",
        )}
      >
        <TileFigure value={value} />
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

const FX0 = 62; // room for full-cedi axis figures
const FX1 = 622; // room for the last month's label
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
  return (
    <LineChart
      keys={series.points.map((p) => p.key)}
      bucket={series.bucket}
      primary={{ label: "Confirmed", values: series.points.map((p) => p.received) }}
      secondary={{ label: "Recorded", values: series.points.map((p) => p.expected) }}
      ariaLabel="Field cash recorded against cash confirmed at the office, by bucket"
      empty="Not enough reconciled buckets in this range to draw a trend yet."
    />
  );
}

/**
 * The bucket a chart opens on — the one someone came to the page to see.
 * The month view runs the whole calendar year, so that is this month rather
 * than December; day and week views end today, so it is the last bucket.
 */
function openingIndex(keys: string[], bucket: SeriesBucket): number {
  const last = Math.max(0, keys.length - 1);
  if (bucket !== "month") return last;
  const at = keys.indexOf(accraDay().slice(0, 7));
  return at === -1 ? last : at;
}

/** Cash in against cash out, bucket by bucket — transfers excluded. */
function CashFlowChart({ series }: { series: CashSeries }) {
  return (
    <LineChart
      keys={series.points.map((p) => p.key)}
      bucket={series.bucket}
      primary={{ label: "Cash in", values: series.points.map((p) => p.cashIn.amount) }}
      secondary={{ label: "Cash out", values: series.points.map((p) => p.cashOut.amount) }}
      ariaLabel="Cash received against cash paid out, by bucket"
      empty="Not enough buckets in this range to draw a trend yet."
    />
  );
}

/**
 * Two money series over the buckets: the coral `primary` glows under the
 * pinned point, the navy `secondary` runs alongside it.
 */
function LineChart({
  keys,
  bucket,
  primary,
  secondary,
  ariaLabel,
  empty,
}: {
  keys: string[];
  bucket: SeriesBucket;
  primary: { label: string; values: number[] };
  secondary: { label: string; values: number[] };
  ariaLabel: string;
  empty: string;
}) {
  const points = keys.map((key) => ({ key }));
  const n = points.length;
  const [focus, setFocus] = useState(() => openingIndex(keys, bucket));

  if (n < 2) {
    return (
      <p className="py-12 text-center text-xs text-muted-foreground">{empty}</p>
    );
  }

  const received = primary.values;
  const expected = secondary.values;
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
      aria-label={ariaLabel}
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
          {f === 0 ? "0" : formatCedisWhole(scale * f)}
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
        <rect x={flip ? -196 : 14} y={FY0 + 6} width="182" height="60" rx="11" fill={TIP} />
        <text x={(flip ? -196 : 14) + 12} y={FY0 + 22} fontSize="9" fontWeight="700" fill="#fff">
          {bucketLabel(points[at].key, bucket)}
        </text>
        <circle cx={(flip ? -196 : 14) + 15} cy={FY0 + 35} r="3" style={{ fill: CORAL }} />
        <text x={(flip ? -196 : 14) + 23} y={FY0 + 38} fontSize="9" fill="#B9BDC4">
          {primary.label} <tspan fill="#fff" fontWeight="700">{gh(received[at])}</tspan>
        </text>
        <circle cx={(flip ? -196 : 14) + 15} cy={FY0 + 51} r="3" style={{ fill: NAVY }} />
        <text x={(flip ? -196 : 14) + 23} y={FY0 + 54} fontSize="9" fill="#B9BDC4">
          {secondary.label} <tspan fill="#fff" fontWeight="700">{gh(expected[at])}</tspan>
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
              {tickLabel(p.key, bucket)}
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

function PortfolioDonut({
  slices,
  ariaLabel = "Portfolio mix",
  caption = "total book",
  empty = "The branch is holding nothing yet — no susu, savings or credit balances.",
}: {
  slices: Slice[];
  ariaLabel?: string;
  /** Under the total in the middle of the ring. */
  caption?: string;
  empty?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const cx = 100;
  const cy = 96;
  const r = 66;

  const book = slices.reduce((sum, s) => sum + s.amount, 0);
  if (book <= 0) {
    return (
      <p className="py-12 text-center text-xs text-muted-foreground">{empty}</p>
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
        aria-label={`${ariaLabel} — ${gh(book)} across ${slices.map((s) => s.label.toLowerCase()).join(", ")}`}
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
            <text x={cx} y={cy + 2} textAnchor="middle" fontSize={gh(book).length > 12 ? 10.5 : 14} fontWeight="700" style={{ fill: FG }} pointerEvents="none">
              {gh(book)}
            </text>
            <text x={cx} y={cy + 16} textAnchor="middle" fontSize="8.5" style={{ fill: MUTED }} pointerEvents="none">
              {caption}
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

function Gauge({
  percent,
  label = "Collection efficiency",
  emptyText = "nothing was due in this range",
}: {
  percent: number | null;
  /** What the dial measures, for the screen reader. */
  label?: string;
  emptyText?: string;
}) {
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
          ? `${label}: ${emptyText}`
          : `${label}: ${Math.round(percent)}%`
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

/* ------------------------------------------------------------- profit wave --- */

/**
 * Net profit (revenue less expenses) bucket by bucket, drawn like the
 * reconciliation wave. Profit can go below zero, so the zero line floats: it
 * sits on the floor until a loss appears, then rises to make room for it.
 */
function ProfitTrend({ trend }: { trend: DashboardFinancials["trend"] }) {
  const points = trend.points;
  const n = points.length;
  const [focus, setFocus] = useState(() =>
    openingIndex(points.map((p) => p.key), trend.bucket),
  );

  if (n < 2) {
    return (
      <p className="py-10 text-center text-xs text-muted-foreground">
        Fewer than two periods in this range, so there is no trend to draw yet.
      </p>
    );
  }

  const values = points.map((p) => p.netProfit);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;

  const rx = (i: number) => RX0 + (i * (RX1 - RX0)) / (n - 1);
  const ry = (v: number) => RY_BASE - ((v - lo) / span) * RY_SPAN;
  const zeroY = ry(0);

  const pts = values.map((v, i) => [rx(i), ry(v)] as [number, number]);
  const line = smoothPath(pts);
  const area = `${line} L ${RX1} ${zeroY} L ${RX0} ${zeroY} Z`;

  const at = Math.min(focus, n - 1);
  const markX = pts[at][0];
  const step = (RX1 - RX0) / (n - 1);
  const dotEvery = Math.max(1, Math.floor((n - 1) / 4));
  const shown = points[at];

  return (
    <div>
      <svg
        viewBox="0 0 320 126"
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label={`Net profit trend, ${ghSigned(shown.netProfit)} in ${bucketLabel(shown.key, trend.bucket)}`}
      >
        <defs>
          <linearGradient id="profit-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#74A5D7" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#74A5D7" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        <path d={area} fill="url(#profit-fill)" />
        {lo < 0 && (
          <line x1={RX0} y1={zeroY} x2={RX1} y2={zeroY} strokeWidth="1" strokeDasharray="2 3" style={{ stroke: MUTED }} />
        )}
        <path d={line} fill="none" strokeWidth="1.5" style={{ stroke: SKY }} />

        {pts.map(([x, y], i) =>
          i % dotEvery === 0 ? (
            <circle
              key={points[i].key}
              cx={x}
              cy={y}
              r="4"
              strokeWidth="2"
              style={{
                fill: values[i] < 0 ? "var(--danger)" : SKY,
                stroke: "var(--color-card)",
              }}
            />
          ) : null,
        )}

        <g className={SLIDE} style={{ transform: `translate(${markX}px, 0)` }} pointerEvents="none">
          <line x1="0" y1="28" x2="0" y2={RY_BASE} strokeWidth="1" strokeDasharray="3 3" style={{ stroke: FG }} />
          {/* anchored inward at the ends, so a long figure stays in the card */}
          <text
            x="0"
            y="18"
            textAnchor={at === 0 ? "start" : at === n - 1 ? "end" : "middle"}
            fontSize="15"
            fontWeight="700"
            style={{ fill: shown.netProfit < 0 ? "var(--danger)" : FG }}
          >
            {ghSigned(shown.netProfit)}
          </text>
          <polygon points={`-4,${RY_BASE} 4,${RY_BASE} 0,${RY_BASE + 7}`} style={{ fill: FG }} />
        </g>

        {pts.map(([x], i) => (
          <rect
            key={`hit${points[i].key}`}
            x={x - step / 2}
            y={0}
            width={step}
            height={126}
            fill="transparent"
            onMouseEnter={() => setFocus(i)}
          />
        ))}
      </svg>

      <div className="mt-3 flex justify-center gap-4 text-[10.5px] text-muted-foreground">
        <span>{bucketLabel(shown.key, trend.bucket)}</span>
        <span>
          Revenue <b className="text-foreground">{gh(shown.revenue)}</b>
        </span>
        <span>
          Expenses <b className="text-foreground">{gh(shown.expenses)}</b>
        </span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- staff performance --- */

/** One colour per line, busiest member of staff first. */
const STAFF_COLORS = [CORAL, NAVY, SKY, "var(--chart-4)", "var(--chart-5)"];
const SY0 = 8;
const SY1 = 126;

/**
 * Cash each of the busiest staff took in, one line apiece. The figures sit in
 * a popover over the hovered bucket, with each person's total for the range
 * beside their figure for that bucket.
 */
function StaffChart({ performance }: { performance: StaffPerformance }) {
  const { keys, bucket, staff } = performance;
  const n = keys.length;
  const [focus, setFocus] = useState(() => openingIndex(keys, bucket));
  const [open, setOpen] = useState(false);

  if (staff.length === 0) {
    return (
      <p className="py-10 text-center text-xs text-muted-foreground">
        No member of staff took in cash in this range.
      </p>
    );
  }
  if (n < 2) {
    return (
      <p className="py-10 text-center text-xs text-muted-foreground">
        Fewer than two periods in this range, so there is no trend to draw yet.
      </p>
    );
  }

  const scale = niceCeil(Math.max(1, ...staff.flatMap((s) => s.values)));
  const sx = (i: number) => RX0 + (i * (RX1 - RX0)) / (n - 1);
  const sy = (v: number) => SY1 - (v / scale) * (SY1 - SY0);
  const step = (RX1 - RX0) / (n - 1);
  const labelEvery = Math.max(1, Math.ceil(n / 7));
  const at = Math.min(focus, n - 1);
  const markPct = (sx(at) / 320) * 100;
  const flip = markPct > 50;

  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <svg
        viewBox="0 0 320 150"
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label={`Cash taken in by staff, ${bucketLabel(keys[at], bucket)}`}
      >
        <line x1={RX0} y1={SY1} x2={RX1} y2={SY1} strokeWidth="1" style={{ stroke: BORDER }} />

        {staff.map((s, k) => (
          <polyline
            key={s.id}
            points={s.values.map((v, i) => `${sx(i)},${sy(v)}`).join(" ")}
            fill="none"
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ stroke: STAFF_COLORS[k % STAFF_COLORS.length] }}
          />
        ))}

        <g className={SLIDE} style={{ transform: `translate(${sx(at)}px, 0)` }} pointerEvents="none">
          <line x1="0" y1={SY0} x2="0" y2={SY1} strokeWidth="1" strokeDasharray="3 3" style={{ stroke: FG }} />
        </g>
        {staff.map((s, k) => (
          <circle
            key={`dot${s.id}`}
            cx={sx(at)}
            cy={sy(s.values[at] ?? 0)}
            r="3.5"
            strokeWidth="1.5"
            pointerEvents="none"
            style={{
              fill: STAFF_COLORS[k % STAFF_COLORS.length],
              stroke: "var(--color-card)",
              transition: "cx 300ms ease-out, cy 300ms ease-out",
            }}
          />
        ))}

        {keys.map((key, i) =>
          i % labelEvery === 0 || i === at ? (
            <text
              key={`tick${key}`}
              x={sx(i)}
              y={144}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              fontSize="9"
              style={{ fill: i === at ? FG : MUTED }}
            >
              {tickLabel(key, bucket)}
            </text>
          ) : null,
        )}

        {keys.map((key, i) => (
          <rect
            key={`hit${key}`}
            x={sx(i) - step / 2}
            y={0}
            width={step}
            height={150}
            fill="transparent"
            onMouseEnter={() => {
              setFocus(i);
              setOpen(true);
            }}
          />
        ))}
      </svg>

      {/* the popover, anchored to the marker and opened on the side with room
          for it. Hover drives it, so it never takes focus or the pointer — a
          popover under the cursor would close the moment it opened. */}
      <GlassPopover open={open} onOpenChange={setOpen}>
        <GlassPopoverAnchor asChild>
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/3 h-px w-px"
            style={{ left: `${markPct}%` }}
          />
        </GlassPopoverAnchor>
        <GlassPopoverContent
          side={flip ? "left" : "right"}
          elevation="base"
          align="center"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="pointer-events-none w-60 px-3.5 py-3 text-[11px] text-foreground"
        >
          <p className="mb-2 font-bold">{bucketLabel(keys[at], bucket)}</p>
          <div className="space-y-2">
            {staff.map((s, k) => (
              <div key={s.id} className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: STAFF_COLORS[k % STAFF_COLORS.length] }}
                  />
                  <span className="truncate">{s.name}</span>
                </span>
                <span className="shrink-0 text-right">
                  <b className="block tabular-nums">{gh(s.values[at] ?? 0)}</b>
                  <span className="block text-[9.5px] tabular-nums text-muted-foreground">
                    {gh(s.total)} in range
                  </span>
                </span>
              </div>
            ))}
          </div>
        </GlassPopoverContent>
      </GlassPopover>
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
