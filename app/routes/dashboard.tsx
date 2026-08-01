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

/* ------------------------------------------------------------------ *
 * Loading
 *
 * Where each figure comes from, and which ones are real:
 *
 * - **The day** — `GET /susu/summary` for the selected date and the one before
 *   it. Exact, two requests, and already scoped to the caller: a collector gets
 *   their own figures whatever they ask for. Everything the page asks someone
 *   to act on is built from this and from the account lists.
 * - **The book, the round, payouts due and coming, the day's outstanding
 *   accounts** — all derived from `GET /susu/accounts` and
 *   `GET /savings/accounts`, which are fetched whole. Free arithmetic on top of
 *   lists we need anyway.
 * - **Money out, by day and by month** — closed accounts carry `closedAt` and
 *   `payoutAmount`, so the account list already holds every payout ever. Free.
 * - **Counter against round, for today** — real: the summary names who took
 *   each deposit, and a deposit not taken by a collector came over the counter.
 * - **Anything spanning a week, the payment channels, the counter drawers, the
 *   yearly chart and savings-for-a-day** — invented. See
 *   [sample-data.ts](app/lib/sample-data.ts) for what replaces each one, and
 *   the chip beside every panel that draws from it.
 *
 * The rule this file keeps: no panel mixes an invented figure with a real one
 * inside the same number. A panel is either live or it is marked sample.
 * ------------------------------------------------------------------ */

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

/**
 * Every page of a paginated collection, up to `MAX_PAGES`.
 *
 * The book has to be summed whole — a portfolio total from the first hundred
 * accounts is not a portfolio total. The cap exists so a runaway dataset can't
 * turn one page load into a hundred requests; when it bites, `truncated` says
 * so and the page prints a warning rather than a confident wrong number.
 */
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
  // Validated rather than trusted: the date goes straight into an API query,
  // and a future one would ask the summary endpoint to reconcile a day that
  // hasn't happened.
  const asked = sp.get("date")?.trim() ?? "";
  const date = DATE_RE.test(asked) && asked <= today ? asked : today;

  const thisYear = Number(today.slice(0, 4));
  const years = Array.from({ length: YEARS_BACK + 1 }, (_, i) => thisYear - i);
  const askedYear = Number(sp.get("year"));
  const year = years.includes(askedYear) ? askedYear : thisYear;

  // Collectors always see their own figures — the API ignores the parameter
  // for them, so there is no point sending it.
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
        // One row asked for, one number used: the list endpoint's `total` is
        // the only customer count the API publishes.
        customersApi.listCustomers(token, { status: "active", limit: 1 }),
        /**
         * Everyone, not just collectors — one request that answers three
         * panels. The collector filter, the reconciliation table and the
         * counter/round split all need the collector list; the
         * outstanding-password panel needs every role, since an admin whose own
         * password was reset is exactly as much of a shared credential as a
         * collector whose was. `GET /users` admits managers as well as admins,
         * so this is not an admin-only fetch.
         */
        office
          ? usersApi.listUsers(token, { status: "active", limit: PAGE_SIZE })
          : null,
      ]);

    const outstanding = uncollectedToday(
      susu.items,
      summary.deposits,
      OUTSTANDING_SHOWN,
    );

    /**
     * Customer names for the panel that lists accounts.
     *
     * The list doesn't carry a name — `SusuAccount` has only `customerId` — and
     * there is no bulk lookup, so it is one request per customer. Capped by the
     * panel's own limit: at most eight small requests, for a panel somebody
     * acts on. A failure falls back to the account number, which is a handle a
     * teller can use anyway.
     */
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

  /**
   * The chart's twelve columns, January to December.
   *
   * Sample figures — see the note at the top of this file. Scoped by whoever
   * the page is about so the office total and one collector's takings aren't
   * the same numbers twice.
   */
  const scope = office ? (collectorId ?? "all") : user.id;
  const points: FlowPoint[] = sampleYear(year, scope).map((month) => ({
    key: month.key,
    label: monthLabel(month.key),
    title: monthTitle(month.key),
    collected: month.collected,
    paidOut: month.paidOut,
    depositCount: month.depositCount,
  }));

  // Payouts are real and free — a closed account carries what it paid and when.
  // "This month" is the month of the day being looked at, not of the clock, so
  // picking a date in March compares March against February.
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

  /**
   * How much of the day's round is still out, as a percentage.
   *
   * Both halves are whole-book — every running cycle's daily amount against the
   * ones with no deposit yet — so the ratio means something whoever is looking
   * at it. It replaces the "default rate" a susu book doesn't have: a cycle is
   * a target, not a schedule, so nobody is in default at 3pm on a Tuesday.
   */
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
      /**
       * Money out is whole-book, so it is only drawn beside collections that
       * are also whole-book. Mixing one collector's takings with everybody's
       * payouts on one axis would invent a deficit that isn't there.
       */
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
      /**
       * Staff still carrying a password an administrator set. Office only, and
       * only the count and the names — the fix lives on /staff, where the reset
       * button is already admin-gated, so a manager sees the problem and takes
       * it to an admin rather than meeting a button that 403s.
       */
      passwordsOutstanding: (staff?.items ?? [])
        .filter((u) => u.mustChangePassword)
        .map((u) => ({ id: u.id, name: u.name, role: u.role })),

      // Invented, every one of them. Each is drawn under a `SampleChip`.
      savingsDay: sampleSavingsDay(date),
      weekly: sampleWeeklyInflows(date, scope),
      sourceWeek,
      channels: sampleChannels(thisMonth, scope),
      tellers: office ? sampleTellers(date) : [],

      // Said out loud when it applies: the figures below are then a floor
      // rather than a total.
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

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

