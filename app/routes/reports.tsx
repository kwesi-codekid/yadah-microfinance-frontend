import {
  ActivityIcon,
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  BanknoteIcon,
  CalendarCheckIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CoinsIcon,
  EllipsisIcon,
  HandCoinsIcon,
  IdCardIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  PackageIcon,
  PercentIcon,
  PiggyBankIcon,
  ReceiptIcon,
  ScaleIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  TrendingUpIcon,
  UploadIcon,
  UserMinusIcon,
  UserPlusIcon,
  UserRoundIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { data, Link, useNavigation, useSearchParams } from "react-router";

import { FilterRail, RailFrame } from "~/components/filter-rail";

import {
  AreaLine,
  CORAL,
  gh,
  HandoverGrid,
  Legend,
  MIST,
  NAVY,
  PairedColumns,
  RankedBars,
  ReportCard,
  SegmentBar,
  SKY,
  SLATE,
  StackedColumns,
  StatTile,
  WeekdayBars,
  type ColumnPoint,
} from "~/components/report-charts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  accraDay,
  formatAccraDateTime,
  formatCount,
  formatDayRange,
  formatPercent,
  formatPesewas,
} from "~/lib/format";
import {
  buildReportsData,
  DEFAULT_REPORT_PERIOD,
  REPORT_PERIODS,
  reportPeriodOf,
  type ReportPeriod,
  type ReportsData,
} from "~/lib/reports-dummy";
import { requireOffice } from "~/lib/session.server";
import { useCurrentUser } from "~/lib/use-current-user";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/reports";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Reports · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page, and the line under it. */
export const handle = {
  title: "Reports",
  description: "Every book the branch keeps, read over a period.",
};

/**
 * The office's reading of the whole business over a period: one tab per book,
 * each with the figures the office actually asks for and a door into the full
 * report behind it.
 *
 * The figures here are placeholders, generated from a fixed seed so the page
 * is the same on every load. Each tab is shaped for the reporting endpoint
 * that will replace it; see `~/lib/reports-dummy` for which is which.
 */

export async function loader({ request }: Route.LoaderArgs) {
  // The whole `/reports` surface is office-only on the API's side; a collector
  // reconciles their own day on the susu summary, which is scoped to them.
  await requireOffice(request);
  const period = reportPeriodOf(
    new URL(request.url).searchParams.get("period"),
  );
  // The Accra day is computed here and passed down, so render and hydration
  // can never disagree about what "today" is.
  const report = buildReportsData(period, accraDay(), new Date().toISOString());
  return data(report);
}

/* -------------------------------------------------------------------- tabs --- */

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboardIcon },
  { id: "susu", label: "Susu", icon: HandCoinsIcon },
  { id: "savings", label: "Savings", icon: PiggyBankIcon },
  { id: "loans", label: "Loans", icon: LandmarkIcon },
  { id: "hire-purchase", label: "Hire purchase", icon: PackageIcon },
  { id: "sales", label: "Counter sales", icon: ShoppingCartIcon },
  { id: "staff", label: "Collections by staff", icon: UsersIcon },
  { id: "handover", label: "Cash handover", icon: WalletIcon },
  { id: "customers", label: "Customers", icon: UserRoundIcon },
  { id: "revenue", label: "Revenue", icon: TrendingUpIcon },
] as const;

type TabId = (typeof TABS)[number]["id"];

const tabOf = (raw: string | null): TabId =>
  TABS.some((t) => t.id === raw) ? (raw as TabId) : "overview";

const signed = (fraction: number, decimals = 1) =>
  `${fraction >= 0 ? "+" : "−"}${(Math.abs(fraction) * 100).toFixed(decimals)}%`;

const sum = <T,>(rows: T[], pick: (row: T) => number) =>
  rows.reduce((n, row) => n + pick(row), 0);

type Months = {
  key: string;
  label: string;
  partial: boolean;
  inflow: number;
  outflow: number;
}[];
const bookPoints = (months: Months): ColumnPoint[] =>
  months.map((m) => ({
    key: m.key,
    label: m.label,
    partial: m.partial,
    values: { inflow: m.inflow, outflow: m.outflow },
  }));

/* -------------------------------------------------------------------- page --- */

