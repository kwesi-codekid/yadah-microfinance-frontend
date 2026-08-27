import {
  CheckCheckIcon,
  ClockIcon,
  HandCoinsIcon,
  MoreHorizontalIcon,
  ScaleIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  data,
  Link,
  Outlet,
  useLocation,
  useNavigation,
  useSubmit,
} from "react-router";

import { getVariances, listReconciliations } from "~/api/reconciliation";
import { listUsers } from "~/api/users";
import {
  ChoiceFilter,
  DayRangeChip,
  DayRangeFilter,
  ExportMenu,
  FilterBar,
  FilterChip,
  ListingFooter,
  StatusPill,
  StatusTabs,
  Th,
} from "~/components/listing";
import { Page, PageHeader } from "~/components/page";
import {
  BreakdownChart,
  VolumeChart,
  VolumeKey,
  type MonthPoint,
  type WeekdayPoint,
} from "~/components/reconciliation-charts";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  accraDay,
  accraDaysAgo,
  formatAccraDate,
  formatCount,
  formatPesewas,
} from "~/lib/format";
import {
  STATUS_BLURBS,
  STATUS_LABELS,
  STATUS_TONE,
  VARIANCE_LABELS,
  VARIANCE_TONE,
  isPending,
  varianceKind,
  type Reconciliation,
  type ReconciliationStatus,
  type VarianceRow,
} from "~/lib/reconciliation";
import { requireUser, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/reconciliation";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Cash handover · Yadah Dynamic Enterprise" }];
}

const PAGE_SIZE = 8;

const STATUSES: ReconciliationStatus[] = ["declared", "reconciled"];

const TABS = [
  { key: "all", label: "All" },
  { key: "declared", label: "Awaiting count" },
  { key: "reconciled", label: "Reconciled" },
] as const;
type Tab = (typeof TABS)[number]["key"];

interface Filters {
  status: Tab;
  collectorId: string;
  varianceOnly: boolean;
  from: string;
  to: string;
}

function readFilters(url: URL): Filters {
  const statusParam = url.searchParams.get("status") as ReconciliationStatus | null;
  return {
    status: statusParam && STATUSES.includes(statusParam) ? statusParam : "all",
    collectorId: url.searchParams.get("collectorId") ?? "",
    varianceOnly: url.searchParams.get("variance") === "1",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status !== "all") p.set("status", f.status);
  if (f.collectorId) p.set("collectorId", f.collectorId);
  if (f.varianceOnly) p.set("variance", "1");
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (page > 1) p.set("page", String(page));
  return p;
}

function hrefFor(f: Filters, page = 1): string {
  const s = queryFor(f, page).toString();
  return s ? `/reconciliation?${s}` : "/reconciliation";
}

/** How far back the two charts and the gap queue look. */
const HISTORY_DAYS = 365;
/** The API pages at 100; five pages is more closed days than a year holds. */
const HISTORY_PAGES = 5;

/**
 * `GET /reconciliation` — the handover dashboard.
 *
 * Every role, and the API does the scoping: a collector sees only their own
 * days whatever this asks for, so the year of history the charts are drawn
 * from is *their* year and the figures are theirs. What the role decides is
 * the shape of the screen — the office gets the collector filter and export.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);

  const office = user.role === "admin" || user.role === "manager";
  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const today = accraDay();

  const { data: result, headers } = await withAuth(request, async (token) => {
    const scope = {
      collectorId: filters.collectorId || undefined,
      varianceOnly: filters.varianceOnly ? ("true" as const) : undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    };
    const history = {
      collectorId: filters.collectorId || undefined,
      from: accraDaysAgo(HISTORY_DAYS),
      to: today,
      limit: 100,
    };
    const [list, collectors, report, gaps, firstPage, ...counts] = await Promise.all([
      listReconciliations(token, {
        ...scope,
        page,
        limit: PAGE_SIZE,
        status: filters.status === "all" ? undefined : filters.status,
      }),
      office
        ? listUsers(token, { role: "collector", status: "active", limit: 100 })
        : Promise.resolve(null),
      // Who is short, how often, by how much — a report *about* the
      // collectors, so the API refuses it to a collector and we do not ask.
      office
        ? getVariances(token, { from: history.from, to: history.to })
        : Promise.resolve(null),
      listReconciliations(token, { ...scope, page: 1, limit: 1, varianceOnly: "true" }),
      listReconciliations(token, { ...history, page: 1 }),
      ...STATUSES.map((status) =>
        listReconciliations(token, { ...scope, page: 1, limit: 1, status }),
      ),
    ]);

    // The rest of the year, if the first page did not hold it all.
    const pages = Math.min(HISTORY_PAGES, Math.ceil(firstPage.total / 100));
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
        listReconciliations(token, { ...history, page: i + 2 }),
      ),
    );
    const year = [firstPage, ...rest].flatMap((p) => p.items);

    return { list, collectors, report, gaps, counts, year };
  });

  const byStatus = Object.fromEntries(
    STATUSES.map((s, i) => [s, result.counts[i].total]),
  ) as Record<ReconciliationStatus, number>;

  return data(
    {
      office,
      filters,
      page,
      total: result.list.total,
      counts: {
        all: STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
        ...byStatus,
      },
      gapCount: result.gaps.total,
      collectors:
        result.collectors?.items.map(({ id, name }) => ({ value: id, label: name })) ??
        [],
      rows: result.list.items.map(toRow),
      months: bucketByMonth(result.year, today),
      weekdays: bucketByWeekday(result.year),
      // The API already orders worst first; a collector with no gap at all
      // is still listed, because "always balances" is the thing to notice.
      byCollector: result.report?.rows ?? [],
      queue: result.year
        .filter((r) => r.status === "reconciled" && (r.variance ?? 0) !== 0)
        .sort((a, b) => (a.accraDay < b.accraDay ? 1 : -1))
        .slice(0, 6)
        .map(toRow),
    },
    { headers },
  );
}

/** Opening the declare drawer does not re-read the book underneath it. */
export const shouldRevalidate = drawerParentShouldRevalidate;

