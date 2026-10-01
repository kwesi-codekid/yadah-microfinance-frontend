import {
  BanknoteArrowDownIcon,
  BanknoteArrowUpIcon,
  CoinsIcon,
  EyeIcon,
  LayersIcon,
  MoreHorizontalIcon,
  PlusIcon,
  UserIcon,
} from "lucide-react";

import { Link, Outlet, useLocation, useNavigation, useSubmit } from "react-router";
import { data } from "react-router";

import { ApiError } from "~/api/error";
import { listAccounts, renumberThisMonth, runSusuMigration } from "~/api/susu";
import { RenumberButton, type RenumberResult } from "~/components/renumber-button";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
import { SusuMigrateButton, type MigrateResult } from "~/components/susu-migrate";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "~/components/ui/empty";
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
import { Table, TableBody, TableCell, TableHeader, TableRow } from "~/components/ui/table";
import { isCounter, isOffice } from "~/lib/auth";
import { formatPesewas, relativeDayLabel } from "~/lib/format";
import { requireUser, withAuth } from "~/lib/session.server";
import { SUSU_STATUS_LABELS, type SusuAccount, type SusuPlan, type SusuStatus } from "~/lib/susu";
import { SusuStatusPill, Th } from "~/components/susu-bits";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/susu";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Susu · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = {
  title: "Susu",
};

const PAGE_SIZE = 20;

/** The day summary button, off for now. The route at /susu/summary stays. */
const SHOW_DAY_SUMMARY = false;

const TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Open" },
  { key: "closed", label: "Closed" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const STATUSES: SusuStatus[] = ["active", "closed"];

interface Filters {
  status: Tab;
  search: string;
  /** Inclusive Accra days on when the account was opened. */
  from: string;
  to: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function readFilters(url: URL): Filters {
  const statusParam = url.searchParams.get("status") as SusuStatus | null;
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
  return s ? `/susu?${s}` : "/susu";
}

/**
 * Every role reads the susu book — a collector needs to find the account they
 * are about to collect into. Opening and closing accounts belong to the
 * counter; the API enforces that and each action route re-checks it.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);

  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const scope = {
      search: filters.search || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    };
    const [list, ...counts] = await Promise.all([
      listAccounts(token, {
        ...scope,
        page,
        limit: PAGE_SIZE,
        status: filters.status === "all" ? undefined : filters.status,
      }),
      ...STATUSES.map((status) => listAccounts(token, { ...scope, page: 1, limit: 1, status })),
    ]);
    return { list, counts };
  });

  const byStatus = Object.fromEntries(STATUSES.map((s, i) => [s, result.counts[i].total])) as Record<
    SusuStatus,
    number
  >;

  const now = new Date();
  return data(
    {
      canManage: isCounter(user),
      /** The data update is the office's — and the API insists on admin. */
      office: isOffice(user),
      filters,
      page,
      total: result.list.total,
      counts: { all: STATUSES.reduce((sum, s) => sum + byStatus[s], 0), ...byStatus },
      rows: result.list.items.map((a) => toRow(a, now)),
    },
    { headers },
  );
}

/** Opening the "new account" drawer does not re-read the listing. */
export const shouldRevalidate = drawerParentShouldRevalidate;

/**
 * The susu data update, asked for from the toolbar: a dry run to see, then
 * an apply behind a confirmation. Office on this side; admin on the API's.
 */
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  if (!isOffice(user)) throw data({ message: "Office only." }, { status: 403 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "renumber-preview" || intent === "renumber-apply") {
      const { data: report, headers } = await withAuth(request, (token) =>
        renumberThisMonth(token, { apply: intent === "renumber-apply" }),
      );
      return data<RenumberResult>({ ok: true, report }, { headers });
    }
    if (intent !== "migrate-preview" && intent !== "migrate-apply") {
      return data<MigrateResult>({ ok: false, message: "Unknown action." }, { status: 400 });
    }
    const { data: report, headers } = await withAuth(request, (token) =>
      runSusuMigration(token, { apply: intent === "migrate-apply" }),
    );
    return data<MigrateResult>({ ok: true, report }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return data<MigrateResult>({ ok: false, message: error.message }, { status: error.status });
    }
    throw error;
  }
}

