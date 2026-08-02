import { useMemo } from "react";
import { data, Link, useNavigation } from "react-router";
import {
  ArrowRight,
  Banknote,
  Building2,
  CalendarClock,
  Coins,
  Gauge,
  HandCoins,
  KeyRound,
  PiggyBank,
  Smartphone,
  Users,
} from "lucide-react";
import type { Route } from "./+types/dashboard";
import { SHEEN } from "~/components/account-card";
import {
  BarList,
  Delta,
  Donut,
  FlowChart,
  Meter,
  StackedBars,
  TrendChart,
} from "~/components/charts";
import { DataTable, Table } from "~/components/data-table";
import { Kpi, PANEL, PANEL_TITLE } from "~/components/kpi";
import {
  buildPortfolio,
  byCollector,
  compactGhs,
  monthKey,
  monthLabel,
  monthTitle,
  payoutsByMonth,
  payoutsOnDay,
  payoutsWithin,
  percentChange,
  shiftDay,
  splitBySource,
  uncollectedToday,
  type CollectorDay,
  type FlowPoint,
} from "~/lib/analytics";
import {
  sampleChannels,
  sampleSavingsDay,
  sampleSourceWeek,
  sampleTellers,
  sampleWeeklyInflows,
  sampleYear,
  SAMPLE_NOTICE,
  type SampleSavingsDay,
  type SampleTeller,
} from "~/lib/sample-data";
import { CEDI, formatGhs } from "~/lib/money";
import { accraToday, formatDate, formatDayLine, formatTime } from "~/lib/format";
import * as customersApi from "~/lib/api/customers";
import * as savingsApi from "~/lib/api/savings";
import * as susuApi from "~/lib/api/susu";
import * as usersApi from "~/lib/api/users";
import { type SusuAccount } from "~/lib/susu-client";
import { ROLE_LABELS, type Role } from "~/lib/auth-client";
import { isOffice, requireUser, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Dashboard · YADAH Dynamic Enterprise" }];
}

/** The API's page ceiling for the account lists, and how many pages we pull. */
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

/** Rows in the outstanding-accounts panel, and so customer names to look up. */
const OUTSTANDING_SHOWN = 8;

/** How far ahead the payouts KPI looks, in collecting days. */
const PAYOUT_WINDOW = 7;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** How many years back a `?year=` on the URL may reach. */
const YEARS_BACK = 2;

