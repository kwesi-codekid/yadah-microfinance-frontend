import {
  BanknoteArrowDownIcon,
  CircleAlertIcon,
  ClipboardListIcon,
  EllipsisIcon,
  EyeIcon,
  LandmarkIcon,
  PlusIcon,
  SettingsIcon,
  TrendingUpIcon,
  UserIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { data, Link, Outlet, useLocation, useNavigation, useSubmit } from "react-router";

import { listLoans } from "~/api/loans";
import { getDashboardSummary } from "~/api/dashboard";
import { getLoanAging, getOutstandingLoans } from "~/api/reports";
import {
  DayRangeChip,
  DayRangeFilter,
  ExportMenu,
  FilterBar,
  FilterChip,
  FilterMenu,
  ListingFooter,
  ListingToolbar,
  SearchBox,
} from "~/components/listing";
import { Page } from "~/components/page";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  accraDay,
  formatAccraDate,
  formatCedisCompact,
  formatCount,
  formatPesewas,
  relativeDayLabel,
} from "~/lib/format";
import {
  LOAN_STATUS_BLURBS,
  LOAN_STATUS_LABELS,
  TIER_LABELS,
  daysOverdue,
  isOpen,
  isPending,
  repaymentProgress,
  type Loan,
  type LoanStatus,
} from "~/lib/loans";
import { amountOf } from "~/lib/reports";
import { isOffice } from "~/lib/auth";
import { requireCounter, withAuth } from "~/lib/session.server";
import { useCurrentUser } from "~/lib/use-current-user";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/loans";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Loans · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = {
  title: "Loan Management",
};

const PAGE_SIZE = 20;

const STATUSES: LoanStatus[] = ["pending", "active", "arrears", "repaid", "rejected"];

const TABS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "active", label: "Active" },
  { key: "arrears", label: "Arrears" },
  { key: "repaid", label: "Repaid" },
  { key: "rejected", label: "Rejected" },
] as const;
type Tab = (typeof TABS)[number]["key"];

interface Filters {
  status: Tab;
  search: string;
  /** Inclusive Accra days on when the loan was applied for. */
  from: string;
  to: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function readFilters(url: URL): Filters {
  const statusParam = url.searchParams.get("status") as LoanStatus | null;
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : "";
  };
  return {
    status: statusParam && STATUSES.includes(statusParam) ? statusParam : "all",
    search: url.searchParams.get("search")?.trim() ?? "",
    from: day("from"),
    to: day("to"),
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status !== "all") p.set("status", f.status);
  if (f.search) p.set("search", f.search);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (page > 1) p.set("page", String(page));
  return p;
}

function hrefFor(f: Filters, page = 1): string {
  const s = queryFor(f, page).toString();
  return s ? `/loans?${s}` : "/loans";
}

/** How far ahead "due soon" looks, in Accra days. */
const DUE_SOON_DAYS = 7;

