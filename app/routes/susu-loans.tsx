import { BanknoteArrowDownIcon, EyeIcon, MoreHorizontalIcon, NotebookPenIcon, PlusIcon, UserIcon } from "lucide-react";

import { data, Link, Outlet, useLocation, useNavigation, useSubmit } from "react-router";

import { listAccounts } from "~/api/susu-loans";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "~/components/ui/empty";
import { FilterRail, RailFrame } from "~/components/filter-rail";
import { FilterBar, FilterChip, ListingFooter, SearchBox } from "~/components/listing";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "~/components/ui/table";
import { SusuStatusPill, Th } from "~/components/susu-bits";
import { formatPesewas, relativeDayLabel } from "~/lib/format";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { SusuLoanAccount, SusuLoanStatus } from "~/lib/susu-loans";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/susu-loans";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Susu loan · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = {
  title: "Susu loan",
};

const PAGE_SIZE = 20;

const TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Open" },
  { key: "closed", label: "Closed" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const STATUSES: SusuLoanStatus[] = ["active", "closed"];

interface Filters {
  status: Tab;
  search: string;
}

function readFilters(url: URL): Filters {
  const statusParam = url.searchParams.get("status") as SusuLoanStatus | null;
  return {
    status: statusParam && STATUSES.includes(statusParam) ? statusParam : "all",
    search: url.searchParams.get("search")?.trim() ?? "",
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status !== "all") p.set("status", f.status);
  if (f.search) p.set("search", f.search);
  if (page > 1) p.set("page", String(page));
  return p;
}

function hrefFor(f: Filters, page = 1): string {
  const s = queryFor(f, page).toString();
  return s ? `/susu-loans?${s}` : "/susu-loans";
}

/**
 * The susu loan book. Office work end to end (client decision, 23 Oct 2026):
 * collectors do not take these deposits, and the API refuses them the
 * endpoints altogether.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireCounter(request);
  const url = new URL(request.url);
  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const scope = { search: filters.search || undefined };
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
    SusuLoanStatus,
    number
  >;
  const now = new Date();
  return data(
    {
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

interface Row {
  id: string;
  accountNumber: string;
  customerId: string;
  customerName: string;
  balance: number;
  status: SusuLoanStatus;
  opened: string;
}

function toRow(a: SusuLoanAccount, now: Date): Row {
  return {
    id: a.id,
    accountNumber: a.accountNumber,
    customerId: a.customerId,
    customerName: a.customerName ?? "—",
    balance: a.balance,
    status: a.status,
    opened: relativeDayLabel(a.openedAt, now),
  };
}

export default function SusuLoans({ loaderData }: Route.ComponentProps) {
  const { filters, page, total, counts, rows } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const { search } = useLocation();

  const busy = navigation.state === "loading" && navigation.location?.pathname === "/susu-loans";
  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), { replace: true, preventScrollReset: true });

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
      hidden={{ status: filters.status === "all" ? "" : filters.status }}
      placeholder="Name, phone or number"
      label="Search susu loan accounts"
      busy={busy}
      className="sm:w-full"
    />
  );

  return (
    <RailFrame
      rail={({ horizontal }) =>
        horizontal ? (
          <div className="space-y-3">
            {searchBox}
            <FilterRail
              label="Filter susu loan accounts by status"
              sections={sections}
              active={filters.status}
              horizontal
            />
          </div>
        ) : (
          <FilterRail
            label="Filter susu loan accounts by status"
            sections={sections}
            active={filters.status}
            header={searchBox}
            glass
          />
        )
      }
    >
      <div className="space-y-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button asChild size="sm">
            <Link to={`/susu-loans/new${search}`} prefetch="intent" preventScrollReset>
              <PlusIcon />
              Open account
            </Link>
          </Button>
        </div>

        <section className="overflow-hidden rounded-2xl bg-card pt-2 text-card-foreground">
          {filters.search && (
            <FilterBar total={total}>
              <FilterChip onDrop={() => apply({ search: "" })} label={`“${filters.search}”`} />
            </FilterBar>
          )}

          {rows.length === 0 ? (
            <SusuLoanEmpty filters={filters} />
          ) : (
            <div className={cn("transition-opacity", busy && "opacity-60")}>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <Th>Customer</Th>
                    <Th className="text-right">Balance</Th>
                    <Th>Status</Th>
                    <Th className="hidden lg:table-cell">Opened</Th>
                    <Th className="w-16 text-right">Actions</Th>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <AccountRow key={row.id} row={row} />
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

function AccountRow({ row }: { row: Row }) {
  const open = row.status === "active";
  return (
    <TableRow className="group">
      <TableCell className="px-4 py-3">
        <Link
          to={`/susu-loans/${row.id}`}
          className="block truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {row.customerName}
        </Link>
        <p className="tabular truncate text-xs text-muted-foreground">#{row.accountNumber}</p>
      </TableCell>

      <TableCell className="px-4 py-3 text-right">
        <p className="tabular font-medium whitespace-nowrap">{formatPesewas(row.balance)}</p>
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
                <Link to={`/susu-loans/${row.id}`}>
                  <EyeIcon />
                  View account
                </Link>
              </DropdownMenuItem>
              {open && (
                <DropdownMenuItem asChild>
                  <Link to={`/susu-loans/${row.id}/deposit`} prefetch="intent">
                    <BanknoteArrowDownIcon />
                    Record deposit
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

function SusuLoanEmpty({ filters }: { filters: Filters }) {
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <NotebookPenIcon className="size-6" />
        </EmptyMedia>
        <EmptyTitle>
          {filters.search
            ? "No matches"
            : filters.status === "all"
              ? "No susu loan accounts yet"
              : filters.status === "active"
                ? "Nothing open"
                : "Nothing closed"}
        </EmptyTitle>
        <EmptyDescription>
          {filters.search
            ? `Nothing matched “${filters.search}”. Search by customer name, phone, or the start of an account number.`
            : "Open one for a customer who is paying off a loan. The loan is paid from it on its monthly dates."}
        </EmptyDescription>
      </EmptyHeader>
      {filters.search ? (
        <Button asChild variant="outline" size="sm">
          <Link to={hrefFor({ ...filters, search: "" })}>Clear search</Link>
        </Button>
      ) : filters.status === "all" ? (
        <Button asChild size="sm">
          <Link to="/susu-loans/new">
            <PlusIcon />
            Open account
          </Link>
        </Button>
      ) : null}
    </Empty>
  );
}