async function fetchAll<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; total: number }>,
): Promise<{ items: T[]; total: number; truncated: boolean }> {
  const first = await fetchPage(1);
  const pages = Math.min(MAX_PAGES, Math.ceil(first.total / PAGE_SIZE));
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => fetchPage(i + 2)),
  );
  const items = [first.items, ...rest.map((r) => r.items)].flat();
  return { items, total: first.total, truncated: items.length < first.total };
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const office = isOffice(user);
  const today = accraToday();

  const sp = new URL(request.url).searchParams;
  const asked = sp.get("date")?.trim() ?? "";
  const date = DATE_RE.test(asked) && asked <= today ? asked : today;

  const thisYear = Number(today.slice(0, 4));
  const years = Array.from({ length: YEARS_BACK + 1 }, (_, i) => thisYear - i);
  const askedYear = Number(sp.get("year"));
  const year = years.includes(askedYear) ? askedYear : thisYear;

  const collectorId = office ? sp.get("collector")?.trim() || undefined : undefined;

  const { data: result, headers } = await withAuth(request, async (token) => {
    const [summary, previous, susu, savings, customers, staff] =
      await Promise.all([
        susuApi.getSusuSummary(token, { date, collectorId }),
        susuApi.getSusuSummary(token, {
          date: shiftDay(date, -1),
          collectorId,
        }),
        fetchAll((page) =>
          susuApi.listSusuAccounts(token, { page, limit: PAGE_SIZE }),
        ),
        fetchAll((page) =>
          savingsApi.listSavingsAccounts(token, { page, limit: PAGE_SIZE }),
        ),
        customersApi.listCustomers(token, { status: "active", limit: 1 }),
        office
          ? usersApi.listUsers(token, { status: "active", limit: PAGE_SIZE })
          : null,
      ]);

    const outstanding = uncollectedToday(
      susu.items,
      summary.deposits,
      OUTSTANDING_SHOWN,
    );

    const ids = [
      ...new Set(outstanding.accounts.map((account) => account.customerId)),
    ];
    const names = new Map(
      await Promise.all(
        ids.map((id) =>
          customersApi
            .getCustomer(token, id)
            .then((r) => [id, r.customer.fullName] as const)
            .catch(() => [id, null] as const),
        ),
      ),
    );

    return { summary, previous, susu, savings, customers, staff, outstanding, names };
  });

  const { summary, previous, susu, savings, staff } = result;

  const scope = office ? (collectorId ?? "all") : user.id;
  const points: FlowPoint[] = sampleYear(year, scope).map((month) => ({
    key: month.key,
    label: monthLabel(month.key),
    title: monthTitle(month.key),
    collected: month.collected,
    paidOut: month.paidOut,
    depositCount: month.depositCount,
  }));

  const paidOut = payoutsByMonth(susu.items);
  const thisMonth = monthKey(date);
  const lastMonth = monthKey(shiftDay(`${thisMonth}-01`, -1));
  const paidThisMonth = paidOut.get(thisMonth) ?? 0;
  const paidLastMonth = paidOut.get(lastMonth) ?? 0;
  const paidToday = payoutsOnDay(susu.items, date);
  const soon = payoutsWithin(susu.items, PAYOUT_WINDOW);

  const collectors = (staff?.items ?? []).filter((u) => u.role === "collector");
  const collectorIds = new Set(collectors.map((c) => c.id));

  const portfolio = buildPortfolio(susu.items, savings.items);
  const outstanding = result.outstanding;

  const gapPercent =
    portfolio.expectedDaily > 0
      ? Math.round((outstanding.expected / portfolio.expectedDaily) * 1000) / 10
      : 0;

  const sourceWeek = sampleSourceWeek(date, scope);

  return data(
    {
      user,
      greeting: greetingFor(new Date().getUTCHours()),
      summary,
      points,
      collectors: collectors.map((c) => ({ id: c.id, name: c.name })),
      canManage: office,
      today,
      year,
      years,
      monthLabel: monthTitle(thisMonth),
      payoutWindow: PAYOUT_WINDOW,
      showPayouts: office && !collectorId,
      stats: {
        collectedToday: summary.totalCollected,
        collectedYesterday: previous.totalCollected,
        dayChange: percentChange(summary.totalCollected, previous.totalCollected),
        paidThisMonth,
        paidLastMonth,
        paidChange: percentChange(paidThisMonth, paidLastMonth),
        paidToday: paidToday.amount,
        payoutsToday: paidToday.count,
        payoutsSoon: soon,
        activeCustomers: result.customers.total,
        // Real: who recorded the deposit says where it was taken.
        source: splitBySource(summary.deposits, collectorIds),
        gapPercent,
      },
      portfolio,
      outstanding: {
        total: outstanding.total,
        expected: outstanding.expected,
        accounts: outstanding.accounts.map((account) => ({
          account,
          name: result.names.get(account.customerId) ?? null,
        })),
      },
      /** Office only: the day split by who took it, and who took nothing. */
      collectorDays: office
        ? byCollector(
          summary.deposits,
          collectors.map((c) => ({ id: c.id, name: c.name })),
        )
        : null,
      passwordsOutstanding: (staff?.items ?? [])
        .filter((u) => u.mustChangePassword)
        .map((u) => ({ id: u.id, name: u.name, role: u.role })),

      // Invented, every one of them. Each is drawn under a `SampleChip`.
      savingsDay: sampleSavingsDay(date),
      weekly: sampleWeeklyInflows(date, scope),
      sourceWeek,
      channels: sampleChannels(thisMonth, scope),
      tellers: office ? sampleTellers(date) : [],

      limits: { accounts: susu.truncated || savings.truncated },
      filters: { date, collector: collectorId ?? "" },
    },
    { headers },
  );
}