/**
 * `PANEL`, `PANEL_TITLE` and `Kpi` moved to
 * [kpi.tsx](app/components/kpi.tsx) — the loan pages want the same tile, and a
 * second copy would be a second definition of what a figure looks like here.
 * Imported at the top of this file.
 */

/**
 * The greeting banner's face — a green gradient, ramped left to right.
 *
 * The account card's SHEEN trick, inverted. That one lays white highlights over
 * a saturated fill; this face is a wash on the surface colour, so white would
 * be invisible on it and the facets are cut in the greens off the logo ring
 * instead: the base ramps leaf → teal across the card, a lighter pool sits at
 * the right behind the mark, and two thin diagonals break the sweep so it reads
 * as facets rather than a flat fade.
 *
 * All of it under 22%, and all of it in `color-mix` against `transparent`
 * rather than fixed rgba: the same rules then read on the white surface and on
 * the near-black one, which a hardcoded tint cannot do. The heading sits on the
 * surface colour underneath — contrast stays the surface's job, not the wash's.
 */
const HERO_FACE = {
  backgroundImage: [
    "linear-gradient(112deg, transparent 44%, color-mix(in oklab, var(--color-leaf) 10%, transparent) 47%, transparent 55%)",
    "linear-gradient(112deg, transparent 62%, color-mix(in oklab, var(--color-teal-dark) 9%, transparent) 65%, transparent 73%)",
    "radial-gradient(120% 150% at 94% 4%, color-mix(in oklab, var(--color-leaf-light) 16%, transparent), transparent 62%)",
    "linear-gradient(100deg, color-mix(in oklab, var(--color-leaf) 21%, transparent), color-mix(in oklab, var(--color-teal) 12%, transparent) 46%, color-mix(in oklab, var(--color-teal-light) 5%, transparent) 78%, transparent)",
  ].join(","),
};