export default function Reports({ loaderData }: Route.ComponentProps) {
  const r = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const switching =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/reports";

  // The tab is client state with the URL kept in step, so switching tabs does
  // not go back to the server: the whole period's figures are already here.
  const [tab, setTab] = useState<TabId>(() => tabOf(searchParams.get("tab")));
  const pickTab = (id: TabId) => {
    setTab(id);
    const next = new URLSearchParams(window.location.search);
    if (id === "overview") next.delete("tab");
    else next.set("tab", id);
    const query = next.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  };

  const pickPeriod = (key: ReportPeriod) => {
    const next = new URLSearchParams(searchParams);
    if (key === DEFAULT_REPORT_PERIOD) next.delete("period");
    else next.set("period", key);
    if (tab !== "overview") next.set("tab", tab);
    setSearchParams(next, { preventScrollReset: true });
  };

  const periodLabel = REPORT_PERIODS[r.period].label;

  // The tab is a choice, not a place: the rail's buttons swap the panel here
  // without a round trip, and the URL is kept in step by `pickTab`.
  const railItems = TABS.map((t) => ({
    key: t.id,
    label: t.label,
    icon: t.icon,
    onSelect: () => pickTab(t.id),
  }));
  // A place rather than a choice: the worker heartbeats are a page of their
  // own, and admin-only, so the door only shows for an admin.
  const user = useCurrentUser();
  const sections = [
    { label: "Reports", items: railItems },
    ...(user?.role === "admin"
      ? [
          {
            label: "System",
            items: [
              {
                key: "workers",
                label: "Background workers",
                icon: ActivityIcon,
                to: "/reports/workers",
              },
            ],
          },
        ]
      : []),
  ];

  return (
    <RailFrame
      rail={({ horizontal }) => (
        <FilterRail
          label="Reports"
          sections={sections}
          active={tab}
          horizontal={horizontal}
        />
      )}
    >
      <div className="min-h-full min-w-0 bg-background px-5 pt-1 pb-5 text-foreground sm:px-8">
        {/* ---------------------------------------------------- controls --- */}
        <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
              {periodLabel}
              <ChevronDownIcon className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(Object.keys(REPORT_PERIODS) as ReportPeriod[]).map((key) => (
                <DropdownMenuItem key={key} onSelect={() => pickPeriod(key)}>
                  {REPORT_PERIODS[key].label}
                  {key === r.period && (
                    <CheckIcon className="ml-auto size-3.5" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
              Export
              <UploadIcon className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/reports/collections/export">
                  Collections by staff (CSV)
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/reports/loans/export">Outstanding loans (CSV)</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/reports/loans/aging/export">
                  Arrears aging (CSV)
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/reports/commission/export">
                  Commission and fees (CSV)
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/transactions/export">Transaction ledger (CSV)</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div
        key={tab}
        className={cn(
          "animate-in fade-in duration-200 motion-reduce:animate-none",
          "transition-opacity",
          switching && "opacity-60",
        )}
      >
        {tab === "overview" && <OverviewTab r={r} />}
        {tab === "susu" && <SusuTab r={r} />}
        {tab === "savings" && <SavingsTab r={r} />}
        {tab === "loans" && <LoansTab r={r} />}
        {tab === "hire-purchase" && <HirePurchaseTab r={r} />}
        {tab === "sales" && <SalesTab r={r} />}
        {tab === "staff" && <StaffTab r={r} />}
        {tab === "handover" && <HandoverTab r={r} />}
        {tab === "customers" && <CustomersTab r={r} />}
        {tab === "revenue" && <RevenueTab r={r} />}
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Sample figures for {periodLabel.toLowerCase()} (
        {formatDayRange(r.from, r.to)}), generated at{" "}
        {formatAccraDateTime(r.generatedAt)}. Money is shown in cedis; every
        amount is held as pesewas.
      </p>
    </div>
    </RailFrame>
  );
}

/* ------------------------------------------------------------------ chrome --- */

type TabProps = { r: ReportsData };

/** The tile row every tab opens with: the four or so figures the book is asked for. */
function Tiles({
  items,
}: {
  items: {
    value: string;
    label: string;
    icon: LucideIcon;
    tint: 1 | 2 | 3 | 4 | 5 | 6;
    hint?: string;
    delta?: { text: string; good: boolean | null };
  }[];
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-4",
        items.length >= 6 ? "md:grid-cols-3 xl:grid-cols-6" : "md:grid-cols-4",
      )}
    >
      {items.map((item) => (
        <StatTile key={item.label} {...item} />
      ))}
    </div>
  );
}

/** Two cards side by side on a wide screen; the left one wider when asked. */
function Row({
  children,
  split = "even",
}: {
  children: React.ReactNode;
  split?: "even" | "wide-left" | "wide-right";
}) {
  return (
    <div
      className={cn(
        "mt-4 grid grid-cols-1 items-start gap-4",
        split === "even" && "xl:grid-cols-2",
        split === "wide-left" && "xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]",
        split === "wide-right" &&
          "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]",
      )}
    >
      {children}
    </div>
  );
}

/** A small heading inside a card, above a second figure. */
function Sub({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <p className="text-[11px] font-medium">{children}</p>
      {aside}
    </div>
  );
}

/* ---------------------------------------------------------------- overview --- */

function OverviewTab({ r }: TabProps) {
  const k = r.kpis;
  const flowPoints: ColumnPoint[] = r.flow.map((m) => ({
    key: m.key,
    label: m.label,
    partial: m.partial,
    values: {
      susu: m.susu,
      savings: m.savings,
      loans: m.loans,
      hp: m.hp,
      sales: m.sales,
    },
  }));
  const held = r.susu.valueHeld + r.savings.balance;
  const lent = r.loans.outstanding + r.hp.outstanding;

  return (
    <>
      <Tiles
        items={[
          {
            value: gh(k.depositsMobilised),
            label: "Deposits mobilised",
            icon: ArrowDownToLineIcon,
            tint: 1,
            delta: {
              text: `${signed(k.depositsDelta)} on the previous month`,
              good: k.depositsDelta >= 0,
            },
          },
          {
            value: gh(k.withdrawalsPaid),
            label: "Withdrawals and payouts",
            icon: ArrowUpFromLineIcon,
            tint: 2,
            hint: "Susu payouts and savings withdrawals",
          },
          {
            value: gh(k.loansDisbursed),
            label: "Loans disbursed",
            icon: LandmarkIcon,
            tint: 3,
            hint: `${formatCount(k.loansCount)} new loans`,
          },
          {
            value: formatPercent(k.par30),
            label: "Portfolio at risk (30+)",
            icon: ScaleIcon,
            tint: 6,
            delta: {
              text: `${k.par30Delta <= 0 ? "▼" : "▲"} ${Math.abs(k.par30Delta * 100).toFixed(1)} pts on last month`,
              good: k.par30Delta <= 0,
            },
          },
          {
            value: gh(k.revenue),
            label: "Revenue kept",
            icon: CoinsIcon,
            tint: 5,
            delta: {
              text: `${signed(k.revenueDelta)} on the previous month`,
              good: k.revenueDelta >= 0,
            },
          },
          {
            value: `${k.handoverVariance < 0 ? "−" : "+"}${gh(Math.abs(k.handoverVariance))}`,
            label: "Handover variance",
            icon: HandCoinsIcon,
            tint: 4,
            hint: `across ${formatCount(k.handoverDays)} reconciled collector days`,
          },
        ]}
      />

      <div className="mt-4">
        <ReportCard
          eyebrow="All books"
          title="Money moved, by book"
          detailTo="/transactions"
          detailLabel="Open the ledger"
          aside={
            <Legend
              items={[
                { label: "Susu", color: CORAL },
                { label: "Savings", color: NAVY },
                { label: "Loan repayments", color: SKY },
                { label: "Hire purchase", color: SLATE },
                { label: "Counter sales", color: MIST },
              ]}
            />
          }
          note="Cash arriving at the counter or in a collector's bag, month by month. Transfer legs are not counted — no cash crosses the counter. * The running month is drawn faint: it is not over yet."
        >
          <StackedColumns
            points={flowPoints}
            series={[
              { key: "susu", label: "Susu", color: CORAL },
              { key: "savings", label: "Savings", color: NAVY },
              { key: "loans", label: "Loan repayments", color: SKY },
              { key: "hp", label: "Hire purchase", color: SLATE },
              { key: "sales", label: "Counter sales", color: MIST },
            ]}
            width={960}
            height={210}
            ariaLabel="Cash in by book, month by month"
          />
        </ReportCard>
      </div>

      <Row>
        <ReportCard
          eyebrow="Position"
          title="Held for customers against lent out"
          note="The question under every other figure: a branch is solvent while what customers have deposited covers the credit written against them. The shorter bar is the safer one."
        >
          <div className="space-y-5">
            <div>
              <Sub
                aside={
                  <span className="text-sm font-bold tabular-nums">
                    {formatPesewas(held)}
                  </span>
                }
              >
                Held for customers
              </Sub>
              <SegmentBar
                parts={[
                  { label: "Susu held", value: r.susu.valueHeld, color: CORAL },
                  {
                    label: "Savings balances",
                    value: r.savings.balance,
                    color: NAVY,
                  },
                ]}
                format={gh}
              />
            </div>
            <div>
              <Sub
                aside={
                  <span className="text-sm font-bold tabular-nums">
                    {formatPesewas(lent)}
                  </span>
                }
              >
                Lent out
              </Sub>
              <div style={{ width: `${(lent / Math.max(held, lent)) * 100}%` }}>
                <SegmentBar
                  parts={[
                    {
                      label: "Loans outstanding",
                      value: r.loans.outstanding,
                      color: SKY,
                    },
                    {
                      label: "Hire purchase outstanding",
                      value: r.hp.outstanding,
                      color: SLATE,
                    },
                  ]}
                  format={gh}
                />
              </div>
            </div>
          </div>
        </ReportCard>

        <ReportCard
          eyebrow="Books"
          title="Each book at a glance"
          note="The headline from every tab, in one column. Open a tab for the reading behind it."
        >
          <ul className="divide-y divide-border/60 text-xs">
            {[
              {
                label: "Susu",
                figure: `${formatCount(r.susu.accounts)} accounts`,
                detail: `${gh(r.susu.valueHeld)} held · ${formatCount(r.susu.payoutsDue.count)} payouts due`,
                color: CORAL,
              },
              {
                label: "Savings",
                figure: `${formatCount(r.savings.accounts)} accounts`,
                detail: `${gh(r.savings.balance)} balance held`,
                color: NAVY,
              },
              {
                label: "Loans",
                figure: `${formatCount(r.loans.open)} open`,
                detail: `${gh(r.loans.outstanding)} owed · ${formatCount(sum(r.loans.aging, (b) => b.count))} in arrears`,
                color: SKY,
              },
              {
                label: "Hire purchase",
                figure: `${formatCount(r.hp.contracts)} contracts`,
                detail: `${gh(r.hp.outstanding)} owed · ${formatCount(r.hp.statuses[1].count)} behind`,
                color: SLATE,
              },
              {
                label: "Counter sales",
                figure: `${formatCount(r.sales.receipts)} receipts`,
                detail: `${gh(r.sales.total)} rung up · ${formatCount(r.sales.voided)} voided`,
                color: MIST,
              },
              {
                label: "Customers",
                figure: `${formatCount(r.customers.total)} active`,
                detail: `${formatCount(sum(r.customers.months, (m) => m.joined))} joined · ${formatCount(sum(r.customers.months, (m) => m.dormant))} went dormant`,
                color: "var(--tint-6-fg)",
              },
            ].map((row) => (
              <li key={row.label} className="flex items-center gap-3 py-2.5">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: row.color }}
                  aria-hidden
                />
                <span className="w-28 shrink-0 font-medium">{row.label}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {row.detail}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {row.figure}
                </span>
              </li>
            ))}
          </ul>
        </ReportCard>
      </Row>
    </>
  );
}