/** Ghana is UTC+0, so the server's UTC hour is the user's hour. */
function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const HERO_FACE = {
  backgroundImage: [
    "linear-gradient(112deg, transparent 44%, color-mix(in oklab, var(--color-leaf) 10%, transparent) 47%, transparent 55%)",
    "linear-gradient(112deg, transparent 62%, color-mix(in oklab, var(--color-teal-dark) 9%, transparent) 65%, transparent 73%)",
    "radial-gradient(120% 150% at 94% 4%, color-mix(in oklab, var(--color-leaf-light) 16%, transparent), transparent 62%)",
    "linear-gradient(100deg, color-mix(in oklab, var(--color-leaf) 21%, transparent), color-mix(in oklab, var(--color-teal) 12%, transparent) 46%, color-mix(in oklab, var(--color-teal-light) 5%, transparent) 78%, transparent)",
  ].join(","),
};

const TONE = {
  susu: "navy",
  savings: "teal",
  counter: "gold",
  round: "green",
} as const;

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const {
    user,
    greeting,
    summary,
    points,
    collectors,
    canManage,
    today,
    year,
    monthLabel: currentMonth,
    payoutWindow,
    showPayouts,
    stats,
    portfolio,
    outstanding,
    collectorDays,
    passwordsOutstanding,
    savingsDay,
    weekly,
    sourceWeek,
    channels,
    tellers,
    limits,
    filters,
  } = loaderData;

  const navigation = useNavigation();

  const collectorNames = new Map(collectors.map((c) => [c.id, c.name]));
  const isToday = summary.date === today;
  const loading = navigation.state === "loading";

  const rows = useMemo(
    () => [...summary.deposits].sort((a, b) => b.at.localeCompare(a.at)),
    [summary.deposits],
  );

  return (
    <div className="mx-auto w-full px-4 py-6 sm:px-6 sm:py-8">
      <section
        aria-label="Greeting"
        className="relative mb-6 overflow-hidden rounded-xl border-2 border-success/40 bg-surface shadow-none dark:bg-canvas"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={HERO_FACE}
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-88 sm:block"
        >
          <span className="absolute -right-24 top-1/2 size-72 -translate-y-1/2 rounded-full border-2 border-teal/25" />
          <span className="absolute -right-14 top-1/2 size-52 -translate-y-1/2 rounded-full bg-linear-to-br from-leaf/25 via-teal/20 to-teal-light/5" />
          <span className="absolute -right-4 top-1/2 size-28 -translate-y-1/2 rounded-full border-2 border-leaf-light/30" />
          <span className="absolute right-28 top-7 size-1.5 rounded-full bg-gold" />
        </div>

        <div className="relative flex flex-wrap items-center justify-between gap-5 px-5 py-6 sm:px-7 sm:py-7">
          <div className="min-w-0">
            <p className="font-heading text-xs font-bold uppercase tracking-[0.18em] text-teal-dark dark:text-teal-light">
              {formatDayLine(summary.date)}
            </p>
            <h1 className="mt-2 font-heading text-2xl font-semibold text-foreground sm:text-3xl">
              {greeting}, {user.name.split(" ")[0]}.
            </h1>
            <p className="mt-1.5 text-sm text-muted">
              {ROLE_LABELS[user.role]}
            </p>
          </div>

          <Link
            to="/customers"
            className="flex min-h-9 shrink-0 items-center gap-2 rounded-full border-2 border-border bg-surface px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-success hover:text-teal-dark dark:hover:text-teal-light"
          >
            <Users size={14} className="text-success" />
            Customers
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {limits.accounts && (
        <p className="mb-4 rounded-lg border-2 border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          Showing the first {MAX_PAGES * PAGE_SIZE} accounts. Totals below are a
          floor.
        </p>
      )}

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi
          icon={<Coins size={14} />}
          label="Under management"
          value={formatGhs(portfolio.total)}
          foot={
            <p className="mt-0.5 text-xs text-muted">
              <Figure>
                {portfolio.susuAccounts + portfolio.savingsAccounts}
              </Figure>{" "}
              accounts
            </p>
          }
        />
        <Kpi
          icon={<Users size={14} />}
          label="Active customers"
          value={String(stats.activeCustomers)}
          foot={
            <p className="mt-0.5 text-xs text-muted">
              <Figure>{portfolio.susuAccounts}</Figure> susu ·{" "}
              <Figure>{portfolio.savingsAccounts}</Figure> savings
            </p>
          }
        />
        <Kpi
          icon={<HandCoins size={14} />}
          label={isToday ? "Collected today" : "Collected"}
          value={formatGhs(stats.collectedToday)}
          foot={
            <Delta
              change={stats.dayChange}
              caption="vs the day before"
              fallback={
                stats.collectedYesterday === 0
                  ? "Nothing the day before"
                  : undefined
              }
            />
          }
        />
        <Kpi
          icon={<Banknote size={14} />}
          label={isToday ? "Paid out today" : "Paid out"}
          value={formatGhs(stats.paidToday)}
          foot={
            <p className="mt-0.5 text-xs text-muted">
              <Figure>{stats.payoutsToday}</Figure> closed
            </p>
          }
        />
        <Kpi
          icon={<CalendarClock size={14} />}
          label={`Due in ${payoutWindow} days`}
          value={formatGhs(stats.payoutsSoon.amount)}
          foot={
            <p className="mt-0.5 text-xs text-muted">
              <Figure>{stats.payoutsSoon.count}</Figure>{" "}
              {stats.payoutsSoon.count === 1 ? "cycle" : "cycles"}
            </p>
          }
        />
        <Kpi
          icon={<Gauge size={14} />}
          label="Round still out"
          value={`${stats.gapPercent}%`}
          foot={
            <p className="mt-0.5 text-xs text-muted">
              <Figure>{compactGhs(outstanding.expected)}</Figure> of{" "}
              {compactGhs(portfolio.expectedDaily)}
            </p>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <section className={`${PANEL} p-5`} aria-label="Money in by day">
            <PanelHead
              title="Money in, by day"
              subtitle="Susu against savings"
              sample
              aside={
                <p className="text-right text-xs text-muted">
                  This week
                  <span className="ml-1.5 font-sen font-semibold tabular-nums text-foreground">
                    {compactGhs(
                      weekly.series.reduce(
                        (sum, s) => sum + s.data.reduce((a, b) => a + b, 0),
                        0,
                      ),
                    )}
                  </span>
                </p>
              }
            />
            <TrendChart
              labels={weekly.labels}
              titles={weekly.dates.map((day) => formatDate(day))}
              series={weekly.series.map((s) => ({
                key: s.key,
                label: s.label,
                data: s.data,
                tone: s.key === "susu" ? TONE.susu : TONE.savings,
                area: true,
              }))}
            />
          </section>
          <section className={`${PANEL} p-5`} aria-label="Collections analytics">
            <PanelHead
              title="Collections"
              subtitle={String(year)}
              sample
              aside={
                <p className="text-right text-xs text-muted">
                  Best month
                  <span className="ml-1.5 font-sen font-semibold tabular-nums text-foreground">
                    {compactGhs(
                      points.reduce((max, p) => Math.max(max, p.collected), 0),
                    )}
                  </span>
                </p>
              }
            />

            <FlowChart
              points={points}
              primaryLabel="Collected"
              secondaryLabel={showPayouts ? "Paid out" : undefined}
            />
          </section>

          <section className={`${PANEL} p-5`} aria-label="Counter against round">
            <PanelHead
              title="Counter against round"
              subtitle="Where the money was taken"
              sample
              aside={
                <p className="text-right text-xs text-muted">
                  {isToday ? "Today" : formatDate(summary.date)}
                  <span className="ml-1.5 font-sen font-semibold tabular-nums text-foreground">
                    {compactGhs(stats.source.office + stats.source.field)}
                  </span>
                </p>
              }
            />
            <StackedBars
              labels={sourceWeek.map((day) => day.label)}
              titles={sourceWeek.map((day) => formatDate(day.date))}
              target={sourceWeek.map((day) => day.expected)}
              targetLabel="A full round"
              grouped
              series={[
                {
                  key: "office",
                  label: "Counter",
                  data: sourceWeek.map((day) => day.office),
                  tone: TONE.counter,
                },
                {
                  key: "field",
                  label: "Round",
                  data: sourceWeek.map((day) => day.field),
                  tone: TONE.round,
                },
              ]}
            />
          </section>

        </div>

        <aside className="min-w-0 space-y-5">

          {canManage && <BookPanel portfolio={portfolio} />}
           {canManage && <ChannelPanel channels={channels} month={currentMonth} />}
          <RoundPanel
            collected={summary.totalCollected}
            expected={portfolio.expectedDaily}
            scoped={Boolean(filters.collector) || !canManage}
          />

          {collectorDays && collectorDays.length > 0 && (
            <CollectorDayPanel
              rows={collectorDays}
              date={summary.date}
              isToday={isToday}
              isLoading={loading}
            />
          )}

          <SavingsDayPanel day={savingsDay} date={summary.date} />

          {canManage && passwordsOutstanding.length > 0 && (
            <PasswordsPanel staff={passwordsOutstanding} />
          )}
        </aside>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 2xl:grid-cols-2">
        {canManage && tellers.length > 0 && (
          <TellerPanel rows={tellers} date={summary.date} isToday={isToday} />
        )}

        <section
          className="flex min-w-0 flex-col"
          aria-label="Transaction history"
        >
            <div className="mb-3">
              <h2 className={PANEL_TITLE}>Recent transactions</h2>
              <p className="mt-1 text-xs text-muted">
                {isToday ? "Today" : formatDate(summary.date)} ·{" "}
                {summary.depositCount} deposits ·{" "}
                {formatGhs(summary.totalCollected)}
              </p>
            </div>

            <DataTable
              className="flex-auto"
              columns={
                canManage
                  ? ["Time", "Customer", "Days", "Amount", "Source", "Taken by"]
                  : ["Time", "Customer", "Days", "Amount"]
              }
              ariaLabel="Deposits collected"
              isLoading={loading}
              paginated
              heightClass="max-h-none"
              pageSizeOptions={[10, 25, 50]}
              resetKey={`${summary.date}-${filters.collector}`}
              emptyContent={{
                icon: <HandCoins size={20} />,
                title: "Nothing collected yet",
                subtext: isToday
                  ? "Deposits will appear here."
                  : `Nothing on ${formatDate(summary.date)}.`,
              }}
            >
              {rows.map((line) => {
                const field = collectorNames.has(line.collectorId);
                return (
                  <Table.Row key={line.depositId} id={line.depositId}>
                    <Table.Cell className="px-4 py-2 tabular-nums text-muted">
                      {formatTime(line.at)}
                    </Table.Cell>
                    <Table.Cell className="px-4 py-2 font-medium text-foreground">
                      <Link
                        to={`/susu/${line.accountId}`}
                        className="hover:text-success hover:underline"
                      >
                        {line.customerName}
                      </Link>
                    </Table.Cell>
                    <Table.Cell className="px-4 py-2 tabular-nums text-muted">
                      {line.daysCovered}
                    </Table.Cell>
                    <Table.Cell className="px-4 py-2 font-medium tabular-nums text-foreground">
                      {formatGhs(line.amount)}
                    </Table.Cell>
                    {canManage && (
                      <Table.Cell className="px-4 py-2">
                        <Tag className={field ? "bg-cat-6/15" : "bg-cat-2/20"}>
                          {field ? "Round" : "Counter"}
                        </Tag>
                      </Table.Cell>
                    )}
                    {canManage && (
                      <Table.Cell className="px-4 py-2 text-muted">
                        {collectorNames.get(line.collectorId) ?? "Office"}
                      </Table.Cell>
                    )}
                  </Table.Row>
                );
              })}
            </DataTable>
        </section>
      </div>
    </div>
  );
}

