import {
  AlertTriangleIcon,
  BanknoteArrowDownIcon,
  BanknoteIcon,
  EllipsisIcon,
  HandCoinsIcon,
  EyeIcon,
  FileTextIcon,
  LandmarkIcon,
  PlusIcon,
  SettingsIcon,
  TrendingUpIcon,
  UploadIcon,
  UserIcon,
  WalletIcon,
} from "lucide-react";
import {
  data,
  Link,
  Outlet,
  useLocation,
  useNavigation,
  useSubmit,
} from "react-router";

import { listLoans, type LoanTotals } from "~/api/loans";
import { FilterRail, RailFrame } from "~/components/filter-rail";
import {
  DayRangeChip,
  DayRangeFilter,
  ExportMenu,
  FilterBar,
  FilterChip,
  ListingFooter,
  SearchBox,
} from "~/components/listing";
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

const STATUSES: LoanStatus[] = [
  "pending",
  "active",
  "arrears",
  "repaid",
  "rejected",
];

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

/**
 * `GET /loans` — the loan book, as a table with its filters in the rail.
 *
 * The per-status counts ride along with the page so the rail can show them.
 * There is no automatic decision anywhere in this module: every pending row is
 * waiting on a person. That is why `Pending` is second in the rail and carries
 * a count — it is a queue, not a status.
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
    // The money cards cover the search and the dates but not the status tab —
    // "Arrears" on the Pending tab would otherwise read GHS 0.
    const [list, whole, ...counts] = await Promise.all([
      listLoans(token, {
        ...scope,
        page,
        limit: PAGE_SIZE,
        status: filters.status === "all" ? undefined : filters.status,
      }),
      listLoans(token, { ...scope, page: 1, limit: 1 }),
      ...STATUSES.map((status) =>
        listLoans(token, { ...scope, page: 1, limit: 1, status }),
      ),
    ]);
    return { list, totals: whole.totals, counts };
  });

  const byStatus = Object.fromEntries(
    STATUSES.map((s, i) => [s, result.counts[i].total]),
  ) as Record<LoanStatus, number>;

  const now = new Date();
  const today = accraDay(now);

  return data(
    {
      filters,
      page,
      total: result.list.total,
      totals: result.totals,
      counts: {
        all: STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
        ...byStatus,
      },
      rows: result.list.items.map((loan) => toRow(loan, now, today)),
    },
    { headers },
  );
}

/** Opening the "new application" drawer does not re-read the listing. */
export const shouldRevalidate = drawerParentShouldRevalidate;

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
  /** Copied in from the paper records that predate the system. */
  paper: boolean;
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
    totalRepaid: loan.totalRepaid,
    remaining: loan.remaining,
    progress: repaymentProgress(loan),
    status: loan.status,
    applied: relativeDayLabel(loan.appliedAt, now),
    due: dueDay,
    overdue: daysOverdue(dueDay, today),
    open: isOpen(loan),
    pending: isPending(loan),
    paper: loan.origin === "paper",
  };
}

/* ----------------------------------------------------------------- palette --- */
/* Read from the theme so the night palette restyles the progress bars. */
const CORAL = "var(--chart-1)";
const NAVY = "var(--chart-2)";

/** The tinted status pill — the app's tones on their subtle steps. */
const PILL: Record<LoanStatus, string> = {
  pending: "bg-info-subtle text-info",
  active: "bg-success-subtle text-success",
  arrears: "bg-danger-subtle text-danger",
  repaid: "bg-muted text-muted-foreground",
  rejected: "bg-muted text-muted-foreground",
};

/* -------------------------------------------------------------------- page --- */