/* -------------------------------------------------------------------- susu --- */

function SusuTab({ r }: TabProps) {
  const collected = sum(r.susu.months, (m) => m.inflow);
  const paidOut = sum(r.susu.months, (m) => m.outflow);
  return (
    <>
      <Tiles
        items={[
          {
            value: formatCount(r.susu.accounts),
            label: "Active accounts",
            icon: IdCardIcon,
            tint: 2,
            hint: "In a running cycle",
          },
          {
            value: gh(r.susu.valueHeld),
            label: "Held for customers",
            icon: WalletIcon,
            tint: 3,
            hint: "Owed back at payout",
          },
          {
            value: gh(collected),
            label: "Collected this period",
            icon: BanknoteIcon,
            tint: 1,
            hint: `${gh(paidOut)} paid out`,
          },
          {
            value: formatCount(r.susu.payoutsDue.count),
            label: "Payouts due",
            icon: CalendarCheckIcon,
            tint: 6,
            hint: `${gh(r.susu.payoutsDue.amount)} to pay`,
          },
        ]}
      />
      <Row split="wide-left">
        <ReportCard
          eyebrow="Susu"
          title="Collections against payouts"
          detailTo="/susu/summary"
          aside={
            <Legend
              items={[
                { label: "Collected", color: CORAL },
                { label: "Paid out", color: NAVY },
              ]}
            />
          }
          note="A day's collection is what the collectors recorded, whether or not the office has confirmed it yet. Payouts are cycles closed and handed back, less the first-day commission."
        >
          <PairedColumns
            points={bookPoints(r.susu.months)}
            series={[
              { key: "inflow", label: "Collected", color: CORAL },
              { key: "outflow", label: "Paid out", color: NAVY },
            ]}
            height={220}
            ariaLabel="Susu collected against paid out, month by month"
          />
        </ReportCard>
        <div className="space-y-4">
          <ReportCard
            eyebrow="Susu"
            title="A typical week"
            note="Collected per weekday, averaged over the period. Saturday is a half day for most rounds; Sunday is not worked."
          >
            <WeekdayBars values={r.susu.collectedPerDay} />
          </ReportCard>
          <ReportCard
            eyebrow="Susu"
            title="Where the cycles are"
            detailTo="/susu"
            detailLabel="Open the book"
            note="Every active account by how far into its 31-day cycle it is. The coral part is money the office should be ready to hand back."
          >
            <SegmentBar
              parts={[
                {
                  label: "Days 1–10",
                  value: r.susu.cycles[0].count,
                  color: SKY,
                },
                {
                  label: "Days 11–20",
                  value: r.susu.cycles[1].count,
                  color: NAVY,
                },
                {
                  label: "Days 21–30",
                  value: r.susu.cycles[2].count,
                  color: SLATE,
                },
                {
                  label: "Complete, awaiting payout",
                  value: r.susu.cycles[3].count,
                  color: CORAL,
                },
                {
                  label: "Paid out this period",
                  value: r.susu.cycles[4].count,
                  color: MIST,
                },
              ]}
              format={(v) => `${formatCount(v)} acc.`}
            />
          </ReportCard>
        </div>
      </Row>
    </>
  );
}