/**
 * `GET /loans` — the loan book, laid out as the loan-management dashboard.
 *
 * The book itself is the table at the bottom; everything above it is the same
 * book read three more ways, from the API's own reporting surface:
 *
 *   Figures        the per-status counts (scoped like the status menu)
 *   Book by status the same counts, drawn
 *   Performance    GET /dashboard/summary — portfolio.loans and today's repayments
 *   Needs attention  derived from the counts, the aging buckets and what falls due
 *   Due soon       GET /reports/loans/outstanding, soonest due first
 *
 * There is no automatic decision anywhere in this module: every pending row is
 * waiting on a person. That is why `Pending` is second in the menu and carries
 * a count — it is a queue, not a status. The reports are read best-effort: one of
 * them failing must not take the book down with it.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireCounter(request);
  const url = new URL(request.url);

  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    // The status counts have to survive the search and the date range, otherwise
    // "Pending 3" contradicts a filtered list showing one row.
    const scope = {
      search: filters.search || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    };
    const [list, dashboard, outstanding, aging, ...counts] = await Promise.all([
      listLoans(token, {
        ...scope,
        page,
        limit: PAGE_SIZE,
        status: filters.status === "all" ? undefined : filters.status,
      }),
      getDashboardSummary(token).catch(() => null),
      getOutstandingLoans(token).catch(() => null),
      getLoanAging(token).catch(() => null),
      ...STATUSES.map((status) =>
        listLoans(token, { ...scope, page: 1, limit: 1, status }),
      ),
    ]);
    return { list, dashboard, outstanding, aging, counts };
  });

  const byStatus = Object.fromEntries(
    STATUSES.map((s, i) => [s, result.counts[i].total]),
  ) as Record<LoanStatus, number>;

  const now = new Date();
  const today = accraDay(now);

  /* ---- what is out there, soonest due first ---- */
  const outstandingRows = (
    result.outstanding?.rows ??
    result.outstanding?.items ??
    []
  )
    .map((row) => {
      const dueDay = row.dueDate ? accraDay(new Date(row.dueDate)) : null;
      return {
        id: row.loanId ?? row.id ?? "",
        customerName: row.customerName ?? "Customer",
        remaining: row.remaining ?? 0,
        dueDay,
        /** Positive when late, negative while still ahead, null without a date. */
        daysLate: dueDay ? dayDiff(today, dueDay) : null,
      };
    })
    .filter((row) => row.id);

  const dueSoon = outstandingRows
    .filter((r) => r.daysLate !== null && r.daysLate > -DUE_SOON_DAYS)
    .sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0));

  const fallingDue = outstandingRows.filter(
    (r) => r.daysLate !== null && r.daysLate <= 0 && r.daysLate > -DUE_SOON_DAYS,
  );

  const outstandingTotal =
    amountOf(result.outstanding?.totals ?? {}) ||
    outstandingRows.reduce((n, r) => n + r.remaining, 0);

  /* ---- aging: the 90+ bucket under every name it is known by ---- */
  const buckets = result.aging?.buckets ?? {};
  const byRow = new Map(
    (result.aging?.rows ?? []).map((r) => [String(r.bucket ?? ""), r]),
  );
  const bucketOf = (keys: string[]) =>
    keys.map((k) => buckets[k]).find(Boolean) ??
    keys.map((k) => byRow.get(k)).find(Boolean) ??
    {};
  const over90 = bucketOf(["90+", "90plus", "over90", "days90plus", "bucket3"]);
  const arrearsAmount = amountOf(result.aging?.total ?? {});

  const portfolio = result.dashboard?.portfolio.loans ?? null;

  return data(
    {
      filters,
      page,
      total: result.list.total,
      counts: {
        all: STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
        ...byStatus,
      },
      rows: result.list.items.map((loan) => toRow(loan, now, today)),
      performance: {
        read: portfolio !== null,
        active: portfolio?.active ?? byStatus.active,
        arrears: portfolio?.arrears ?? byStatus.arrears,
        outstanding: portfolio?.outstanding ?? outstandingTotal,
        repaidToday: result.dashboard?.today.in.loanRepayments ?? null,
        arrearsAmount,
      },
      attention: {
        pending: byStatus.pending,
        arrears: byStatus.arrears,
        over90: { count: over90.count ?? 0, amount: over90.amount ?? 0 },
        fallingDue: {
          count: fallingDue.length,
          amount: fallingDue.reduce((n, r) => n + r.remaining, 0),
        },
        agingRead: result.aging !== null,
      },
      dueSoon: {
        read: result.outstanding !== null,
        items: dueSoon.slice(0, 5).map((r) => ({
          id: r.id,
          customerName: r.customerName,
          remaining: r.remaining,
          due: dueLabel(r.daysLate ?? 0, r.dueDay),
          late: (r.daysLate ?? 0) > 0,
          today: r.daysLate === 0,
        })),
        more: Math.max(0, dueSoon.length - 5),
      },
    },
    { headers },
  );
}

/** Opening the "new application" drawer does not re-read the listing. */
export const shouldRevalidate = drawerParentShouldRevalidate;

/** Whole Accra days from `a` back to `b` — positive when `b` is in the past. */
function dayDiff(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000,
  );
}

function dueLabel(daysLate: number, dueDay: string | null): string {
  if (daysLate > 0) return `Overdue ${formatCount(daysLate)} day${daysLate === 1 ? "" : "s"}`;
  if (daysLate === 0) return "Due today";
  if (daysLate === -1) return "Due tomorrow";
  if (daysLate > -DUE_SOON_DAYS) return `Due in ${-daysLate} days`;
  return dueDay ? `Due ${formatAccraDate(`${dueDay}T12:00:00Z`)}` : "No due date";
}

/* -------------------------------------------------------------------- rows --- */