export default function Loans({ loaderData }: Route.ComponentProps) {
  const { filters, page, total, totals, counts, rows } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const { search } = useLocation();
  // The counter takes applications and takes repayments. Downloading the book
  // and setting the rates it lends at are the office's.
  const office = isOffice(useCurrentUser());

  const busy =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/loans";

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), {
      replace: true,
      preventScrollReset: true,
    });

  const narrowed = Boolean(filters.search || filters.from || filters.to);

  // The status views in the rail, each with its count under the same scope.
  const sections = [
    {
      label: "Status",
      items: TABS.map((t) => ({
        key: t.key,
        label: t.label,
        count: counts[t.key],
        to: hrefFor({ ...filters, status: t.key as Tab }),
      })),
    },
  ];

  const searchBox = (
    <SearchBox
      value={filters.search}
      apply={(next) => apply({ search: next })}
      hidden={{
        status: filters.status === "all" ? "" : filters.status,
        from: filters.from,
        to: filters.to,
      }}
      placeholder="Name or phone"
      label="Search loans"
      busy={busy}
      className="sm:w-full"
    />
  );

  const dayRange = (align: "start" | "end") => (
    <DayRangeFilter
      from={filters.from}
      to={filters.to}
      title="Applied"
      align={align}
      apply={(next) => apply(next)}
    />
  );

  return (
    <RailFrame
      rail={({ horizontal }) =>
        horizontal ? (
          // Under `lg`: the search and the dates on one line, the statuses as a
          // strip under them.
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">{searchBox}</div>
              {dayRange("end")}
            </div>
            <FilterRail
              label="Filter loans by status"
              sections={sections}
              active={filters.status}
              horizontal
            />
          </div>
        ) : (
          <FilterRail
            label="Filter loans by status"
            sections={sections}
            active={filters.status}
            header={searchBox}
            footer={
              <>
                <h3 className="mb-1.5 flex items-center gap-2 px-2 pt-1 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                  Date applied
                </h3>
                <div className="[&>button]:w-full [&>button]:justify-start">
                  {dayRange("start")}
                </div>
              </>
            }
          />
        )
      }
    >
      <div className="space-y-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-end gap-2">
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
          {/* Loans made on paper before the system existed, copied in as
              history — one at a time in a drawer, or a sheet at once. */}
          {office && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <FileTextIcon />
                  Paper loans
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto whitespace-nowrap">
                <DropdownMenuItem asChild>
                  <Link to={`/loans/paper${search}`} prefetch="intent" preventScrollReset>
                    <PlusIcon />
                    Add paper loan
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/loans/paper-import">
                    <UploadIcon />
                    Import from spreadsheet
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {/* The rates and limits new lending runs on. A drawer, so the
              book stays underneath while they are changed. */}
          {office && (
            <Button asChild variant="outline" size="sm">
              <Link
                to={`/loans/config${search}`}
                prefetch="intent"
                preventScrollReset
              >
                <SettingsIcon />
                Settings
              </Link>
            </Button>
          )}
          <Button asChild size="sm">
            <Link
              to={`/loans/new${search}`}
              prefetch="intent"
              preventScrollReset
            >
              <PlusIcon />
              New application
            </Link>
          </Button>
        </div>

        <TotalsBand totals={totals} />

        <section className="overflow-hidden rounded-2xl bg-card pt-2 text-card-foreground">
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
                  <tr className="border-b border-border text-left text-xs font-bold text-foreground [&>th]:py-3">
                    <th className="pr-3">Loan ID</th>
                    <th className="w-[16%] pr-3">Customer</th>
                    <th className="pr-3">Tier</th>
                    <th className="pr-3 text-right">Term</th>
                    <th className="pr-3 text-right">Principal</th>
                    <th className="pr-3 text-right">Rate</th>
                    <th className="pr-3 text-right">Total due</th>
                    <th className="pr-3 text-right">Repaid</th>
                    <th className="w-[12%] pr-3 text-right">Remaining</th>
                    <th className="pr-3">Applied</th>
                    <th className="pr-3">Due</th>
                    <th className="pr-3">Status</th>
                    <th className="pl-3 text-right">Actions</th>
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
    </RailFrame>
  );
}

/* ------------------------------------------------------------------ totals --- */

/**
 * The book in money, as the four KPI cards the other ledgers open with. The
 * figures cover the search and the dates across every page, not the rows on
 * screen, and only loans that were disbursed — a pending application has lent
 * nothing yet.
 */