/* ------------------------------------------------------------------ shape --- */

interface Row {
  id: string;
  accraDay: string;
  collectorName: string;
  expected: number;
  declared: number;
  received: number | null;
  variance: number | null;
  status: ReconciliationStatus;
  pending: boolean;
  reason: string;
}

function toRow(r: Reconciliation): Row {
  return {
    id: r.id,
    accraDay: r.accraDay,
    collectorName: r.collectorName ?? "Collector",
    expected: r.expectedAmount,
    declared: r.declaredAmount,
    received: r.receivedAmount ?? null,
    variance: r.variance ?? null,
    status: r.status,
    pending: isPending(r),
    reason: r.varianceReason ?? "",
  };
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The last twelve months, oldest first, every month present even when empty. */
function bucketByMonth(items: Reconciliation[], today: string): MonthPoint[] {
  const [y, m] = today.split("-").map(Number);
  const months: MonthPoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    months.push({ month: key, label: MONTH_SHORT[d.getUTCMonth()], balanced: 0, gap: 0, awaiting: 0 });
  }
  const byKey = new Map(months.map((p) => [p.month, p]));
  for (const r of items) {
    const p = byKey.get(r.accraDay.slice(0, 7));
    if (!p) continue;
    if (r.status === "declared") p.awaiting += 1;
    else if ((r.variance ?? 0) !== 0) p.gap += 1;
    else p.balanced += 1;
  }
  return months;
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Shortfall by weekday, and each weekday's share of the whole. */
function bucketByWeekday(items: Reconciliation[]): WeekdayPoint[] {
  const points: WeekdayPoint[] = WEEKDAYS.map((label) => ({ label, short: 0, share: 0, days: 0 }));
  for (const r of items) {
    if (r.status !== "reconciled" || (r.variance ?? 0) === 0) continue;
    // getUTCDay: 0 = Sunday. Accra is UTC, so noon UTC is the right day.
    const idx = (new Date(`${r.accraDay}T12:00:00Z`).getUTCDay() + 6) % 7;
    points[idx].days += 1;
    if ((r.variance ?? 0) < 0) points[idx].short += Math.abs(r.variance ?? 0);
  }
  const total = points.reduce((s, p) => s + p.short, 0);
  if (total > 0) for (const p of points) p.share = p.short / total;
  return points;
}

/* ------------------------------------------------------------------- page --- */

export default function ReconciliationBook({ loaderData }: Route.ComponentProps) {
  const {
    office,
    filters,
    page,
    total,
    counts,
    gapCount,
    collectors,
    rows,
    months,
    weekdays,
    queue,
    byCollector,
  } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const { search } = useLocation();

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), {
      replace: true,
      preventScrollReset: true,
    });

  const narrowed = Boolean(
    filters.collectorId || filters.varianceOnly || filters.from || filters.to,
  );
  const collectorName = collectors.find((c) => c.value === filters.collectorId)?.label;
  const busy = navigation.state === "loading";

  return (
    <Page className="max-w-none">
      <PageHeader
        title="Cash handover"
        description={
          office
            ? "Declare, count, and close every collector's day."
            : "The days you have closed, and what the office counted."
        }
        actions={
          <>
            <Button asChild>
              <Link to={`/reconciliation/declare${search}`} prefetch="intent" preventScrollReset>
                <HandCoinsIcon />
                Declare cash
              </Link>
            </Button>
          </>
        }
      />

      {/* The three figures the office asks for first, in the reference's order:
          what is done, what went wrong, what is still waiting. */}
      <dl className="mb-4 grid gap-4 sm:grid-cols-3">
        <Tile
          value={formatCount(counts.reconciled)}
          label="Days reconciled"
          icon={<CheckCheckIcon />}
          tone="success"
        />
        <Tile
          value={formatCount(gapCount)}
          label="Days with a gap"
          icon={<TriangleAlertIcon />}
          tone="danger"
        />
        <Tile
          value={formatCount(counts.declared)}
          label="Awaiting count"
          icon={<ClockIcon />}
          tone="info"
        />
      </dl>

      <div className={cn("grid gap-4 xl:grid-cols-12", busy && "opacity-70 transition-opacity")}>
        {/* ------------------------------------------------------ left --- */}
        <div className="space-y-4 xl:col-span-7">
          <Card
            title="Handover volume"
            subtitle="Closed days each month, over the last year"
            actions={
              <>
                <Button asChild variant="outline" size="xs">
                  <Link to={hrefFor({ ...filters, from: accraDaysAgo(HISTORY_DAYS), to: "" })} prefetch="intent">
                    See detail
                  </Link>
                </Button>
                <MoreMenu>
                  <DropdownMenuItem onSelect={() => apply({ varianceOnly: true })}>
                    Show only days with a gap
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => apply({ status: "declared" })}>
                    Show days awaiting count
                  </DropdownMenuItem>
                </MoreMenu>
              </>
            }
          >
            <div className="mb-3">
              <VolumeKey />
            </div>
            <VolumeChart points={months} />
          </Card>

          <Card
            flush
            title="Handover book"
            subtitle="What each collector declared, and what the office counted"
            actions={
              <>
                {office && collectors.length > 0 && (
                  <ChoiceFilter
                    value={filters.collectorId}
                    options={collectors}
                    apply={(next) => apply({ collectorId: next })}
                    title="Collector"
                    allLabel="Every collector"
                    width="w-56"
                  />
                )}
                <Button
                  variant="outline"
                  size="sm"
                  aria-pressed={filters.varianceOnly}
                  onClick={() => apply({ varianceOnly: !filters.varianceOnly })}
                  className={cn(filters.varianceOnly && "border-primary/50 text-primary")}
                >
                  <TriangleAlertIcon />
                  Gaps only
                </Button>
                <DayRangeFilter
                  from={filters.from}
                  to={filters.to}
                  apply={(next) => apply(next)}
                  title="Day"
                />
                {office && (
                  <ExportMenu
                    path="/reconciliation/export"
                    query={queryFor(filters).toString()}
                    total={total}
                    noun="day"
                  />
                )}
              </>
            }
          >
            <div className="border-b border-border px-4 py-2">
              <StatusTabs
                tabs={TABS.map((t) => ({ ...t, count: counts[t.key] }))}
                active={filters.status}
                hrefFor={(key) => hrefFor({ ...filters, status: key as Tab })}
              />
            </div>

            {narrowed && (
              <FilterBar total={total} noun="day" plural="days">
                {filters.collectorId && (
                  <FilterChip
                    label={collectorName ?? "One collector"}
                    onDrop={() => apply({ collectorId: "" })}
                  />
                )}
                {filters.varianceOnly && (
                  <FilterChip label="Gaps only" onDrop={() => apply({ varianceOnly: false })} />
                )}
                {(filters.from || filters.to) && (
                  <DayRangeChip
                    from={filters.from}
                    to={filters.to}
                    onDrop={() => apply({ from: "", to: "" })}
                  />
                )}
              </FilterBar>
            )}

            {rows.length === 0 ? (
              <Empty className="py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ScaleIcon />
                  </EmptyMedia>
                  <EmptyTitle>
                    {narrowed ? "Nothing matches" : "No day has been closed yet"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {narrowed
                      ? "Widen the filters, or clear them to see every day."
                      : "A collector declares what they are handing over, then the office counts it. Both halves show up here."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <Th>Day</Th>
                    {office && <Th>Collector</Th>}
                    <Th className="text-right">Expected</Th>
                    <Th className="text-right">Counted</Th>
                    <Th>Result</Th>
                    <Th className="text-right">Gap</Th>
                    <Th className="w-12 text-right">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="px-4 py-3 whitespace-nowrap">
                        <Link
                          to={`/reconciliation/${row.id}`}
                          prefetch="intent"
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {formatAccraDate(`${row.accraDay}T12:00:00Z`)}
                        </Link>
                      </TableCell>
                      {office && (
                        <TableCell className="px-4 py-3 whitespace-nowrap">{row.collectorName}</TableCell>
                      )}
                      <TableCell className="tabular px-4 py-3 text-right text-muted-foreground">
                        {formatPesewas(row.expected)}
                      </TableCell>
                      <TableCell className="tabular px-4 py-3 text-right">
                        {row.received == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          formatPesewas(row.received)
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <ResultBadge row={row} />
                      </TableCell>
                      <TableCell className="tabular px-4 py-3 text-right font-medium">
                        {row.variance == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          formatPesewas(Math.abs(row.variance))
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right">
                        <RowMenu row={row} office={office} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <ListingFooter
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              hrefFor={(p) => hrefFor(filters, p)}
            />
          </Card>
        </div>

        {/* ----------------------------------------------------- right --- */}
        <div className="space-y-4 xl:col-span-5">
          <Card
            title="Where the gaps fall"
            subtitle="Shortfall by weekday, over the last year"
            actions={
              <>
                {office && (
                  <ExportMenu
                    path="/reconciliation/variances/export"
                    query={queryFor(filters).toString()}
                    total={gapCount}
                    noun="collector"
                  />
                )}
                <Button asChild variant="outline" size="xs">
                  <Link to={hrefFor({ ...filters, varianceOnly: true })} prefetch="intent">
                    See detail
                  </Link>
                </Button>
              </>
            }
          >
            <BreakdownChart points={weekdays} />
          </Card>

          <Card
            flush
            title="Gaps to explain"
            subtitle="Counted days that did not balance, latest first"
            actions={
              <>
                <Button asChild variant="outline" size="xs">
                  <Link to={hrefFor({ ...filters, varianceOnly: true, status: "reconciled" })} prefetch="intent">
                    All gaps
                  </Link>
                </Button>
              </>
            }
          >
            {queue.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                Every counted day this year balanced.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <Th>Day</Th>
                    <Th>Gap</Th>
                    <Th>Reason</Th>
                    <Th>Status</Th>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="px-4 py-3 whitespace-nowrap">
                        <Link
                          to={`/reconciliation/${row.id}`}
                          prefetch="intent"
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {formatAccraDate(`${row.accraDay}T12:00:00Z`)}
                        </Link>
                        {office && (
                          <p className="text-xs text-muted-foreground">{row.collectorName}</p>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3 whitespace-nowrap">
                        <VarianceText variance={row.variance} />
                      </TableCell>
                      <TableCell className="max-w-48 truncate px-4 py-3 text-muted-foreground" title={row.reason}>
                        {row.reason || "No reason given"}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <Badge tone={row.reason ? "info" : "danger"}>
                          {row.reason ? "Explained" : "Unexplained"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          {/* Office only: the report is about the collectors, not for them.
              Shorts and overs are kept apart as well as netted — a collector
              short GH₵ 50 one day and over GH₵ 50 the next nets to zero and is
              not the same person as one who balances. */}
          {office && (
            <Card
              flush
              title="By collector"
              subtitle="Over the last year, worst first"
              actions={
                <ExportMenu
                  path="/reconciliation/variances/export"
                  query={queryFor(filters).toString()}
                  total={byCollector.length}
                  noun="collector"
                />
              }
            >
              {byCollector.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No collector has closed a day this year.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <Th>Collector</Th>
                      <Th className="text-right">Days</Th>
                      <Th className="text-right">With a gap</Th>
                      <Th className="text-right">Short</Th>
                      <Th className="text-right">Over</Th>
                      <Th className="text-right">Net</Th>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byCollector.map((c) => (
                      <CollectorRow key={c.collectorId} row={c} filters={filters} />
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* The declare drawer opens over the book. */}
      <Outlet />
    </Page>
  );
}

/* -------------------------------------------------------------- pieces --- */

/** A big number, a label under it, and the icon boxed top-right. */
function Tile({
  value,
  label,
  icon,
  tone,
}: {
  value: string;
  label: string;
  icon: ReactNode;
  tone: "success" | "danger" | "info";
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4">
      <div>
        <dd className="tabular font-heading text-3xl font-bold tracking-tight">{value}</dd>
        <dt className="mt-0.5 text-sm text-muted-foreground">{label}</dt>
      </div>
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
          tone === "success" && "bg-success-subtle text-success",
          tone === "danger" && "bg-danger-subtle text-danger",
          tone === "info" && "bg-info-subtle text-info",
        )}
        aria-hidden
      >
        {icon}
      </span>
    </div>
  );
}

/** A titled panel: heading and actions on one row, body under it. */
function Card({
  title,
  subtitle,
  actions,
  flush,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h3 className="font-heading text-base font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={cn(!flush && "px-5 pb-5", flush && "border-t border-border")}>{children}</div>
    </section>
  );
}

function MoreMenu({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-xs" className="text-muted-foreground">
          <MoreHorizontalIcon />
          <span className="sr-only">More</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The reference's coloured pill: tinted ground, coloured word. */
function Badge({ tone, children }: { tone: "success" | "danger" | "warning" | "info"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "success" && "bg-success-subtle text-success",
        tone === "danger" && "bg-danger-subtle text-danger",
        tone === "warning" && "bg-warning-subtle text-warning",
        tone === "info" && "bg-info-subtle text-info",
      )}
    >
      {children}
    </span>
  );
}

/** Balanced / Short / Over for a counted day; Awaiting count for the rest. */
function ResultBadge({ row }: { row: Row }) {
  if (row.pending) {
    return (
      <StatusPill
        label={STATUS_LABELS.declared}
        blurb={STATUS_BLURBS.declared}
        tone={STATUS_TONE.declared}
      />
    );
  }
  const kind = varianceKind(row.variance);
  return <Badge tone={VARIANCE_TONE[kind]}>{VARIANCE_LABELS[kind]}</Badge>;
}

function VarianceText({ variance }: { variance: number | null }) {
  if (variance == null) return <span className="text-muted-foreground">—</span>;
  const kind = varianceKind(variance);
  return (
    <span
      className={cn(
        "tabular text-sm font-medium",
        VARIANCE_TONE[kind] === "danger" && "text-danger",
        VARIANCE_TONE[kind] === "warning" && "text-warning",
        VARIANCE_TONE[kind] === "success" && "text-muted-foreground",
      )}
    >
      {kind === "square"
        ? VARIANCE_LABELS.square
        : `${VARIANCE_LABELS[kind]} ${formatPesewas(Math.abs(variance))}`}
    </span>
  );
}

/** One collector's year. The name filters the book to that collector. */
function CollectorRow({ row, filters }: { row: VarianceRow; filters: Filters }) {
  const net = varianceKind(row.netVariance);
  return (
    <TableRow>
      <TableCell className="px-4 py-3 whitespace-nowrap">
        <Link
          to={hrefFor({ ...filters, collectorId: row.collectorId })}
          prefetch="intent"
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.collectorName}
        </Link>
      </TableCell>
      <TableCell className="tabular px-4 py-3 text-right text-muted-foreground">
        {formatCount(row.days)}
      </TableCell>
      <TableCell className={cn("tabular px-4 py-3 text-right", row.daysWithVariance > 0 && "text-danger font-medium")}>
        {formatCount(row.daysWithVariance)}
      </TableCell>
      <TableCell className={cn("tabular px-4 py-3 text-right", row.totalShort > 0 ? "text-danger" : "text-muted-foreground")}>
        {row.totalShort > 0 ? formatPesewas(row.totalShort) : "—"}
      </TableCell>
      <TableCell className={cn("tabular px-4 py-3 text-right", row.totalOver > 0 ? "text-warning" : "text-muted-foreground")}>
        {row.totalOver > 0 ? formatPesewas(row.totalOver) : "—"}
      </TableCell>
      <TableCell className="px-4 py-3 text-right">
        {net === "square" ? (
          <Badge tone="success">Balanced</Badge>
        ) : (
          <VarianceText variance={row.netVariance} />
        )}
      </TableCell>
    </TableRow>
  );
}

function RowMenu({ row, office }: { row: Row; office: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground">
          <MoreHorizontalIcon />
          <span className="sr-only">
            Actions for {row.collectorName} on {row.accraDay}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild>
          <Link to={`/reconciliation/${row.id}`} prefetch="intent">
            <ScaleIcon />
            Open the day
          </Link>
        </DropdownMenuItem>
        {/* Counting is the office's half, and a collector may not confirm
            their own cash — drawn and disabled rather than hidden, which is how
            every row menu in this app says "not for you". */}
        <DropdownMenuItem asChild disabled={!office || !row.pending}>
          <Link to={`/reconciliation/${row.id}`} prefetch="intent">
            <HandCoinsIcon />
            Count and confirm
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