interface Row {
  id: string;
  /** The tail of the id, the way it is read out at the counter. */
  ref: string;
  customerId: string;
  customerName: string;
  tier: string;
  principal: number;
  ratePercent: number;
  durationMonths: number;
  /** True once the rate has climbed the escalation ladder at least once. */
  escalated: boolean;
  frozen: boolean;
  /** `principal + interestAmount` at the rate in force now. */
  totalDue: number;
  interest: number;
  totalRepaid: number;
  remaining: number;
  progress: number;
  status: LoanStatus;
  applied: string;
  /** The last instalment's due day, absent until the loan is approved. */
  due: string | null;
  /** Whole days past the due date, or null while the loan is not late. */
  overdue: number | null;
  open: boolean;
  pending: boolean;
}

function toRow(loan: Loan, now: Date, today: string): Row {
  const dueDay = loan.dueDate ? accraDay(new Date(loan.dueDate)) : null;
  return {
    id: loan.id,
    ref: `#L${loan.id.slice(-5).toUpperCase()}`,
    customerId: loan.customerId,
    customerName: loan.customerName ?? "—",
    tier: TIER_LABELS[loan.tier],
    principal: loan.principal,
    ratePercent: loan.ratePercent,
    durationMonths: loan.durationMonths,
    escalated: Boolean(loan.escalatedAt),
    frozen: loan.frozen,
    totalDue: loan.totalDue,
    interest: loan.interestAmount,
    totalRepaid: loan.totalRepaid,
    remaining: loan.remaining,
    progress: repaymentProgress(loan),
    status: loan.status,
    applied: relativeDayLabel(loan.appliedAt, now),
    due: dueDay,
    overdue: daysOverdue(dueDay, today),
    open: isOpen(loan),
    pending: isPending(loan),
  };
}

/* ----------------------------------------------------------------- palette --- */
/* The reference's coral / navy / sky, read from the theme so the night palette
   restyles the charts. SVG colours go through `style`, because attribute values
   cannot resolve CSS variables. */
const CORAL = "var(--chart-1)";
const NAVY = "var(--chart-2)";
const SKY = "var(--chart-3)";
const STONE = "var(--chart-4)";
const MIST = "var(--chart-5)";
const FG = "var(--color-foreground)";
const TRACK = "var(--color-muted)";

/** Which series each status wears, everywhere on this page. */
const STATUS_COLOR: Record<LoanStatus, string> = {
  pending: SKY,
  active: NAVY,
  arrears: CORAL,
  repaid: STONE,
  rejected: MIST,
};

/** The reference's tinted status pill — the app's tones on their subtle steps. */
const PILL: Record<LoanStatus, string> = {
  pending: "bg-info-subtle text-info",
  active: "bg-success-subtle text-success",
  arrears: "bg-danger-subtle text-danger",
  repaid: "bg-muted text-muted-foreground",
  rejected: "bg-muted text-muted-foreground",
};

/* -------------------------------------------------------------------- page --- */