function TotalsBand({ totals }: { totals: LoanTotals }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat
        label="Total loaned"
        value={formatPesewas(totals.disbursed)}
        note={`Principal across ${formatCount(totals.disbursedCount)} disbursed`}
        icon={BanknoteIcon}
        tone="neutral"
      />
      <Stat
        label="Amount paid"
        value={formatPesewas(totals.repaid)}
        note="Repayments collected"
        icon={HandCoinsIcon}
        tone="in"
      />
      <Stat
        label="Outstanding"
        value={formatPesewas(totals.outstanding)}
        note={`Still owed on ${formatCount(totals.outstandingCount)} open`}
        icon={WalletIcon}
        tone="revenue"
      />
      <Stat
        label="In arrears"
        value={formatPesewas(totals.arrears)}
        note={`Owed on ${formatCount(totals.arrearsCount)} late ${totals.arrearsCount === 1 ? "loan" : "loans"}`}
        icon={AlertTriangleIcon}
        tone="danger"
      />
    </div>
  );
}

/** The dashboard's KPI tile, as the sales and ledger pages draw it. */
function Stat({
  label,
  value,
  note,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof BanknoteIcon;
  tone: "in" | "danger" | "revenue" | "neutral";
}) {
  return (
    <div className="relative rounded-2xl bg-card p-4">
      <span
        aria-hidden
        className={cn(
          "absolute top-3.5 right-3.5 rounded-lg p-2",
          tone === "in" && "bg-cash-in-subtle",
          tone === "danger" && "bg-danger-subtle",
          tone === "revenue" && "bg-revenue-subtle",
          tone === "neutral" && "bg-internal-subtle",
        )}
      >
        <Icon
          className={cn(
            "size-4",
            tone === "in" && "text-cash-in",
            tone === "danger" && "text-danger",
            tone === "revenue" && "text-revenue-foreground",
            tone === "neutral" && "text-internal",
          )}
        />
      </span>
      {/* Keyed so a change of filter re-enters the number instead of snapping. */}
      <p
        key={value}
        className={cn(
          "tabular animate-in fade-in slide-in-from-bottom-1 pr-10 text-[22px] font-bold tracking-tight duration-300 motion-reduce:animate-none",
          tone === "in" && "text-cash-in",
          tone === "danger" && "text-danger",
          tone === "revenue" && "text-revenue-foreground",
          tone === "neutral" && "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs font-medium">{label}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}

/* ----------------------------------------------------------------------- rows --- */

function LoanRow({ row }: { row: Row }) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="tabular py-3 pr-3 whitespace-nowrap text-muted-foreground">
        <Link
          to={`/loans/${row.id}`}
          className="hover:text-foreground"
          title={row.id}
        >
          {row.ref}
        </Link>
        {row.paper && (
          <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            Paper
          </span>
        )}
      </td>

      <td className="py-3 pr-3">
        <Link
          to={`/loans/${row.id}`}
          className="block truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {row.customerName}
        </Link>
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

      <td className="tabular py-3 pr-3 text-right whitespace-nowrap">
        {formatPesewas(row.totalDue)}
      </td>

      <td className="tabular py-3 pr-3 text-right whitespace-nowrap text-muted-foreground">
        {formatPesewas(row.totalRepaid)}
      </td>

      <td className="py-3 pr-3 text-right whitespace-nowrap">
        <span className="tabular font-semibold">
          {formatPesewas(row.remaining)}
        </span>
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

      <td className="py-3 pr-3 whitespace-nowrap text-muted-foreground">
        {row.applied}
      </td>

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
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium",
            PILL[row.status],
          )}
          title={LOAN_STATUS_BLURBS[row.status]}
        >
          {LOAN_STATUS_LABELS[row.status]}
        </span>
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

function LoansEmpty({
  filters,
  narrowed,
}: {
  filters: Filters;
  narrowed: boolean;
}) {
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
