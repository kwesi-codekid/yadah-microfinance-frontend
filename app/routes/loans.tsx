import {
  BanknoteArrowDownIcon,
  EyeIcon,
  LandmarkIcon,
  MoreHorizontalIcon,
  PlusIcon,
  TrendingUpIcon,
  UserIcon,
} from "lucide-react";
import { data, Link, Outlet, useLocation, useNavigation, useSubmit } from "react-router";

import { listLoans } from "~/api/loans";
import {
  DayRangeChip,
  DayRangeFilter,
  ExportMenu,
  FilterBar,
  FilterChip,
  ListingCard,
  ListingFooter,
  ListingToolbar,
  SearchBox,
  StatusPill,
  StatusTabs,
  Th,
} from "~/components/listing";
import { Page, PageHeader } from "~/components/page";
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
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { accraDay, formatCount, formatPesewas, relativeDayLabel } from "~/lib/format";
import {
  LOAN_STATUS_BLURBS,
  LOAN_STATUS_LABELS,
  LOAN_STATUS_TONE,
  TIER_LABELS,
  daysOverdue,
  isOpen,
  isPending,
  repaymentProgress,
  type Loan,
  type LoanStatus,
} from "~/lib/loans";
import { requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/loans";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Loans · Yadah Dynamic Enterprise" }];
}

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

/**
 * `GET /loans` — the loan book. Office only, and the API says so too.
 *
 * There is no automatic decision anywhere in this module: every pending row is
 * waiting on a person. That is why `Pending` is the second tab and carries a
 * count — it is a queue, not a status.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    // The tab counts have to survive the search and the date range, otherwise
    // "Pending 3" contradicts a filtered list showing one row.
    const scope = {
      search: filters.search || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    };
    const [list, ...counts] = await Promise.all([
      listLoans(token, {
        ...scope,
        page,
        limit: PAGE_SIZE,
        status: filters.status === "all" ? undefined : filters.status,
      }),
      ...STATUSES.map((status) =>
        listLoans(token, { ...scope, page: 1, limit: 1, status }),
      ),
    ]);
    return { list, counts };
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
  customerId: string;
  customerName: string;
  tier: string;
  principal: number;
  ratePercent: number;
  durationMonths: number;
  /** True once the rate has climbed the escalation ladder at least once. */
  escalated: boolean;
  frozen: boolean;
  remaining: number;
  progress: number;
  status: LoanStatus;
  applied: string;
  /** Whole days past the due date, or null while the loan is not late. */
  overdue: number | null;
  open: boolean;
  pending: boolean;
}

function toRow(loan: Loan, now: Date, today: string): Row {
  return {
    id: loan.id,
    customerId: loan.customerId,
    customerName: loan.customerName ?? "—",
    tier: TIER_LABELS[loan.tier],
    principal: loan.principal,
    ratePercent: loan.ratePercent,
    durationMonths: loan.durationMonths,
    escalated: Boolean(loan.escalatedAt),
    frozen: loan.frozen,
    remaining: loan.remaining,
    progress: repaymentProgress(loan),
    status: loan.status,
    applied: relativeDayLabel(loan.appliedAt, now),
    overdue: daysOverdue(loan.dueDate ? accraDay(new Date(loan.dueDate)) : null, today),
    open: isOpen(loan),
    pending: isPending(loan),
  };
}

export default function Loans({ loaderData }: Route.ComponentProps) {
  const { filters, page, total, counts, rows } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const { search } = useLocation();

  const busy =
    navigation.state === "loading" && navigation.location?.pathname === "/loans";

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), {
      replace: true,
      preventScrollReset: true,
    });

  const narrowed = Boolean(filters.search || filters.from || filters.to);

  return (
    <Page className="max-w-none">
      <PageHeader
        title="Loans"
        description="Applications wait for a person. Nothing here is decided automatically."
        actions={
          <Button asChild>
            <Link to={`/loans/new${search}`} prefetch="intent" preventScrollReset>
              <PlusIcon />
              New application
            </Link>
          </Button>
        }
      />

      <ListingCard>
        <ListingToolbar
          tabs={
            <StatusTabs
              tabs={TABS.map((t) => ({ ...t, count: counts[t.key] }))}
              active={filters.status}
              hrefFor={(key) => hrefFor({ ...filters, status: key as Tab })}
            />
          }
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
          <div className={cn("transition-opacity", busy && "opacity-60")}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Customer</Th>
                  <Th className="hidden text-right sm:table-cell">Principal</Th>
                  <Th className="hidden text-right md:table-cell">Rate</Th>
                  <Th className="text-right">Remaining</Th>
                  <Th>Status</Th>
                  <Th className="hidden lg:table-cell">Applied</Th>
                  <Th className="w-12 text-right">Actions</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <LoanRow key={row.id} row={row} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <ListingFooter
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          hrefFor={(p) => hrefFor(filters, p)}
        />
      </ListingCard>

      {/* The application drawer renders here, over the book. */}
      <Outlet />
    </Page>
  );
}

function LoanRow({ row }: { row: Row }) {
  return (
    <TableRow className="group">
      <TableCell className="px-4 py-3">
        <Link
          to={`/loans/${row.id}`}
          className="block truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {row.customerName}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {row.tier} · {row.durationMonths} months
        </p>
      </TableCell>

      <TableCell className="tabular hidden px-4 py-3 text-right whitespace-nowrap sm:table-cell">
        {formatPesewas(row.principal)}
      </TableCell>

      {/* The rate is the one figure on a loan that moves. When it has climbed
          the ladder it says so here rather than only on the detail page —
          otherwise a row shows an interest figure nobody can reconcile. */}
      <TableCell className="hidden px-4 py-3 text-right whitespace-nowrap md:table-cell">
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
      </TableCell>

      <TableCell className="px-4 py-3 text-right whitespace-nowrap">
        <span className="tabular font-medium">{formatPesewas(row.remaining)}</span>
        {row.open && (
          <span
            className="mt-1 block h-1 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${Math.round(row.progress * 100)}% repaid`}
          >
            <span
              className={cn(
                "block h-full",
                row.status === "arrears" ? "bg-warning" : "bg-primary",
              )}
              style={{ width: `${row.progress * 100}%` }}
            />
          </span>
        )}
      </TableCell>

      <TableCell className="px-4 py-3">
        <StatusPill
          label={LOAN_STATUS_LABELS[row.status]}
          blurb={LOAN_STATUS_BLURBS[row.status]}
          tone={LOAN_STATUS_TONE[row.status]}
        />
        {row.overdue !== null && row.status !== "repaid" && (
          <p className="tabular mt-0.5 text-xs text-danger">
            {formatCount(row.overdue)} {row.overdue === 1 ? "day" : "days"} past due
          </p>
        )}
      </TableCell>

      <TableCell className="hidden px-4 py-3 text-sm text-muted-foreground lg:table-cell">
        {row.applied}
      </TableCell>

      {/* Every row carries the same menu, closed loans included. The state
          decides which items are usable, not whether the trigger exists — an
          actions column that is blank on some rows reads as broken. */}
      <TableCell className="px-4 py-3 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontalIcon />
              <span className="sr-only">Actions for {row.customerName}&rsquo;s loan</span>
            </Button>
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
      </TableCell>
    </TableRow>
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