export default function Loans({ loaderData }: Route.ComponentProps) {
  const { filters, page, total, counts, rows, performance, attention, dueSoon } =
    loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const { search } = useLocation();
  // The counter takes applications and takes repayments. Downloading the book
  // and setting the rates it lends at are the office's.
  const office = isOffice(useCurrentUser());

  const busy =
    navigation.state === "loading" && navigation.location?.pathname === "/loans";

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), {
      replace: true,
      preventScrollReset: true,
    });

  const narrowed = Boolean(filters.search || filters.from || filters.to);

  // The status views in the menu, each with its count under the same scope.
  const railItems = TABS.map((t) => ({
    key: t.key,
    label: t.label,
    count: counts[t.key],
    to: hrefFor({ ...filters, status: t.key as Tab }),
  }));

  return (
    <Page className="max-w-none px-5 pt-1 pb-5 sm:px-8">
      <div className="space-y-4">
        {/* The two reading columns. The book below is not one of them — it
            is the whole page wide, because a nine-column table squeezed into
            two thirds of the width is a scrollbar, not a table. */}
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.66fr)_minmax(0,1fr)]">
          {/* ------------------------------------------------- left column --- */}
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat
                value={formatCount(counts.all)}
                label={narrowed ? "Loans matching filters" : "Total loans"}
                icon={ClipboardListIcon}
                tint={1}
              />
              <Stat
                value={formatCount(counts.pending)}
                label="Pending applications"
                icon={LandmarkIcon}
                tint={3}
                to={hrefFor({ ...filters, status: "pending" })}
              />
              <Stat
                value={formatCount(counts.arrears)}
                label="Loans in arrears"
                icon={CircleAlertIcon}
                tint={2}
                to={hrefFor({ ...filters, status: "arrears" })}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card title="Loan Book Overview" detailTo="/reports/loans">
                <BookBars counts={counts} filters={filters} />
              </Card>
              <Card title="Portfolio Performance" detailTo="/reports/loans">
                <Performance
                  {...performance}
                  pending={counts.pending}
                  repaid={counts.repaid}
                />
              </Card>
            </div>
          </div>

          {/* ------------------------------------------------ right column --- */}
          <div className="space-y-4">
            <Card title="Needs Attention" detailTo="/reports/loans">
              <Attention {...attention} filters={filters} />
            </Card>

            <Card title="Due Soon & Overdue" detailTo="/reports/loans">
              <DueSoon {...dueSoon} />
            </Card>
          </div>
        </div>

        {/* --------------------------------------------- the book, full width --- */}
        <section className="overflow-hidden rounded-2xl bg-card text-card-foreground">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
            <h3 className="text-[15px] font-bold tracking-tight">Loan Application Table</h3>
            <div className="flex items-center gap-2">
              {office && (
                <ExportMenu
                  path="/loans/export"
                  query={(() => {
                    const p = queryFor(filters);
                    p.delete("page");
                    return p.toString();
                  })()}
                  total={total}
                  noun="loan"
                />
              )}
              {/* The rates and limits new lending runs on. A drawer, so the
                  book stays underneath while they are changed. */}
              {office && (
                <Button asChild variant="outline" size="sm">
                  <Link to={`/loans/config${search}`} prefetch="intent" preventScrollReset>
                    <SettingsIcon />
                    Settings
                  </Link>
                </Button>
              )}
              <Button asChild size="sm">
                <Link to={`/loans/new${search}`} prefetch="intent" preventScrollReset>
                  <PlusIcon />
                  New application
                </Link>
              </Button>
            </div>
          </div>

          <ListingToolbar
            tabs={<FilterMenu label="Status" items={railItems} active={filters.status} />}
          >
            <SearchBox
              value={filters.search}
              apply={(next) => apply({ search: next })}
              hidden={{
                status: filters.status === "all" ? "" : filters.status,
                from: filters.from,
                to: filters.to,
              }}
              placeholder="Search customer name or phone"
              label="Search loans"
              busy={busy}
            />
            <DayRangeFilter
              from={filters.from}
              to={filters.to}
              title="Applied"
              apply={(next) => apply(next)}
            />
          </ListingToolbar>

          {narrowed && (
            <FilterBar total={total}>
              {filters.search && (
                <FilterChip
                  onDrop={() => apply({ search: "" })}
                  label={`“${filters.search}”`}
                />
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
            <LoansEmpty filters={filters} narrowed={narrowed} />
          ) : (
            <div
              className={cn(
                "overflow-x-auto px-4 transition-opacity sm:px-5",
                busy && "opacity-60",
              )}
            >
              <table className="w-full min-w-5xl text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                    <th className="py-2.5 pr-3 font-medium">Loan ID</th>
                    <th className="w-[16%] py-2.5 pr-3 font-medium">Customer</th>
                    <th className="py-2.5 pr-3 font-medium">Tier</th>
                    <th className="py-2.5 pr-3 text-right font-medium">Term</th>
                    <th className="py-2.5 pr-3 text-right font-medium">Principal</th>
                    <th className="py-2.5 pr-3 text-right font-medium">Rate</th>
                    <th className="py-2.5 pr-3 text-right font-medium">Total due</th>
                    <th className="py-2.5 pr-3 text-right font-medium">Repaid</th>
                    <th className="w-[12%] py-2.5 pr-3 text-right font-medium">Remaining</th>
                    <th className="py-2.5 pr-3 font-medium">Applied</th>
                    <th className="py-2.5 pr-3 font-medium">Due</th>
                    <th className="py-2.5 pr-3 font-medium">Status</th>
                    <th className="w-10 py-2.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <LoanRow key={row.id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <ListingFooter
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            hrefFor={(p) => hrefFor(filters, p)}
          />
        </section>
      </div>

      {/* The application drawer renders here, over the book. */}
      <Outlet />
    </Page>
  );
}

/* --------------------------------------------------------------- chrome bits --- */

/**
 * The white card every block sits in, with the reference header row.
 *
 * Both ways out of the header land in the portfolio report, which is the
 * office's. The counter reads the same book — it is what they lend against —
 * without being shown a door that would turn them around.
 */
function Card({
  title,
  detailTo,
  children,
}: {
  title: string;
  detailTo: string;
  children: ReactNode;
}) {
  const office = isOffice(useCurrentUser());

  return (
    <section className="rounded-2xl bg-card p-4 text-card-foreground sm:p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold tracking-tight">{title}</h3>
        {office && (
          <div className="flex items-center gap-1.5">
            <Link
              to={detailTo}
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
                  <Link to={detailTo}>Open loan portfolio report</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/reports/loans/export?format=csv">Download as CSV</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>
      {children}
    </section>
  );
}

function Stat({
  value,
  label,
  icon: Icon,
  tint,
  to,
}: {
  value: string;
  label: string;
  icon: typeof ClipboardListIcon;
  /** Which avatar-tint family colours the icon square — themed in both modes. */
  tint: 1 | 2 | 3 | 4;
  /** Where the figure leads — a count of pending loans opens the pending tab. */
  to?: string;
}) {
  const body = (
    <>
      <span
        className="absolute top-3.5 right-3.5 rounded-lg p-2"
        style={{ background: `var(--tint-${tint}-bg)` }}
      >
        <Icon className="size-4" style={{ color: `var(--tint-${tint}-fg)` }} />
      </span>
      <p className="tabular text-[22px] font-bold tracking-tight">{value}</p>
      <p className="mt-1 pr-10 text-xs text-muted-foreground">{label}</p>
    </>
  );
  const className = "relative block rounded-2xl bg-card p-4 text-card-foreground";
  return to ? (
    <Link
      to={to}
      preventScrollReset
      className={cn(className, "transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none")}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/* ------------------------------------------------------------ book by status --- */

/**
 * The five states as the reference's rounded columns, tallest first-to-last in
 * the order a loan moves through them. Each column is banded — three steps of
 * the same hue fading upward — with the count sitting in a bubble at the top,
 * and each is a door into its tab.
 */
function BookBars({
  counts,
  filters,
}: {
  counts: Record<Tab, number>;
  filters: Filters;
}) {
  const peak = Math.max(1, ...STATUSES.map((s) => counts[s]));
  return (
    <div>
      <div className="flex h-52 items-end justify-between gap-2 px-1">
        {STATUSES.map((status) => {
          const share = counts[status] / peak;
          return (
            <Link
              key={status}
              to={hrefFor({ ...filters, status })}
              preventScrollReset
              title={`${LOAN_STATUS_LABELS[status]} — ${LOAN_STATUS_BLURBS[status]}`}
              className="group flex h-full w-full max-w-14 flex-col justify-end focus-visible:outline-none"
            >
              <span
                className="relative flex flex-col justify-end overflow-hidden rounded-2xl transition-[height] duration-500 ease-out group-hover:opacity-90 motion-reduce:transition-none"
                style={{
                  height: `${Math.max(18, share * 100)}%`,
                  background: STATUS_COLOR[status],
                }}
              >
                {/* the three fading bands */}
                <span className="absolute inset-x-0 top-0 h-1/3 bg-card/45" aria-hidden />
                <span className="absolute inset-x-0 top-1/3 h-1/3 bg-card/20" aria-hidden />
                <span className="tabular relative z-10 mx-auto mb-auto mt-2 rounded-full bg-card/85 px-2 py-0.5 text-[11px] font-bold text-foreground">
                  {formatCount(counts[status])}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between gap-2 px-1">
        {STATUSES.map((status) => (
          <span
            key={status}
            className="w-full max-w-14 text-center text-[10.5px] leading-tight text-muted-foreground"
          >
            {LOAN_STATUS_LABELS[status]}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- performance --- */

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

/**
 * The reference's nested half-rings, each one a share of the book:
 *
 *   outer   navy   on time — active loans as a share of everything open
 *   second  coral  in arrears — the rest of what is open
 *   third   sky    settled — repaid loans as a share of all decided loans
 *   inner   mist   waiting — pending as a share of the whole book
 *
 * The four figures underneath are the ones the office actually asks for:
 * what is out there, what came back today, and how many loans are on either
 * side of the line.
 */
function Performance({
  read,
  active,
  arrears,
  outstanding,
  repaidToday,
  arrearsAmount,
  pending,
  repaid,
}: {
  read: boolean;
  active: number;
  arrears: number;
  outstanding: number;
  repaidToday: { count: number; amount: number } | null;
  arrearsAmount: number;
  pending: number;
  repaid: number;
}) {
  const open = active + arrears;
  const onTime = open ? active / open : 0;
  const late = open ? arrears / open : 0;
  const decided = open + repaid;
  const settled = decided ? repaid / decided : 0;
  const book = decided + pending;
  const waiting = book ? pending / book : 0;

  const cx = 130;
  const cy = 122;
  const rings = [
    { r: 108, share: onTime, color: NAVY, label: "On time" },
    { r: 86, share: late, color: CORAL, label: "In arrears" },
    { r: 64, share: settled, color: SKY, label: "Settled" },
    { r: 42, share: waiting, color: MIST, label: "Waiting" },
  ];

  return (
    <div>
      <svg
        viewBox="0 0 260 130"
        className="mx-auto h-auto w-full max-w-72"
        role="img"
        aria-label={`${Math.round(onTime * 100)}% of open loans on time, ${Math.round(late * 100)}% in arrears, ${Math.round(settled * 100)}% of decided loans settled`}
      >
        {rings.map((ring) => (
          <g key={ring.label}>
            <path
              d={arcPath(cx, cy, ring.r, -90, 90)}
              fill="none"
              strokeWidth="11"
              strokeLinecap="round"
              style={{ stroke: TRACK }}
            />
            {ring.share > 0 && (
              <path
                d={arcPath(cx, cy, ring.r, -90, -90 + Math.max(2, ring.share * 180))}
                fill="none"
                strokeWidth="11"
                strokeLinecap="round"
                style={{ stroke: ring.color }}
              >
                <title>
                  {ring.label}: {Math.round(ring.share * 100)}%
                </title>
              </path>
            )}
          </g>
        ))}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          fontSize="20"
          fontWeight="700"
          style={{ fill: FG }}
        >
          {Math.round(onTime * 100)}%
        </text>
        <text
          x={cx}
          y={cy + 8}
          textAnchor="middle"
          fontSize="8"
          style={{ fill: "var(--color-muted-foreground)" }}
        >
          on time
        </text>
      </svg>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <Reading color={NAVY} label="Outstanding" value={formatCedis(outstanding)} />
        <Reading
          color={SKY}
          label="Repaid today"
          value={repaidToday ? formatCedis(repaidToday.amount) : "—"}
          hint={
            repaidToday
              ? `${formatCount(repaidToday.count)} repayment${repaidToday.count === 1 ? "" : "s"}`
              : "dashboard unavailable"
          }
        />
        <Reading color={CORAL} label="In arrears" value={formatCount(arrears)} hint={arrearsAmount ? formatCedis(arrearsAmount) : undefined} />
        <Reading color={MIST} label="Active loans" value={formatCount(active)} hint={read ? undefined : "from the book"} />
      </dl>
    </div>
  );
}

/** `GH₵ 12,400.00` is a receipt figure; a card wants `GH₵12.4k`. */
function formatCedis(pesewas: number): string {
  return `GH₵${formatCedisCompact(pesewas)}`;
}

function Reading({
  color,
  label,
  value,
  hint,
}: {
  color: string;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        {label}
      </dt>
      <dd className="tabular mt-0.5 text-sm font-bold">{value}</dd>
      {hint && <dd className="text-[10px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/* ------------------------------------------------------------------ attention --- */

/**
 * The reference's "recommendations", without pretending a model wrote them.
 * Each line is a rule the office already works by, stated with today's figures
 * and a door to the rows it is about. Only what applies is shown — an empty
 * panel is the good news, and it says so.
 */
function Attention({
  pending,
  arrears,
  over90,
  fallingDue,
  agingRead,
  filters,
}: {
  pending: number;
  arrears: number;
  over90: { count: number; amount: number };
  fallingDue: { count: number; amount: number };
  agingRead: boolean;
  filters: Filters;
}) {
  const office = isOffice(useCurrentUser());
  const items: { accent: string; title: string; body: string; to: string; cta: string }[] = [];

  if (pending > 0) {
    items.push({
      accent: SKY,
      title: `${formatCount(pending)} application${pending === 1 ? "" : "s"} waiting on a decision`,
      body: "Nothing is disbursed until someone approves it. The queue is oldest first — the customer at the top has waited longest.",
      to: hrefFor({ ...filters, status: "pending" }),
      cta: "Review queue",
    });
  }

  if (arrears > 0) {
    const tail =
      agingRead && over90.count > 0
        ? ` ${formatCount(over90.count)} ${over90.count === 1 ? "is" : "are"} past 90 days (${formatPesewas(over90.amount)}) and in debt recovery.`
        : "";
    items.push({
      accent: CORAL,
      title: `${formatCount(arrears)} loan${arrears === 1 ? "" : "s"} past due`,
      body: `The rate escalates on each of these until it is brought current, and interest is recomputed on the original principal.${tail}`,
      to: hrefFor({ ...filters, status: "arrears" }),
      cta: "Open arrears",
    });
  }

  if (fallingDue.count > 0) {
    items.push({
      accent: NAVY,
      title: `${formatCount(fallingDue.count)} loan${fallingDue.count === 1 ? "" : "s"} due within ${DUE_SOON_DAYS} days`,
      body: `${formatPesewas(fallingDue.amount)} still owed against them. A reminder before the date costs less than an escalation after it.`,
      // The report says which; the counter, who cannot open it, is sent to the
      // running loans instead — the same loans, one filter short.
      to: office ? "/reports/loans" : hrefFor({ ...filters, status: "active" }),
      cta: "See what is due",
    });
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nothing needs attention.</p>
    );
  }

  return (
    <div className="space-y-5">
      {items.map((item) => (
        <div key={item.title} className="border-l-2 pl-3" style={{ borderColor: item.accent }}>
          <p className="text-[13px] font-semibold">{item.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
          <Link
            to={item.to}
            preventScrollReset
            className="mt-2.5 inline-block rounded-full bg-primary px-3.5 py-1.5 text-[11px] font-medium text-primary-foreground transition-transform duration-150 hover:scale-[1.03] motion-reduce:transition-none"
          >
            {item.cta}
          </Link>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- due soon --- */

/** The reference's task list: what falls due next, latest first. */
function DueSoon({
  read,
  items,
  more,
}: {
  read: boolean;
  items: {
    id: string;
    customerName: string;
    remaining: number;
    due: string;
    late: boolean;
    today: boolean;
  }[];
  more: number;
}) {
  const office = isOffice(useCurrentUser());

  if (!read) {
    return (
      <p className="text-sm text-muted-foreground">
        Could not read what falls due.
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No open loan falls due in the next {DUE_SOON_DAYS} days, and none is late.
      </p>
    );
  }
  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <Link
          key={item.id}
          to={`/loans/${item.id}`}
          className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-3 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{item.customerName}</p>
            <p
              className={cn(
                "mt-0.5 text-xs",
                item.late ? "text-danger" : item.today ? "text-warning" : "text-muted-foreground",
              )}
            >
              {item.due}
              <span className="text-muted-foreground"> · {formatPesewas(item.remaining)} owed</span>
            </p>
          </div>
          <span
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              item.late ? "bg-danger" : item.today ? "bg-warning" : "bg-success",
            )}
            aria-hidden
          />
        </Link>
      ))}
      {/* The tail of the list lives in the report, so it is only a link for
          somebody who can open one. The count is worth saying either way. */}
      {more > 0 &&
        (office ? (
          <Link
            to="/reports/loans"
            className="block pt-1 text-center text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {formatCount(more)} more in the portfolio report
          </Link>
        ) : (
          <p className="block pt-1 text-center text-xs font-medium text-muted-foreground">
            {formatCount(more)} more falling due
          </p>
        ))}
    </div>
  );
}

/* ----------------------------------------------------------------------- rows --- */

function LoanRow({ row }: { row: Row }) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="tabular py-3 pr-3 whitespace-nowrap text-muted-foreground">
        <Link to={`/loans/${row.id}`} className="hover:text-foreground" title={row.id}>
          {row.ref}
        </Link>
      </td>

      <td className="py-3 pr-3">
        <Link
          to={`/loans/${row.id}`}
          className="block truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {row.customerName}
        </Link>
        <p className="tabular truncate text-[11px] text-muted-foreground">
          {row.status === "rejected" || row.status === "pending"
            ? LOAN_STATUS_BLURBS[row.status]
            : `${Math.round(row.progress * 100)}% repaid`}
        </p>
      </td>

      <td className="py-3 pr-3 whitespace-nowrap">{row.tier}</td>

      <td className="tabular py-3 pr-3 text-right whitespace-nowrap">
        {row.durationMonths} mo
      </td>

      <td className="tabular py-3 pr-3 text-right whitespace-nowrap">
        {formatPesewas(row.principal)}
      </td>

      {/* The rate is the one figure on a loan that moves. When it has climbed
          the ladder it says so here rather than only on the detail page —
          otherwise a row shows an interest figure nobody can reconcile. */}
      <td className="py-3 pr-3 text-right whitespace-nowrap">
        <span
          className={cn(
            "tabular inline-flex items-center gap-1",
            row.escalated && "font-semibold text-warning",
          )}
          title={
            row.escalated
              ? row.frozen
                ? "Escalated to the top of the ladder — the rate can rise no further."
                : "The rate has escalated since approval."
              : undefined
          }
        >
          {row.escalated && <TrendingUpIcon className="size-3.5" />}
          {row.ratePercent}%
        </span>
      </td>

      {/* `totalDue` is principal + interest at the *current* rate, so on an
          escalated loan it is not what was signed for. The interest under it
          is what makes the figure reconcilable. */}
      <td className="py-3 pr-3 text-right whitespace-nowrap">
        <span className="tabular">{formatPesewas(row.totalDue)}</span>
        <span className="tabular block text-[11px] text-muted-foreground">
          +{formatPesewas(row.interest)}
        </span>
      </td>

      <td className="tabular py-3 pr-3 text-right whitespace-nowrap text-muted-foreground">
        {formatPesewas(row.totalRepaid)}
      </td>

      <td className="py-3 pr-3 text-right whitespace-nowrap">
        <span className="tabular font-semibold">{formatPesewas(row.remaining)}</span>
        {row.open && (
          <span
            className="mt-1 block h-1 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${Math.round(row.progress * 100)}% repaid`}
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${row.progress * 100}%`,
                background: row.status === "arrears" ? CORAL : NAVY,
              }}
            />
          </span>
        )}
      </td>

      <td className="py-3 pr-3 whitespace-nowrap text-muted-foreground">{row.applied}</td>

      {/* No due date until approval builds the schedule — an em dash, not a
          blank, so the column reads as empty rather than broken. */}
      <td
        className={cn(
          "tabular py-3 pr-3 whitespace-nowrap",
          row.overdue !== null && row.status !== "repaid"
            ? "text-danger"
            : "text-muted-foreground",
        )}
      >
        {row.due ? formatAccraDate(`${row.due}T12:00:00Z`) : "—"}
      </td>

      <td className="py-3 pr-3 whitespace-nowrap">
        <span
          className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", PILL[row.status])}
          title={LOAN_STATUS_BLURBS[row.status]}
        >
          {LOAN_STATUS_LABELS[row.status]}
        </span>
        {row.overdue !== null && row.status !== "repaid" && (
          <p className="tabular mt-1 text-[11px] text-danger">
            {formatCount(row.overdue)} {row.overdue === 1 ? "day" : "days"} past due
          </p>
        )}
      </td>

      {/* Every row carries the same menu, closed loans included. The state
          decides which items are usable, not whether the trigger exists — an
          actions column that is blank on some rows reads as broken. */}
      <td className="py-3 pl-3 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${row.customerName}’s loan`}
            className="inline-flex size-6 items-center justify-center rounded-full border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <EllipsisIcon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild>
              <Link to={`/loans/${row.id}`}>
                <EyeIcon />
                {row.pending ? "Review application" : "View loan"}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild disabled={!row.open}>
              <Link to={`/loans/${row.id}/repay`} prefetch="intent">
                <BanknoteArrowDownIcon />
                Record repayment
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to={`/customers/${row.customerId}`}>
                <UserIcon />
                Customer
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

function LoansEmpty({ filters, narrowed }: { filters: Filters; narrowed: boolean }) {
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LandmarkIcon className="size-6" />
        </EmptyMedia>
        <EmptyTitle>
          {narrowed
            ? "No matches"
            : filters.status === "all"
              ? "No loans yet"
              : filters.status === "pending"
                ? "Nothing waiting on a decision"
                : `Nothing ${filters.status}`}
        </EmptyTitle>
        <EmptyDescription>
          {filters.search
            ? `Nothing matched “${filters.search}”. Search by customer name or phone.`
            : narrowed
              ? "No loan matches those filters."
              : "Record an application and it will queue here for a decision."}
        </EmptyDescription>
      </EmptyHeader>
      {narrowed ? (
        <Button asChild variant="outline" size="sm">
          <Link to={hrefFor({ ...filters, search: "", from: "", to: "" })}>
            Clear filters
          </Link>
        </Button>
      ) : filters.status === "all" ? (
        <Button asChild size="sm">
          <Link to="/loans/new">
            <PlusIcon />
            New application
          </Link>
        </Button>
      ) : null}
    </Empty>
  );
}