/* ----------------------------------------------------------------- savings --- */

function SavingsTab({ r }: TabProps) {
  const deposits = sum(r.savings.months, (m) => m.inflow);
  const withdrawals = sum(r.savings.months, (m) => m.outflow);
  return (
    <>
      <Tiles
        items={[
          {
            value: formatCount(r.savings.accounts),
            label: "Accounts",
            icon: IdCardIcon,
            tint: 3,
          },
          {
            value: gh(r.savings.balance),
            label: "Balance held",
            icon: WalletIcon,
            tint: 1,
            hint: "Owed to savers at month end",
          },
          {
            value: gh(deposits),
            label: "Deposits",
            icon: ArrowDownToLineIcon,
            tint: 1,
          },
          {
            value: gh(withdrawals),
            label: "Withdrawals",
            icon: ArrowUpFromLineIcon,
            tint: 2,
            hint: `net ${gh(deposits - withdrawals)}`,
          },
        ]}
      />
      <Row>
        <ReportCard
          eyebrow="Savings"
          title="Closing balance, month end"
          detailTo="/savings"
          detailLabel="Open savings"
          note="What the branch owes its savers at the end of each month. It only ever moves by deposits less withdrawals; fees are taken out of the withdrawal and appear in revenue."
        >
          <AreaLine
            points={r.savings.months.map((m, i) => ({
              key: m.key,
              label: m.label,
              value: r.savings.balances[i],
            }))}
            color={NAVY}
            gradientId="savings-fill"
            format={gh}
            baseline={Math.min(...r.savings.balances) * 0.92}
            height={220}
            ariaLabel="Savings balance held, month by month"
          />
        </ReportCard>
        <ReportCard
          eyebrow="Savings"
          title="Deposits against withdrawals"
          aside={
            <Legend
              items={[
                { label: "Deposits", color: NAVY },
                { label: "Withdrawals", color: CORAL },
              ]}
            />
          }
          note="* The running month is drawn faint: it is not over yet."
        >
          <PairedColumns
            points={bookPoints(r.savings.months)}
            series={[
              { key: "inflow", label: "Deposits", color: NAVY },
              { key: "outflow", label: "Withdrawals", color: CORAL },
            ]}
            height={220}
            ariaLabel="Savings deposits against withdrawals, month by month"
          />
        </ReportCard>
      </Row>
    </>
  );
}