/**
 * Which colour each thing wears, decided once for the whole page.
 *
 * Susu is navy and savings is teal wherever either appears — the week chart,
 * the ring — so a reader learns the pair once. The source split is its own
 * pair: the round is green, the counter gold, and neither answers *what* the
 * money is, only where it was taken.
 */
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

  // Sorted here rather than by re-fetching: the API returns the day whole, and
  // a round trip to reorder rows already in memory would be a slower way to do
  // nothing. Newest first — the row somebody is looking for is the last one in.
  const rows = useMemo(
    () => [...summary.deposits].sort((a, b) => b.at.localeCompare(a.at)),
    [summary.deposits],
  );

  return (
    /* No `overflow` here. `overflow-y-hidden` would compute `overflow-x` to
       `auto` — one axis cannot be clipped while the other stays `visible` —
       which makes the whole page a horizontal scrollport, and clips the chart
       tooltips that are meant to escape their panels. */
    <div className="mx-auto w-full px-4 py-6 sm:px-6 sm:py-8">
      {/* The greeting banner: the day, the name, one line of orientation, and
          one way onward. The face is painted rather than photographed — a
          photo behind a heading is a contrast problem that changes with every
          image, and this one has to hold in both themes. */}
      <section
        aria-label="Greeting"
        /* `overflow-hidden`, both axes. The rings below hang 96px past the
           right edge on purpose and this is what crops them; `overflow-y-hidden`
           computes `overflow-x` to `auto` instead, so the banner grew a
           horizontal scrollbar of exactly that 96px. */
        className="relative mb-6 overflow-hidden rounded-xl border-2 border-success/40 bg-surface shadow-none dark:bg-canvas"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={HERO_FACE}
        />

        {/* The ring motif off the reference banner: concentric circles set into
            the right edge and cropped by the card's own `overflow-hidden`, so
            they read as a shape the banner is cut from rather than a sticker on
            top of it. Decorative, behind the content, and dropped below `sm` —
            on a phone the whole width is needed for the words. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-88 sm:block"
        >
          <span className="absolute -right-24 top-1/2 size-72 -translate-y-1/2 rounded-full border-2 border-teal/25" />
          <span className="absolute -right-14 top-1/2 size-52 -translate-y-1/2 rounded-full bg-linear-to-br from-leaf/25 via-teal/20 to-teal-light/5" />
          <span className="absolute -right-4 top-1/2 size-28 -translate-y-1/2 rounded-full border-2 border-leaf-light/30" />
          {/* The one warm note, the way the reference puts a single dot in all
              that blue. Gold is the coins in the mark. */}
          <span className="absolute right-28 top-7 size-1.5 rounded-full bg-gold" />
        </div>

        <div className="relative flex flex-wrap items-center justify-between gap-5 px-5 py-6 sm:px-7 sm:py-7">
          <div className="min-w-0">
            {/* `teal-dark` on the light wash and `teal-light` on the dark one.
                A single green cannot do both: the one that clears 4.5:1 on
                white is near-black on the dark surface. */}
            <p className="font-heading text-[11px] font-bold uppercase tracking-[0.18em] text-teal-dark dark:text-teal-light">
              {formatDayLine(summary.date)}
            </p>
            <h1 className="mt-2 font-heading text-2xl font-semibold text-foreground sm:text-3xl">
              {greeting}, {user.name.split(" ")[0]}.
            </h1>
            <p className="mt-1.5 text-sm text-muted">
              {canManage
                ? `Collections for ${isToday ? "today" : formatDate(summary.date)}.`
                : `What you have collected ${isToday ? "today" : `on ${formatDate(summary.date)}`}.`}{" "}
              Signed in as {ROLE_LABELS[user.role]}.
            </p>
          </div>

          <Link
            to="/customers"
            className="flex min-h-9 shrink-0 items-center gap-2 rounded-full border-2 border-border bg-surface px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-success hover:text-teal-dark dark:hover:text-teal-light"
          >
            <Users size={14} className="text-success" />
            Open the customer book
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {limits.accounts && (
        <p className="mb-4 rounded-lg border-2 border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          More accounts exist than this page reads ({MAX_PAGES * PAGE_SIZE} at
          most). The book and the round below are a floor, not a total.
        </p>
      )}

      {/* The six figures, one band across the whole page rather than a block
          inside the left column. Sharing that column with the rail put them
          three-up and two rows deep, which reads as two unrelated groups; at
          full width they are one row and one glance. */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi
          icon={<Coins size={14} />}
          label="Money under management"
          value={formatGhs(portfolio.total)}
          foot={
            <p className="mt-0.5 text-[11px] text-muted">
              across{" "}
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
            <p className="mt-0.5 text-[11px] text-muted">
              <Figure>{portfolio.susuAccounts}</Figure> susu ·{" "}
              <Figure>{portfolio.savingsAccounts}</Figure> savings
            </p>
          }
        />
        <Kpi
          icon={<HandCoins size={14} />}
          label={isToday ? "Collected today" : "Collected"}
          value={formatGhs(stats.collectedToday)}
          /* One line, like every other card here: a second line on this one
             alone sets the height of all six. The counter/round split it used
             to carry has its own panel further down the page. */
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
        {/* Payouts are real and free — a closed account carries what it paid
            and when — so this is the one figure that survived dropping the
            statement scan. */}
        <Kpi
          icon={<Banknote size={14} />}
          label={isToday ? "Paid out today" : "Paid out"}
          value={formatGhs(stats.paidToday)}
          foot={
            <p className="mt-0.5 text-[11px] text-muted">
              <Figure>{stats.payoutsToday}</Figure> closed ·{" "}
              <Figure>{compactGhs(stats.paidThisMonth)}</Figure> in{" "}
              {currentMonth}
            </p>
          }
        />
        <Kpi
          icon={<CalendarClock size={14} />}
          label={`Payouts due (${payoutWindow} days)`}
          value={formatGhs(stats.payoutsSoon.amount)}
          foot={
            <p className="mt-0.5 text-[11px] text-muted">
              <Figure>{stats.payoutsSoon.count}</Figure>{" "}
              {stats.payoutsSoon.count === 1 ? "cycle" : "cycles"} near the last
              day
            </p>
          }
        />
        {/* Not a default rate: a susu cycle is 31 deposits, not a schedule, so
            nobody is in arrears mid-afternoon. What the office can act on is
            how much of today's round is still out. */}
        <Kpi
          icon={<Gauge size={14} />}
          label="Round still out"
          value={`${stats.gapPercent}%`}
          foot={
            <p className="mt-0.5 text-[11px] text-muted">
              <Figure>{compactGhs(outstanding.expected)}</Figure> of{" "}
              {compactGhs(portfolio.expectedDaily)} due{" "}
              {isToday ? "today" : "that day"}
            </p>
          }
        />
      </div>

      {/* One column until there is room for the rail. The rail is the part
          that answers "what should I do next" — a card, the day's round, the
          book, what is still out — and the main column is the record. */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <section className={`${PANEL} p-5`} aria-label="Money in by day">
            <PanelHead
              title="Money in, by day"
              subtitle="Monday to Sunday · susu against savings"
              sample
              aside={
                /* The week to date, not the last column: a Tuesday reader
                   comparing against Friday's bar would be comparing against a
                   day that hasn't happened. */
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
              caption="Placeholder figures, for the same missing date range the yearly chart names. Susu and savings are plotted apart rather than added up: one is a daily obligation and the other is money that arrives when it arrives, and a single line would hide which of them moved."
            />
          </section>
          <section className={`${PANEL} p-5`} aria-label="Collections analytics">
            <PanelHead
              title="Collections analytics"
              subtitle={`January — December ${year}`}
              sample
              aside={
                /* The best month in the window, not the axis ceiling — the two
                   are only ever the same by accident. */
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
              caption="Placeholder figures. No endpoint takes a date range, so a year cannot be assembled without reading every account's statement one by one — a burst of requests whose answer was still incomplete. A susu endpoint taking from / to, or a monthly summary, replaces this with the real thing."
            />
          </section>



          <section className={`${PANEL} p-5`} aria-label="Counter against round">
            <PanelHead
              title="Counter against round"
              subtitle="Seven days · where the money was taken"
              sample
              aside={
                <p className="text-right text-xs text-muted">
                  {isToday ? "Today" : formatDate(summary.date)}, for real
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
              // Side by side: the question this panel answers is which of the
              // two moved, and a stack makes the second one start wherever the
              // first one ended.
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
              caption={`Placeholder figures for the six days behind it. Today's split is real — ${formatGhs(
                stats.source.office,
              )} over the counter and ${formatGhs(
                stats.source.field,
              )} on the round — because the summary names who took each deposit. The rest needs a summary endpoint that takes a date range.`}
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
            date={summary.date}
            isToday={isToday}
          />

          {/* The office's reconciliation view at handover: who brought what in,
              and — the part that gets acted on — who has brought nothing. */}
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

      {/* The two record tables, side by side and across the whole page rather
          than stacked in the left column. Both are wide — six and seven
          columns — so they get the page's full width to split between them,
          and they only pair up at `2xl`, where half of it is still wider than
          the column they came out of. */}
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
              // The table must not carry a scroll area of its own here. Its
              // default (`max-h-[60vh]`) is right on a page that *is* one
              // table — the header stays put and the rows move under it — but
              // this page already scrolls, and a scroller inside a scroller
              // means two bars, and a wheel that stops the page dead when the
              // pointer happens to be over the rows. Pagination keeps the
              // height sane instead.
              heightClass="max-h-none"
              pageSizeOptions={[10, 25, 50]}
              resetKey={`${summary.date}-${filters.collector}`}
              emptyContent={{
                icon: <HandCoins size={20} />,
                title: "Nothing collected yet",
                subtext: isToday
                  ? "Deposits recorded today will appear here."
                  : `No deposits were recorded on ${formatDate(summary.date)}.`,
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
                        {/* A deposit recorded by an admin or manager won't be in
                            the collector list — that isn't an unknown user, it's
                            the office. */}
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

/* ------------------------------------------------------------------ *
 * The small shared pieces
 * ------------------------------------------------------------------ */

/**
 * Marks a panel whose figures are invented.
 *
 * Deliberately a chip beside the heading rather than a footnote. Someone
 * skimming a dashboard reads the numbers and the titles; a caption under a
 * chart is exactly where a disclaimer goes to be missed, and mistaking these
 * for takings is the one failure worth designing against.
 */
function SampleChip() {
  return (
    <span className="rounded-sm bg-warning/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground">
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
      className={`inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground ${className}`}
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

/* ------------------------------------------------------------------ *
 * The panels
 * ------------------------------------------------------------------ */

/**
 * The day split by who collected it.
 *
 * Zero rows are kept — see `byCollector`. A collector who has recorded nothing
 * is the row somebody acts on, and dropping it would leave the panel saying
 * everything is fine because the person who hasn't come in simply isn't there.
 *
 * The share bar is of the day's biggest round rather than of the day's total:
 * with eight collectors every share of the total is a sliver, and the question
 * being asked is "who is behind the others", not "who owns what fraction".
 *
 * A list rather than the five-column table this used to be. It lives in the
 * rail now, and a rail is 20rem wide — the meter cell alone was 10rem of that.
 * The facts are all still here, stacked instead of ranged across: name and
 * amount on one line, the bar under them, the count and the last deposit under
 * that.
 */
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
      <p className="text-xs text-muted">
        {isToday ? "Today" : formatDate(date)} · what each person has brought in.
      </p>

      {idle.length > 0 && (
        <p className="mt-3 rounded-md bg-warning/15 px-2 py-1 text-[11px] text-foreground">
          <Figure>{idle.length}</Figure>{" "}
          {idle.length === 1 ? "collector has" : "collectors have"} recorded
          nothing
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
              {/* Wrapped rather than given a margin: `className` on `Meter`
                  styles the fill inside the track, not the track. */}
              <div className="mt-1.5">
                <Meter value={row.amount} max={peak} className="bg-cat-4" />
              </div>
              <p className="mt-1 text-[11px] tabular-nums text-muted">
                {row.deposits === 0 ? (
                  <span className="font-semibold text-foreground">
                    Nothing yet
                  </span>
                ) : (
                  <>
                    <Figure>{row.deposits}</Figure>{" "}
                    {row.deposits === 1 ? "deposit" : "deposits"}
                    {row.lastAt ? ` · last ${formatTime(row.lastAt)}` : ""}
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

/**
 * The counter, teller by teller.
 *
 * Every figure here is invented and the panel says so twice — the chip and the
 * caption — because this is the one table on the page that looks most like a
 * reconciliation and is least able to be one. The API has no branch, no till
 * and no teller session; see `sampleTellers`.
 */
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
            {isToday ? "Today" : formatDate(date)} · what came over the counter,
            teller by teller.
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
        // Grows against the deposits table beside it: the two share a grid
        // row, so the shorter one fills the row's height instead of leaving a
        // ragged gap under it.
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

/**
 * Running cycles with no deposit on the day — the work still outstanding.
 *
 * The panel a collector opens the app for. Since customer assignment was
 * dropped every collector may collect on any account, so this is one shared
 * list rather than a personal round.
 */
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
                  <p className="mt-0.5 text-[11px] tabular-nums text-muted">
                    day {account.depositsCount} of {account.cycleTarget}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          {total > accounts.length && (
            <p className="mt-3 text-[11px] text-muted">
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
  // The ramp in order, so the biggest channel is always the same colour as the
  // biggest slice of the book above it.
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
          ? `${Math.round(((total - (channels[0]?.value ?? 0)) / total) * 100)}% arrived without cash changing hands`
          : "Nothing recorded this month"}
      </p>

      <BarList
        items={channels.map((channel, i) => ({
          key: channel.key,
          label: channel.label,
          value: channel.value,
          tone: RAMP[i % RAMP.length],
          foot:
            total > 0
              ? `${Math.round((channel.value / total) * 100)}% of the month`
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
          foot={`${CEDI}10 a withdrawal`}
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
        <span className="block text-[11px] tabular-nums text-muted">{foot}</span>
      </dt>
      <dd className="shrink-0 font-sen text-sm font-semibold tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}

/**
 * Staff still signed in on a password an administrator chose for them.
 *
 * Every name here is a credential two people know. Read-only, and links to
 * /staff rather than offering a reset: a manager can see this and can't fix it
 * — the reset button there is admin-gated — so the panel points at the place
 * where the right person can act instead of rendering a button that 403s.
 */
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
        <Figure>{staff.length}</Figure>{" "}
        {staff.length === 1 ? "person is" : "people are"} still on a password an
        administrator set.
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
            <span className="shrink-0 text-[11px] text-muted">
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

/**
 * The day's takings, on the same plastic the account cards use.
 *
 * Not decoration: the rail's job is "what is in hand right now", and the card
 * is the object this app has already taught people to read that off. Teal is
 * the face susu accounts wear while money is still moving, which is exactly
 * what an open day is.
 */


/**
 * The day's round: what a full day of collecting is worth against what came in.
 *
 * `expectedDaily` is the sum of every running cycle's daily amount — the exact
 * cash the book is due today if nobody is missed. It is the one target this
 * business has that isn't invented, which is why the rail leads with it.
 */
function RoundPanel({
  collected,
  expected,
  scoped,
  date,
  isToday,
}: {
  collected: number;
  expected: number;
  scoped: boolean;
  date: string;
  isToday: boolean;
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
        of {formatGhs(expected)} due {isToday ? "today" : `on ${formatDate(date)}`}
      </p>

      <Meter value={collected} max={expected} />

      <p className="mt-3 text-xs text-muted">
        {shortfall > 0 ? (
          <>
            <Figure>{formatGhs(shortfall)}</Figure> still out on running cycles.
          </>
        ) : (
          "Every running cycle is covered for the day."
        )}
      </p>

      {/* Said whenever the two halves of the ratio have different scopes — one
          collector's takings over the whole book's expectation is not a
          percentage of anything. */}
      {scoped && (
        <p className="mt-2 text-[11px] text-muted">
          The target is the whole book; the figure above it is one round.
        </p>
      )}
    </section>
  );
}

/**
 * Where the money under management actually sits.
 *
 * A ring rather than one bar, because these four are genuinely parts of one
 * whole and the reader's question is which part is the big one. The figures
 * stay in the list beside it — nobody reconciles against an arc.
 *
 * Deliberately off the front of the ramp: `cat-1` is the brand red, and a
 * breakdown of money the business is holding safely should not open in the
 * colour the app uses for danger and for the one interactive accent. Navy,
 * gold, green and teal are all off the same ring.
 */
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
      <p className="flex items-center gap-1.5 text-[11px] text-muted">
        <span aria-hidden="true" className="text-muted">
          {icon}
        </span>
        {label}
      </p>
      <p className="mt-0.5 truncate font-sen text-sm font-semibold tabular-nums text-foreground">
        {formatGhs(value)}
      </p>
      <p className="text-[11px] tabular-nums text-muted">
        {count} {count === 1 ? "account" : "accounts"}
      </p>
    </div>
  );
}