/* -------------------------------------------------------------------- rows --- */

interface Row {
  id: string;
  accountNumber: string;
  customerId: string;
  customerName: string;
  balance: number;
  dailyTotal: number;
  plans: SusuPlan[];
  status: SusuStatus;
  opened: string;
}

function toRow(a: SusuAccount, now: Date): Row {
  return {
    id: a.id,
    accountNumber: a.accountNumber,
    customerId: a.customerId,
    customerName: a.customerName ?? "—",
    balance: a.balance,
    dailyTotal: a.dailyTotal,
    plans: a.plans.filter((p) => p.status === "active"),
    status: a.status,
    opened: relativeDayLabel(a.openedAt, now),
  };
}

export default function Susu({ loaderData }: Route.ComponentProps) {
  const { canManage, office, filters, page, total, counts, rows } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const { search } = useLocation();

  const busy = navigation.state === "loading" && navigation.location?.pathname === "/susu";

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), { replace: true, preventScrollReset: true });

  const narrowed = Boolean(filters.search || filters.from || filters.to);

  // The status views in the rail, each with its count under the same scope —
  // the same shape the loans book has, so the two read as one product.
  const sections = [
    {
      label: "Status",
      items: TABS.map((tab) => ({
        key: tab.key,
        label: tab.label,
        count: counts[tab.key],
        to: hrefFor({ ...filters, status: tab.key }),
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
      placeholder="Name, phone or number"
      label="Search susu accounts"
      busy={busy}
      className="sm:w-full"
    />
  );

  const dayRange = (align: "start" | "end") => (
    <DayRangeFilter
      from={filters.from}
      to={filters.to}
      title="Opened"
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
              label="Filter susu accounts by status"
              sections={sections}
              active={filters.status}
              horizontal
            />
          </div>
        ) : (
          <FilterRail
            label="Filter susu accounts by status"
            sections={sections}
            active={filters.status}
            header={searchBox}
            footer={
              <>
                <h3 className="mb-1.5 flex items-center gap-2 px-2 pt-1 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                  Date opened
                </h3>
                <div className="[&>button]:w-full [&>button]:justify-start">{dayRange("start")}</div>
              </>
            }
          />
        )
      }
    >
      <div className="space-y-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {office && <RenumberButton action="/susu" product="susu" />}
          {office && <SusuMigrateButton />}
          <ExportMenu
            path="/susu/export"
            query={(() => {
              const p = queryFor(filters);
              p.delete("page");
              return p.toString();
            })()}
            total={total}
            noun="account"
          />
          {/* The day summary is hidden for now (30 Sep 2026) — flip SHOW_DAY_SUMMARY
              to bring it back; the page itself is still there at /susu/summary. */}
          {SHOW_DAY_SUMMARY && (
            <Button asChild variant="outline" size="sm">
              <Link to="/susu/summary">
                <LayersIcon />
                Day summary
              </Link>
            </Button>
          )}
          {canManage && (
            <Button asChild size="sm">
              <Link to={`/susu/new${search}`} prefetch="intent" preventScrollReset>
                <PlusIcon />
                Open account
              </Link>
            </Button>
          )}
        </div>

        <section className="overflow-hidden rounded-2xl bg-card pt-2 text-card-foreground">
          {narrowed && (
            <FilterBar total={total}>
              {filters.search && (
                <FilterChip onDrop={() => apply({ search: "" })} label={`“${filters.search}”`} />
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
            <SusuEmpty filters={filters} canManage={canManage} />
          ) : (
            <div className={cn("transition-opacity", busy && "opacity-60")}>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <Th>Customer</Th>
                    <Th className="hidden md:table-cell">Plans</Th>
                    <Th className="text-right">Balance</Th>
                    <Th className="hidden text-right sm:table-cell">Daily</Th>
                    <Th>Status</Th>
                    <Th className="hidden lg:table-cell">Opened</Th>
                    <Th className="w-16 text-right">Actions</Th>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <AccountRow key={row.id} row={row} canManage={canManage} />
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
        </section>
      </div>

      {/* Open account renders here — a drawer over the book. */}
      <Outlet />
    </RailFrame>
  );
}

function AccountRow({ row, canManage }: { row: Row; canManage: boolean }) {
  const open = row.status === "active";
  return (
    <TableRow className="group">
      <TableCell className="px-4 py-3">
        <Link
          to={`/susu/${row.id}`}
          className="block truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {row.customerName}
        </Link>
        <p className="tabular truncate text-xs text-muted-foreground">#{row.accountNumber}</p>
      </TableCell>

      <TableCell className="hidden px-4 py-3 md:table-cell">
        {row.plans.length === 0 ? (
          <span className="text-xs text-muted-foreground">{open ? "No plan running" : "—"}</span>
        ) : (
          <span className="tabular whitespace-nowrap">{row.plans.length} active</span>
        )}
      </TableCell>

      <TableCell className="px-4 py-3 text-right">
        <p className="tabular font-medium whitespace-nowrap">{formatPesewas(row.balance)}</p>
      </TableCell>

      <TableCell className="tabular hidden px-4 py-3 text-right whitespace-nowrap sm:table-cell">
        {row.dailyTotal > 0 ? formatPesewas(row.dailyTotal) : "—"}
      </TableCell>

      <TableCell className="px-4 py-3">
        <SusuStatusPill status={row.status} />
      </TableCell>

      <TableCell className="hidden px-4 py-3 text-sm text-muted-foreground lg:table-cell">
        {row.opened}
      </TableCell>

      <TableCell className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <Link to={`/customers/${row.customerId}`}>
              <UserIcon />
              Customer
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground">
                <MoreHorizontalIcon />
                <span className="sr-only">
                  Actions for {row.customerName}, account {row.accountNumber}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem asChild>
                <Link to={`/susu/${row.id}`}>
                  <EyeIcon />
                  View account
                </Link>
              </DropdownMenuItem>
              {open && row.plans.length > 0 && (
                <DropdownMenuItem asChild>
                  <Link to={`/susu/${row.id}/deposit`} prefetch="intent">
                    <BanknoteArrowDownIcon />
                    Record deposit
                  </Link>
                </DropdownMenuItem>
              )}
              {open && canManage && (
                <DropdownMenuItem asChild>
                  <Link to={`/susu/${row.id}/withdraw`} prefetch="intent">
                    <BanknoteArrowUpIcon />
                    Withdraw
                  </Link>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}

/* ------------------------------------------------------------------ search --- */

function SusuEmpty({ filters, canManage }: { filters: Filters; canManage: boolean }) {
  const narrowed = Boolean(filters.search || filters.from || filters.to);
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CoinsIcon className="size-6" />
        </EmptyMedia>
        <EmptyTitle>
          {narrowed
            ? "No matches"
            : filters.status === "all"
              ? "No susu accounts yet"
              : `Nothing ${SUSU_STATUS_LABELS[filters.status as SusuStatus].toLowerCase()}`}
        </EmptyTitle>
        <EmptyDescription>
          {filters.search
            ? `Nothing matched “${filters.search}”. Search by customer name, phone, or the start of an account number.`
            : narrowed
              ? "No account was opened in that date range."
              : "Open one for a customer and their first plan starts."}
        </EmptyDescription>
      </EmptyHeader>
      {narrowed ? (
        <Button asChild variant="outline" size="sm">
          <Link to={hrefFor({ ...filters, search: "", from: "", to: "" })}>Clear filters</Link>
        </Button>
      ) : canManage && filters.status === "all" ? (
        <Button asChild size="sm">
          <Link to="/susu/new">
            <PlusIcon />
            Open account
          </Link>
        </Button>
      ) : null}
    </Empty>
  );
}