/* ------------------------------------------------------------------- loans --- */

function LoansTab({ r }: TabProps) {
  const arrears = sum(r.loans.aging, (b) => b.amount);
  const late = sum(r.loans.aging, (b) => b.count);
  const peak = Math.max(1, ...r.loans.aging.map((b) => b.amount));
  const fill = ["bg-warning/55", "bg-warning", "bg-danger/70", "bg-danger"];
  return (
    <>
      <Tiles
        items={[
          {
            value: formatCount(r.loans.open),
            label: "Open loans",
            icon: LandmarkIcon,
            tint: 3,
          },
          {
            value: gh(r.loans.outstanding),
            label: "Still owed",
            icon: WalletIcon,
            tint: 1,
          },
          {
            value: gh(arrears),
            label: "In arrears",
            icon: CircleAlertIcon,
            tint: 2,
            hint: `${formatCount(late)} loans late`,
          },
          {
            value: formatPercent(r.kpis.par30),
            label: "Portfolio at risk (30+)",
            icon: ScaleIcon,
            tint: 6,
            delta: {
              text: `${r.kpis.par30Delta <= 0 ? "▼" : "▲"} ${Math.abs(r.kpis.par30Delta * 100).toFixed(1)} pts on last month`,
              good: r.kpis.par30Delta <= 0,
            },
          },
        ]}
      />
      <Row>
        <ReportCard
          eyebrow="Loans"
          title="Disbursed against repaid"
          detailTo="/loans"
          detailLabel="Open the book"
          aside={
            <Legend
              items={[
                { label: "Disbursed", color: SKY },
                { label: "Repaid", color: NAVY },
              ]}
            />
          }
          note="Repayments are principal and interest together, as they arrive at the counter. * The running month is drawn faint."
        >
          <PairedColumns
            points={bookPoints(r.loans.months).map((p) => ({
              ...p,
              values: { out: p.values.outflow, in: p.values.inflow },
            }))}
            series={[
              { key: "out", label: "Disbursed", color: SKY },
              { key: "in", label: "Repaid", color: NAVY },
            ]}
            height={220}
            ariaLabel="Loans disbursed against repaid, month by month"
          />
        </ReportCard>
        <ReportCard
          eyebrow="Loans"
          title="Portfolio at risk, 30+ days"
          note="The whole remaining balance of any loan more than 30 days late, as a share of the open book — not just the missed instalments. The usual microfinance reading."
        >
          <AreaLine
            points={r.loans.months.map((m, i) => ({
              key: m.key,
              label: m.label,
              value: r.loans.parTrend[i],
            }))}
            color={CORAL}
            gradientId="par-fill"
            format={(v) => formatPercent(v)}
            baseline={Math.min(...r.loans.parTrend) * 0.7}
            height={220}
            ariaLabel="Portfolio at risk over 30 days, month by month"
          />
        </ReportCard>
      </Row>
      <Row split="wide-right">
        <ReportCard
          eyebrow="Loans"
          title="Arrears by age"
          detailTo="/reports/loans"
          note="A position as at now, not a period. The colour deepens with age, but every bucket carries its figure and its count."
        >
          <ul className="space-y-3.5">
            {r.loans.aging.map((b, i) => (
              <li key={b.key}>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="font-medium">{b.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    <span className="font-semibold text-foreground">
                      {formatPesewas(b.amount)}
                    </span>{" "}
                    · {formatCount(b.count)} {b.count === 1 ? "loan" : "loans"}
                  </span>
                </div>
                <div
                  className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
                  aria-hidden
                >
                  <div
                    className={cn("h-full rounded-full", fill[i])}
                    style={{ width: `${(b.amount / peak) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </ReportCard>
        <ReportCard
          eyebrow="Loans"
          title="Longest overdue"
          detailTo="/reports/loans"
          note="The six loans the office should be talking about this week, with the collector who signed each customer up."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[10.5px] text-muted-foreground">
                  <th className="pb-2 font-medium">Customer</th>
                  <th className="pb-2 font-medium">Collector</th>
                  <th className="pb-2 text-right font-medium">Principal</th>
                  <th className="pb-2 text-right font-medium">Still owing</th>
                  <th className="pb-2 pl-3 text-right font-medium">Late</th>
                  <th className="pb-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.loans.overdue.map((loan) => (
                  <tr
                    key={loan.id}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="py-2.5 pr-2 font-medium whitespace-nowrap">
                      {loan.customer}
                    </td>
                    <td className="py-2.5 pr-2 whitespace-nowrap text-muted-foreground">
                      {loan.collector}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap text-muted-foreground tabular-nums">
                      {formatPesewas(loan.principal)}
                    </td>
                    <td className="py-2.5 text-right font-semibold whitespace-nowrap tabular-nums">
                      {formatPesewas(loan.remaining)}
                    </td>
                    <td className="py-2.5 pl-3 text-right whitespace-nowrap">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                          loan.daysOverdue > 90
                            ? "bg-danger-subtle text-danger"
                            : "bg-warning-subtle text-warning",
                        )}
                      >
                        {loan.daysOverdue} days
                      </span>
                    </td>
                    <td className="py-2.5 pl-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          aria-label={`Actions for ${loan.customer}`}
                          className="inline-flex size-6 items-center justify-center rounded-full border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        >
                          <EllipsisIcon className="size-3.5" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to="/loans">Open the loan book</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link to="/reports/loans">Open loan portfolio</Link>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ReportCard>
      </Row>
    </>
  );
}

/* ----------------------------------------------------------- hire purchase --- */

function HirePurchaseTab({ r }: TabProps) {
  const s = r.hp.statuses;
  return (
    <>
      <Tiles
        items={[
          {
            value: formatCount(r.hp.contracts),
            label: "Open contracts",
            icon: PackageIcon,
            tint: 4,
          },
          {
            value: gh(r.hp.outstanding),
            label: "Still owed",
            icon: WalletIcon,
            tint: 1,
          },
          {
            value: formatCount(s[1].count),
            label: "Behind",
            icon: CircleAlertIcon,
            tint: 6,
            hint: `${gh(s[1].amount)} owed`,
          },
          {
            value: formatCount(s[2].count),
            label: "Defaulted",
            icon: CircleAlertIcon,
            tint: 2,
            hint: `${gh(s[2].amount)} owed`,
          },
        ]}
      />
      <Row split="wide-left">
        <ReportCard
          eyebrow="Hire purchase"
          title="Contracts by standing"
          detailTo="/hire-purchase"
          detailLabel="Open contracts"
          note="A contract is behind after one missed instalment and defaulted after three. Settled contracts carry no balance and are listed for the count."
        >
          <SegmentBar
            parts={[
              { label: "Paying on time", value: s[0].count, color: NAVY },
              { label: "Behind", value: s[1].count, color: "var(--warning)" },
              { label: "Defaulted", value: s[2].count, color: CORAL },
              { label: "Settled this period", value: s[3].count, color: MIST },
            ]}
            format={(v) => `${formatCount(v)}`}
          />
        </ReportCard>
        <ReportCard eyebrow="Hire purchase" title="What each standing owes">
          <dl className="divide-y divide-border/60 text-xs">
            {s.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between py-2.5"
              >
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="tabular-nums">
                  {row.amount > 0 ? (
                    <span className="font-semibold">
                      {formatPesewas(row.amount)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">no balance</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </ReportCard>
      </Row>
      <div className="mt-4">
        <ReportCard
          eyebrow="Hire purchase"
          title="Sold on hire purchase, by category"
          detailTo="/sales"
          detailLabel="Open the day book"
          note="The full contract value on the day of sale, not what has been paid so far."
        >
          <RankedBars
            rows={[...r.sales.categories]
              .filter((c) => c.hp > 0)
              .sort((a, b) => b.hp - a.hp)
              .map((c) => ({
                key: c.category,
                label: c.category,
                sub: `${formatCount(c.units)} units in all`,
                value: c.hp,
                trailing: null,
              }))}
            colors={{ outer: SKY }}
          />
        </ReportCard>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- sales --- */

function SalesTab({ r }: TabProps) {
  const outright = sum(r.sales.categories, (c) => c.outright);
  const hp = sum(r.sales.categories, (c) => c.hp);
  return (
    <>
      <Tiles
        items={[
          {
            value: formatCount(r.sales.receipts),
            label: "Receipts",
            icon: ReceiptIcon,
            tint: 4,
            hint: `${formatCount(r.sales.voided)} voided`,
          },
          {
            value: gh(outright),
            label: "Sold outright",
            icon: BanknoteIcon,
            tint: 3,
          },
          {
            value: gh(hp),
            label: "Sold on hire purchase",
            icon: PackageIcon,
            tint: 1,
          },
          {
            value: gh(sum(r.revenue, (m) => m.salesMargin)),
            label: "Margin kept",
            icon: CoinsIcon,
            tint: 5,
            hint: "Price less cost, outright sales",
          },
        ]}
      />
      <Row split="wide-left">
        <ReportCard
          eyebrow="Counter sales"
          title="What sold, and how it was paid"
          detailTo="/sales"
          detailLabel="Open the day book"
          aside={
            <Legend
              items={[
                { label: "Outright", color: NAVY },
                { label: "On hire purchase", color: SKY },
              ]}
            />
          }
          note="Voided receipts are left out of every figure. Hire-purchase sales count the full contract value on the day of sale."
        >
          <RankedBars
            rows={[...r.sales.categories]
              .sort((a, b) => b.outright + b.hp - a.outright - a.hp)
              .map((c) => ({
                key: c.category,
                label: c.category,
                sub: `${formatCount(c.units)} units`,
                value: c.outright + c.hp,
                inner: c.outright,
                trailing: (
                  <span className="text-[10.5px] text-muted-foreground">
                    {c.hp > 0
                      ? `${((c.hp / (c.outright + c.hp)) * 100).toFixed(0)}% HP`
                      : "cash only"}
                  </span>
                ),
              }))}
            colors={{ outer: SKY, inner: NAVY }}
          />
        </ReportCard>
        <ReportCard eyebrow="Counter sales" title="Cash against credit">
          <SegmentBar
            parts={[
              { label: "Outright", value: outright, color: NAVY },
              { label: "On hire purchase", value: hp, color: SKY },
            ]}
            format={gh}
          />
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            {((hp / Math.max(1, outright + hp)) * 100).toFixed(0)}% of what left
            the shelf this period is still being paid for. That share is the
            shop's exposure to the hire-purchase book.
          </p>
        </ReportCard>
      </Row>
      <div className="mt-4">
        <ReportCard
          eyebrow="Counter sales"
          title="Rung up, month by month"
          detailTo="/inventory"
          detailLabel="Open inventory"
        >
          <StackedColumns
            points={r.flow.map((m) => ({
              key: m.key,
              label: m.label,
              partial: m.partial,
              values: { sales: m.sales },
            }))}
            series={[{ key: "sales", label: "Counter sales", color: MIST }]}
            width={960}
            height={210}
            ariaLabel="Counter sales, month by month"
          />
        </ReportCard>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- staff --- */

function StaffTab({ r }: TabProps) {
  const ranked = [...r.staff].sort((a, b) => b.recorded - a.recorded);
  const recorded = sum(r.staff, (s) => s.recorded);
  const confirmed = sum(r.staff, (s) => s.confirmed);
  const collectors = r.staff.filter((s) => s.role === "collector").length;
  return (
    <>
      <Tiles
        items={[
          {
            value: formatCount(collectors),
            label: "Collectors on rounds",
            icon: UsersIcon,
            tint: 3,
            hint: `${formatCount(r.staff.length - collectors)} tellers at the counter`,
          },
          {
            value: gh(recorded),
            label: "Recorded in the field",
            icon: BanknoteIcon,
            tint: 2,
          },
          {
            value: gh(confirmed),
            label: "Confirmed by the office",
            icon: CalendarCheckIcon,
            tint: 1,
          },
          {
            value: formatPercent(confirmed / Math.max(1, recorded)),
            label: "Match rate",
            icon: PercentIcon,
            tint: 6,
            hint: "Confirmed ÷ recorded",
          },
        ]}
      />
      <Row split="wide-left">
        <ReportCard
          eyebrow="Staff"
          title="Collections by staff"
          detailTo="/reports/collections"
          aside={
            <Legend
              items={[
                { label: "Recorded", color: CORAL },
                { label: "Confirmed by the office", color: NAVY },
              ]}
            />
          }
          note="Susu and savings deposits grouped by whoever recorded them. The inner bar is what the office counted on handover; the gap is that person's variance over the period."
        >
          <RankedBars
            rows={ranked.map((s) => {
              const rate = s.recorded > 0 ? s.confirmed / s.recorded : 1;
              return {
                key: s.id,
                label: s.name,
                sub: `${s.role === "collector" ? "Collector" : "Teller"} · ${formatCount(s.customers)} customers`,
                value: s.recorded,
                inner: s.confirmed,
                trailing: (
                  <span
                    className={cn(
                      "text-[10.5px] font-medium",
                      rate < 0.97 ? "text-danger" : "text-muted-foreground",
                    )}
                  >
                    {(rate * 100).toFixed(1)}%
                  </span>
                ),
              };
            })}
            colors={{ outer: CORAL, inner: NAVY }}
          />
        </ReportCard>
        <ReportCard
          eyebrow="Staff"
          title="Days reconciled"
          note="Collector days the office has confirmed, out of the days each person worked. An unreconciled day is cash nobody has counted yet."
        >
          <ul className="space-y-3">
            {ranked.map((s) => (
              <li key={s.id} className="text-xs">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    <span className="font-semibold text-foreground">
                      {formatCount(s.daysReconciled)}
                    </span>{" "}
                    / {formatCount(s.daysWorked)}
                  </span>
                </div>
                <div
                  className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(s.daysReconciled / Math.max(1, s.daysWorked)) * 100}%`,
                      background: NAVY,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </ReportCard>
      </Row>
    </>
  );
}

/* ---------------------------------------------------------------- handover --- */

function HandoverTab({ r }: TabProps) {
  const cells = r.handover.rows
    .flatMap((row) => row.cells)
    .filter((c) => c.variance !== null);
  const exact = cells.filter((c) => c.variance === 0).length;
  const short = cells.filter((c) => (c.variance ?? 0) < 0).length;
  const shortBy = sum(cells, (c) => Math.min(0, c.variance ?? 0));
  return (
    <>
      <Tiles
        items={[
          {
            value: `${r.kpis.handoverVariance < 0 ? "−" : "+"}${gh(Math.abs(r.kpis.handoverVariance))}`,
            label: "Net variance, period",
            icon: HandCoinsIcon,
            tint: 2,
            hint: `across ${formatCount(r.kpis.handoverDays)} reconciled days`,
          },
          {
            value: formatCount(exact),
            label: "Exact handovers, 14 days",
            icon: CalendarCheckIcon,
            tint: 3,
            hint: `of ${formatCount(cells.length)} counted`,
          },
          {
            value: formatCount(short),
            label: "Short handovers, 14 days",
            icon: CircleAlertIcon,
            tint: 6,
            hint: `${gh(Math.abs(shortBy))} short in all`,
          },
          {
            value: formatPercent(exact / Math.max(1, cells.length)),
            label: "Exact rate",
            icon: PercentIcon,
            tint: 1,
          },
        ]}
      />
      <div className="mt-4">
        <ReportCard
          eyebrow="Cash handover"
          title="Handover variance, last 14 days"
          detailTo="/reconciliation"
          detailLabel="Open reconciliation"
          note="One mark per collector per day: what the office counted against what was recorded. A run of coral down one column is a day the whole round went wrong; a run along one row is a collector to talk to."
        >
          <HandoverGrid
            days={r.handover.days}
            rows={r.handover.rows.map((row) => ({
              key: row.staffId,
              label: row.name,
              cells: row.cells,
              total: row.cells.reduce((n, c) => n + (c.variance ?? 0), 0),
            }))}
          />
        </ReportCard>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- customers --- */

function CustomersTab({ r }: TabProps) {
  const joined = sum(r.customers.months, (m) => m.joined);
  const dormant = sum(r.customers.months, (m) => m.dormant);
  const points: ColumnPoint[] = r.customers.months.map((m) => ({
    key: m.key,
    label: m.label,
    partial: m.partial,
    values: { joined: m.joined, dormant: m.dormant },
  }));
  return (
    <>
      <Tiles
        items={[
          {
            value: formatCount(r.customers.total),
            label: "Active customers",
            icon: UsersIcon,
            tint: 3,
          },
          {
            value: formatCount(joined),
            label: "Joined",
            icon: UserPlusIcon,
            tint: 1,
          },
          {
            value: formatCount(dormant),
            label: "Went dormant",
            icon: UserMinusIcon,
            tint: 2,
            hint: "60 days without activity",
          },
          {
            value: formatCount(
              r.customers.byProduct[3].count + r.customers.byProduct[4].count,
            ),
            label: "On credit",
            icon: LandmarkIcon,
            tint: 6,
            hint: "A loan or a hire-purchase contract",
          },
        ]}
      />
      <Row>
        <ReportCard
          eyebrow="Customers"
          title="Joined against gone quiet"
          detailTo="/customers"
          detailLabel="Open customers"
          aside={
            <Legend
              items={[
                { label: "Joined", color: SKY },
                { label: "Went dormant", color: SLATE },
              ]}
            />
          }
          note="A customer is dormant after 60 days without a deposit, a repayment or a purchase. They stay on the books; a dormant account is not a closed one."
        >
          <PairedColumns
            points={points}
            series={[
              { key: "joined", label: "Joined", color: SKY },
              { key: "dormant", label: "Dormant", color: SLATE },
            ]}
            height={220}
            format={formatCount}
            ariaLabel="Customers joined against gone dormant, month by month"
          />
        </ReportCard>
        <ReportCard
          eyebrow="Customers"
          title="What customers hold"
          note="Each customer counted once, under the most they hold."
        >
          <SegmentBar
            parts={[
              {
                label: "Susu only",
                value: r.customers.byProduct[0].count,
                color: CORAL,
              },
              {
                label: "Savings only",
                value: r.customers.byProduct[1].count,
                color: NAVY,
              },
              {
                label: "Susu and savings",
                value: r.customers.byProduct[2].count,
                color: SLATE,
              },
              {
                label: "With a loan",
                value: r.customers.byProduct[3].count,
                color: SKY,
              },
              {
                label: "Hire purchase",
                value: r.customers.byProduct[4].count,
                color: MIST,
              },
            ]}
            format={(v) => formatCount(v)}
          />
        </ReportCard>
      </Row>
    </>
  );
}

/* ----------------------------------------------------------------- revenue --- */

function RevenueTab({ r }: TabProps) {
  const by = (pick: (m: (typeof r.revenue)[number]) => number) =>
    sum(r.revenue, pick);
  const points: ColumnPoint[] = r.revenue.map((m) => ({
    key: m.key,
    label: m.label,
    partial: m.partial,
    values: {
      interest: m.loanInterest,
      commission: m.susuCommission,
      margin: m.salesMargin,
      fees: m.savingsFees,
    },
  }));
  const parts = [
    { label: "Loan interest", value: by((m) => m.loanInterest), color: NAVY },
    {
      label: "Susu commission",
      value: by((m) => m.susuCommission),
      color: CORAL,
    },
    { label: "Sales margin", value: by((m) => m.salesMargin), color: SKY },
    { label: "Savings fees", value: by((m) => m.savingsFees), color: SLATE },
  ];
  return (
    <>
      <Tiles
        items={[
          {
            value: gh(parts[0].value),
            label: "Loan interest",
            icon: LandmarkIcon,
            tint: 3,
          },
          {
            value: gh(parts[1].value),
            label: "Susu commission",
            icon: HandCoinsIcon,
            tint: 2,
            hint: "First day of each cycle",
          },
          {
            value: gh(parts[2].value),
            label: "Sales margin",
            icon: ShoppingBagIcon,
            tint: 1,
            hint: "Outright sales only",
          },
          {
            value: gh(parts[3].value),
            label: "Savings fees",
            icon: CoinsIcon,
            tint: 4,
            hint: "Per withdrawal",
          },
        ]}
      />
      <Row split="wide-left">
        <ReportCard
          eyebrow="Revenue"
          title="What the branch kept, month by month"
          detailTo="/reports/commission"
          aside={
            <Legend
              items={parts.map((p) => ({ label: p.label, color: p.color }))}
            />
          }
          note="Loan interest is what is earned as instalments arrive, not what is written into the schedule. * The running month is drawn faint."
        >
          <StackedColumns
            points={points}
            series={[
              { key: "interest", label: "Loan interest", color: NAVY },
              { key: "commission", label: "Susu commission", color: CORAL },
              { key: "margin", label: "Sales margin", color: SKY },
              { key: "fees", label: "Savings fees", color: SLATE },
            ]}
            height={236}
            ariaLabel="Revenue by source, month by month"
          />
        </ReportCard>
        <ReportCard
          eyebrow="Revenue"
          title="Where it came from"
          note={`${gh(r.kpis.revenue)} in all — ${signed(r.kpis.revenueDelta)} on the previous month.`}
        >
          <SegmentBar parts={parts} format={gh} />
        </ReportCard>
      </Row>
    </>
  );
}