function SampleChip() {
  return (
    <span className="rounded-sm bg-warning/20 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-foreground">
      {SAMPLE_NOTICE}
    </span>
  );
}

/** A figure inside a sentence — the bit the eye is meant to land on. */
function Figure({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-semibold tabular-nums text-foreground">
      {children}
    </span>
  );
}

/** A word carrying a category — a source, a drawer state. */
function Tag({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <span
      className={`inline-block rounded-sm px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-foreground ${className}`}
    >
      {children}
    </span>
  );
}

/** The heading row every charted panel shares. */
function PanelHead({
  title,
  subtitle,
  sample,
  aside,
}: {
  title: string;
  subtitle: string;
  sample?: boolean;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex flex-wrap items-center gap-2 font-heading text-sm font-semibold text-foreground">
          {title}
          {sample && <SampleChip />}
        </h2>
        <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
      </div>
      {aside}
    </div>
  );
}

function CollectorDayPanel({
  rows,
  date,
  isToday,
  isLoading,
}: {
  rows: CollectorDay[];
  date: string;
  isToday: boolean;
  isLoading: boolean;
}) {
  const idle = rows.filter((row) => row.deposits === 0);
  const peak = rows.reduce((max, row) => Math.max(max, row.amount), 0);

  return (
    <section className={`${PANEL} p-5`} aria-label="Collections by collector">
      <div className="mb-1 flex items-start justify-between gap-3">
        <h2 className={PANEL_TITLE}>Field collections</h2>
        <Users size={14} className="shrink-0 text-muted" aria-hidden="true" />
      </div>
      <p className="text-xs text-muted">{isToday ? "Today" : formatDate(date)}</p>

      {idle.length > 0 && (
        <p className="mt-3 rounded-md bg-warning/15 px-2 py-1 text-xs text-foreground">
          <Figure>{idle.length}</Figure> with nothing recorded
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted">No collectors on the round.</p>
      ) : (
        <ul className={`mt-4 space-y-3.5 ${isLoading ? "opacity-50" : ""}`}>
          {rows.map((row) => (
            <li key={row.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-xs font-medium text-foreground">
                  {row.name}
                </span>
                <span className="shrink-0 font-sen text-xs font-semibold tabular-nums text-foreground">
                  {formatGhs(row.amount)}
                </span>
              </div>
              <div className="mt-1.5">
                <Meter value={row.amount} max={peak} className="bg-cat-4" />
              </div>
              <p className="mt-1 text-xs tabular-nums text-muted">
                {row.deposits === 0 ? (
                  <span className="font-semibold text-foreground">
                    Nothing yet
                  </span>
                ) : (
                  <>
                    <Figure>{row.deposits}</Figure>{" "}
                    {row.deposits === 1 ? "deposit" : "deposits"}
                    {row.lastAt ? ` · ${formatTime(row.lastAt)}` : ""}
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TellerPanel({
  rows,
  date,
  isToday,
}: {
  rows: SampleTeller[];
  date: string;
  isToday: boolean;
}) {
  const DRAWER: Record<SampleTeller["drawer"], { label: string; className: string }> = {
    balanced: { label: "Balanced", className: "bg-cat-4/20" },
    variance: { label: "Variance", className: "bg-warning/25" },
    open: { label: "Open", className: "bg-surface-tertiary" },
  };

  return (
    <section className="flex min-w-0 flex-col" aria-label="Counter activity">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
            Counter activity
            <SampleChip />
          </h2>
          <p className="mt-1 text-xs text-muted">
            {isToday ? "Today" : formatDate(date)}
          </p>
        </div>
        <p className="text-right text-xs text-muted">
          Net cash
          <span className="ml-1.5 font-sen font-semibold tabular-nums text-foreground">
            {formatGhs(rows.reduce((sum, row) => sum + row.netCash, 0))}
          </span>
        </p>
      </div>

      <DataTable
        columns={["Teller", "Branch", "Txns", "Deposits", "Withdrawals", "Net cash", "Drawer"]}
        ariaLabel="Counter activity by teller"
        className="flex-auto"
        heightClass="max-h-none"
      >
        {rows.map((row) => (
          <Table.Row key={row.name} id={row.name}>
            <Table.Cell className="px-4 py-2 font-medium text-foreground">
              {row.name}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 text-muted">
              <span className="flex items-center gap-1.5">
                <Building2 size={12} aria-hidden="true" className="shrink-0" />
                {row.branch}
              </span>
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {row.transactions}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-foreground">
              {formatGhs(row.deposits)}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {formatGhs(row.withdrawals)}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 font-medium tabular-nums text-foreground">
              {formatGhs(row.netCash)}
            </Table.Cell>
            <Table.Cell className="px-4 py-2">
              <Tag className={DRAWER[row.drawer].className}>
                {DRAWER[row.drawer].label}
              </Tag>
            </Table.Cell>
          </Table.Row>
        ))}
      </DataTable>

    </section>
  );
}

function UncollectedPanel({
  accounts,
  total,
  expected,
  isToday,
}: {
  accounts: { account: SusuAccount; name: string | null }[];
  total: number;
  expected: number;
  isToday: boolean;
}) {
  return (
    <section className={`${PANEL} p-5`} aria-label="Not yet collected">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className={PANEL_TITLE}>Not yet collected</h2>
        <HandCoins size={14} className="shrink-0 text-muted" aria-hidden="true" />
      </div>

      {total === 0 ? (
        <p className="text-xs text-muted">
          Every running cycle has a deposit {isToday ? "today" : "that day"}.
          Nothing outstanding.
        </p>
      ) : (
        <>
          <p className="font-sen text-2xl font-semibold tabular-nums text-foreground">
            {formatGhs(expected)}
          </p>
          <p className="mb-3 mt-1 text-xs text-muted">
            across <Figure>{total}</Figure> {total === 1 ? "cycle" : "cycles"}
          </p>

          <ul className="space-y-3.5">
            {accounts.map(({ account, name }) => (
              <li key={account.id}>
                <Link
                  to={`/susu/${account.id}`}
                  className="group block rounded-md outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-xs font-medium text-foreground group-hover:text-success">
                      {name ?? `Susu ${account.accountNumber}`}
                    </span>
                    <span className="shrink-0 font-sen text-xs font-semibold tabular-nums text-foreground">
                      {formatGhs(account.dailyAmount)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs tabular-nums text-muted">
                    day {account.depositsCount} of {account.cycleTarget}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          {total > accounts.length && (
            <p className="mt-3 text-xs text-muted">
              {total - accounts.length} more not shown.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** How the month's money arrived. Invented — a deposit has no channel. */
function ChannelPanel({
  channels,
  month,
}: {
  channels: { key: string; label: string; value: number }[];
  month: string;
}) {
  const RAMP = ["navy", "gold", "teal", "green", "steel"] as const;
  const total = channels.reduce((sum, channel) => sum + channel.value, 0);

  return (
    <section className={`${PANEL} p-5`} aria-label="How the money arrived">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <h2 className={PANEL_TITLE}>How it arrived · {month}</h2>
        <SampleChip />
      </div>

      <p className="mb-4 flex items-center gap-1.5 text-xs text-muted">
        <Smartphone size={14} aria-hidden="true" className="shrink-0" />
        {total > 0
          ? `${Math.round(((total - (channels[0]?.value ?? 0)) / total) * 100)}% cashless`
          : "Nothing this month"}
      </p>

      <BarList
        items={channels.map((channel, i) => ({
          key: channel.key,
          label: channel.label,
          value: channel.value,
          tone: RAMP[i % RAMP.length],
          foot:
            total > 0
              ? `${Math.round((channel.value / total) * 100)}%`
              : undefined,
        }))}
      />
    </section>
  );
}

/** Savings movement for the day. Invented — there is no savings summary. */
function SavingsDayPanel({
  day,
  date,
}: {
  day: SampleSavingsDay;
  date: string;
}) {
  return (
    <section className={`${PANEL} p-5`} aria-label="Savings for the day">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <h2 className={PANEL_TITLE}>Savings · {formatDate(date)}</h2>
        <SampleChip />
      </div>

      <dl className="space-y-2.5">
        <Line
          label="Paid in"
          value={formatGhs(day.depositsIn)}
          foot={`${day.depositCount} ${day.depositCount === 1 ? "deposit" : "deposits"}`}
        />
        <Line
          label="Paid out"
          value={formatGhs(day.withdrawalsOut)}
          foot={`${day.withdrawalCount} ${day.withdrawalCount === 1 ? "withdrawal" : "withdrawals"}`}
        />
        <Line
          label="Fees taken"
          value={formatGhs(day.feesCollected)}
          foot={`${CEDI}10 each`}
        />
      </dl>
    </section>
  );
}

function Line({
  label,
  value,
  foot,
}: {
  label: string;
  value: string;
  foot: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0">
        <span className="block truncate text-xs text-foreground">{label}</span>
        <span className="block text-xs tabular-nums text-muted">{foot}</span>
      </dt>
      <dd className="shrink-0 font-sen text-sm font-semibold tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}

function PasswordsPanel({
  staff,
}: {
  staff: { id: string; name: string; role: Role }[];
}) {
  return (
    <section
      className={`${PANEL} p-5`}
      aria-label="Staff yet to set their own password"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className={PANEL_TITLE}>Passwords outstanding</h2>
        <KeyRound size={14} className="shrink-0 text-muted" aria-hidden="true" />
      </div>

      <p className="mb-3 text-xs text-muted">
        <Figure>{staff.length}</Figure> still on an admin-set password
      </p>

      <ul className="space-y-2">
        {staff.slice(0, 5).map((person) => (
          <li
            key={person.id}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="min-w-0 truncate text-xs font-medium text-foreground">
              {person.name}
            </span>
            <span className="shrink-0 text-xs text-muted">
              {ROLE_LABELS[person.role]}
            </span>
          </li>
        ))}
      </ul>

      <Link
        to="/staff"
        className="mt-3 inline-block text-xs font-medium text-success hover:underline"
      >
        Open staff
      </Link>
    </section>
  );
}

function RoundPanel({
  collected,
  expected,
  scoped,
}: {
  collected: number;
  expected: number;
  scoped: boolean;
}) {
  const percent = expected > 0 ? Math.round((collected / expected) * 100) : 0;
  const shortfall = Math.max(0, expected - collected);

  return (
    <section className={`${PANEL} p-5`} aria-label="The day's round">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className={PANEL_TITLE}>The day&apos;s round</h2>
        <span className="shrink-0 font-sen text-xs font-semibold tabular-nums text-foreground">
          {percent}%
        </span>
      </div>

      <p className="font-sen text-2xl font-semibold tabular-nums text-foreground">
        {formatGhs(collected)}
      </p>
      <p className="mb-3 mt-1 text-xs text-muted">
        of {formatGhs(expected)} due
      </p>

      <Meter value={collected} max={expected} />

      <p className="mt-3 text-xs text-muted">
        {shortfall > 0 ? (
          <>
            <Figure>{formatGhs(shortfall)}</Figure> still out
          </>
        ) : (
          "Fully covered"
        )}
      </p>

      {scoped && (
        <p className="mt-2 text-xs text-muted">
          Target is the whole book.
        </p>
      )}
    </section>
  );
}

function BookPanel({
  portfolio,
}: {
  portfolio: ReturnType<typeof buildPortfolio>;
}) {
  return (
    <section className={`${PANEL} p-5`} aria-label="Money under management">
      <h2 className={PANEL_TITLE}>Money under management</h2>

      <div className="mb-4 mt-3 grid grid-cols-2 gap-3">
        <Split
          icon={<HandCoins size={14} />}
          label="Susu"
          value={portfolio.susuActive + portfolio.susuCompleted}
          count={portfolio.susuAccounts}
        />
        <Split
          icon={<PiggyBank size={14} />}
          label="Savings"
          value={portfolio.savingsAvailable + portfolio.savingsLocked}
          count={portfolio.savingsAccounts}
        />
      </div>

      <Donut
        total={portfolio.total}
        centreLabel="under management"
        segments={[
          {
            key: "susu-active",
            label: "Susu, cycles running",
            value: portfolio.susuActive,
            tone: "navy",
          },
          {
            key: "susu-due",
            label: "Susu, payout due",
            value: portfolio.susuCompleted,
            tone: "gold",
          },
          {
            key: "savings-available",
            label: "Savings, available",
            value: portfolio.savingsAvailable,
            tone: "green",
          },
          {
            key: "savings-locked",
            label: "Savings, held back",
            value: portfolio.savingsLocked,
            tone: "teal",
          },
        ]}
      />
    </section>
  );
}

function Split({
  icon,
  label,
  value,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  count: number;
}) {
  return (
    <div className="rounded-md bg-surface-secondary px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <span aria-hidden="true" className="text-muted">
          {icon}
        </span>
        {label}
      </p>
      <p className="mt-0.5 truncate font-sen text-sm font-semibold tabular-nums text-foreground">
        {formatGhs(value)}
      </p>
      <p className="text-xs tabular-nums text-muted">
        {count} {count === 1 ? "account" : "accounts"}
      </p>
    </div>
  );
}
