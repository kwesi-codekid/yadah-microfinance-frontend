import {
  BanknoteArrowDownIcon,
  BanknoteArrowUpIcon,
  EyeIcon,
  MoreHorizontalIcon,
  PlusIcon,
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

import { ApiError } from "~/api/error";
import { listAccounts, renumberThisMonth } from "~/api/savings";
import { RenumberButton, type RenumberResult } from "~/components/renumber-button";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
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
import { AccountTypeTag, SavingsStatusPill, Th } from "~/components/savings-bits";
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
import { isCounter, isOffice } from "~/lib/auth";
import { formatPesewas, relativeDayLabel } from "~/lib/format";
import {
  ACCOUNT_TYPE_LABELS,
  type SavingsAccount,
  type SavingsAccountType,
  type SavingsStatus,
} from "~/lib/savings";
import { requireUser, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/savings";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Savings · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = {
  title: "Savings",
};

const PAGE_SIZE = 20;

const TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "closed", label: "Closed" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const STATUSES: SavingsStatus[] = ["active", "closed"];
const TYPES: SavingsAccountType[] = ["standard", "student", "fixed", "loan"];

interface Filters {
  status: Tab;
  type: SavingsAccountType | "";
  search: string;
  /** Inclusive Accra days on when the account was opened. */
  from: string;
  to: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function readFilters(url: URL): Filters {
  const statusParam = url.searchParams.get("status") as SavingsStatus | null;
  const typeParam = url.searchParams.get("type") as SavingsAccountType | null;
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : "";
  };
  return {
    status: statusParam && STATUSES.includes(statusParam) ? statusParam : "all",
    type: typeParam && TYPES.includes(typeParam) ? typeParam : "",
    search: url.searchParams.get("search")?.trim() ?? "",
    from: day("from"),
    to: day("to"),
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status !== "all") p.set("status", f.status);
  if (f.type) p.set("type", f.type);
  if (f.search) p.set("search", f.search);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (page > 1) p.set("page", String(page));
  return p;
}

function hrefFor(f: Filters, page = 1): string {
  const s = queryFor(f, page).toString();
  return s ? `/savings?${s}` : "/savings";
}

/**
 * Every role reads the savings book — a collector needs to find the account
 * they are about to pay into. Opening one, withdrawing from it and closing it
 * belong to the counter, which is the office and the teller; the API enforces
 * that and each action route re-checks it.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);

  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    // The tab counts have to survive the search, the type and the date range,
    // otherwise "Active 3" contradicts a filtered list showing one row.
    const scope = {
      search: filters.search || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    };
    const status = filters.status === "all" ? undefined : filters.status;
    const accountType = filters.type || undefined;
    const [list, statusCounts, typeCounts] = await Promise.all([
      listAccounts(token, { ...scope, accountType, page, limit: PAGE_SIZE, status }),
      Promise.all(
        STATUSES.map((s) =>
          listAccounts(token, { ...scope, accountType, page: 1, limit: 1, status: s }),
        ),
      ),
      // The type section is counted under the status the rail is on, and
      // without a type of its own — the same pairing the customers book uses.
      Promise.all(
        TYPES.map((t) =>
          listAccounts(token, { ...scope, accountType: t, page: 1, limit: 1, status }),
        ),
      ),
    ]);
    return { list, counts: statusCounts, typeCounts };
  });

  const byStatus = Object.fromEntries(
    STATUSES.map((s, i) => [s, result.counts[i].total]),
  ) as Record<SavingsStatus, number>;

  const now = new Date();
  return data(
    {
      // Opening an account and paying a withdrawal are counter work.
      canManage: isCounter(user),
      /** Renumbering this month's accounts is the office's. */
      office: isOffice(user),
      filters,
      page,
      total: result.list.total,
      counts: {
        all: STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
        ...byStatus,
      },
      typeCounts: {
        all: result.typeCounts.reduce((sum, c) => sum + c.total, 0),
        ...(Object.fromEntries(TYPES.map((t, i) => [t, result.typeCounts[i].total])) as Record<
          SavingsAccountType,
          number
        >),
      },
      rows: result.list.items.map((a) => toRow(a, now)),
    },
    { headers },
  );
}

/** Opening the "new account" drawer does not re-read the listing. */
export const shouldRevalidate = drawerParentShouldRevalidate;

/**
 * Renumbering this month's accounts into the continuing sequence, asked for
 * from the toolbar: a preview to see, then an apply behind a confirmation.
 * Office on this side, and the API insists again.
 */
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  if (!isOffice(user)) throw data({ message: "Office only." }, { status: 403 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent !== "renumber-preview" && intent !== "renumber-apply") {
    return data<RenumberResult>({ ok: false, message: "Unknown action." }, { status: 400 });
  }
  try {
    const { data: report, headers } = await withAuth(request, (token) =>
      renumberThisMonth(token, { apply: intent === "renumber-apply" }),
    );
    return data<RenumberResult>({ ok: true, report }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return data<RenumberResult>({ ok: false, message: error.message }, { status: error.status });
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
  accountType: SavingsAccountType;
  balance: number;
  availableToWithdraw: number;
  status: SavingsStatus;
  opened: string;
}

function toRow(a: SavingsAccount, now: Date): Row {
  return {
    id: a.id,
    accountNumber: a.accountNumber,
    customerId: a.customerId,
    customerName: a.customerName ?? "—",
    accountType: a.accountType,
    balance: a.balance,
    availableToWithdraw: a.availableToWithdraw,
    status: a.status,
    opened: relativeDayLabel(a.openedAt, now),
  };
}

export default function Savings({ loaderData }: Route.ComponentProps) {
  const { canManage, office, filters, page, total, counts, typeCounts, rows } =
    loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const { search } = useLocation();

  const busy =
    navigation.state === "loading" && navigation.location?.pathname === "/savings";

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), {
      replace: true,
      preventScrollReset: true,
    });

  const filtered = Boolean(filters.search || filters.from || filters.to);

  // The views in the rail, each counted under the other section's choice — the
  // shape the susu and customers books have, so the three read as one product.
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
    {
      label: "Type",
      items: [
        {
          key: "type-all",
          label: "All types",
          count: typeCounts.all,
          to: hrefFor({ ...filters, type: "" }),
        },
        ...TYPES.map((type) => ({
          key: `type-${type}`,
          label: ACCOUNT_TYPE_LABELS[type],
          count: typeCounts[type],
          to: hrefFor({ ...filters, type }),
        })),
      ],
    },
  ];
  // One lit item in each section.
  const lit = [filters.status, `type-${filters.type || "all"}`];

  const searchBox = (
    <SearchBox
      value={filters.search}
      apply={(next) => apply({ search: next })}
      hidden={{
        status: filters.status === "all" ? "" : filters.status,
        type: filters.type,
        from: filters.from,
        to: filters.to,
      }}
      placeholder="Name, phone or number"
      label="Search savings accounts"
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
          // Under `lg`: the search and the dates on one line, the views as a
          // strip under them.
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">{searchBox}</div>
              {dayRange("end")}
            </div>
            <FilterRail
              label="Filter savings accounts"
              sections={sections}
              active={lit}
              horizontal
            />
          </div>
        ) : (
          <FilterRail
            label="Filter savings accounts"
            sections={sections}
            active={lit}
            header={searchBox}
            footer={
              <>
                <h3 className="mb-1.5 flex items-center gap-2 px-2 pt-1 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                  Date opened
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
      <div className="px-4 py-6 sm:px-6">
        <section className="overflow-hidden rounded-2xl bg-card text-card-foreground">
          {/* The book's own actions sit on the card, over the rows they act on. */}
          <div className="flex flex-wrap items-center justify-end gap-2 border-b border-border px-4 py-3">
            <ExportMenu
              path="/savings/export"
              query={(() => {
                const p = queryFor(filters);
                p.delete("page");
                return p.toString();
              })()}
              total={total}
              noun="account"
            />
            {office && <RenumberButton action="/savings" product="savings" />}
            {canManage && (
              <Button asChild size="sm">
                <Link to={`/savings/new${search}`} prefetch="intent" preventScrollReset>
                  <PlusIcon />
                  Open account
                </Link>
              </Button>
            )}
          </div>

          {filtered && (
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
            <SavingsEmpty filters={filters} canManage={canManage} />
          ) : (
            <div className={cn("transition-opacity", busy && "opacity-60")}>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <Th>Account</Th>
                    <Th className="hidden md:table-cell">Type</Th>
                    <Th className="text-right">Balance</Th>
                    <Th className="hidden text-right sm:table-cell">Available</Th>
                    <Th>Status</Th>
                    <Th className="hidden lg:table-cell">Opened</Th>
                    <Th className="w-12 text-right">Actions</Th>
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
  const nothingAvailable = row.availableToWithdraw <= 0;

  return (
    <TableRow className="group">
      <TableCell className="px-4 py-3">
        <Link
          to={`/savings/${row.id}`}
          className="block truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {row.customerName}
        </Link>
        <p className="tabular truncate text-xs text-muted-foreground">
          #{row.accountNumber}
        </p>
      </TableCell>

      <TableCell className="hidden px-4 py-3 md:table-cell">
        <AccountTypeTag type={row.accountType} />
      </TableCell>

      <TableCell className="tabular px-4 py-3 text-right font-medium whitespace-nowrap">
        {formatPesewas(row.balance)}
      </TableCell>

      {/* What is actually the customer's to take today. It is the figure that
          decides whether a withdrawal at the counter can happen at all, so it
          stands beside the balance rather than waiting on the account page. */}
      <TableCell
        className={cn(
          "tabular hidden px-4 py-3 text-right whitespace-nowrap sm:table-cell",
          nothingAvailable ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {open ? formatPesewas(row.availableToWithdraw) : "—"}
      </TableCell>

      <TableCell className="px-4 py-3">
        <SavingsStatusPill status={row.status} />
      </TableCell>

      <TableCell className="hidden px-4 py-3 text-sm text-muted-foreground lg:table-cell">
        {row.opened}
      </TableCell>

      {/* Every row carries the same menu, closed accounts included. The state
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
              <span className="sr-only">
                Actions for account {row.accountNumber}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild>
              <Link to={`/savings/${row.id}`}>
                <EyeIcon />
                View account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild disabled={!open}>
              <Link to={`/savings/${row.id}/deposit`} prefetch="intent">
                <BanknoteArrowDownIcon />
                Record deposit
              </Link>
            </DropdownMenuItem>
            {canManage && (
              <DropdownMenuItem asChild disabled={!open || nothingAvailable}>
                <Link to={`/savings/${row.id}/withdraw`} prefetch="intent">
                  <BanknoteArrowUpIcon />
                  Withdraw
                </Link>
              </DropdownMenuItem>
            )}
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

function SavingsEmpty({
  filters,
  canManage,
}: {
  filters: Filters;
  canManage: boolean;
}) {
  const narrowed = Boolean(
    filters.search || filters.type || filters.from || filters.to,
  );
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WalletIcon className="size-6" />
        </EmptyMedia>
        <EmptyTitle>
          {narrowed
            ? "No matches"
            : filters.status === "all"
              ? "No savings accounts yet"
              : filters.status === "active"
                ? "Nothing active"
                : "Nothing closed"}
        </EmptyTitle>
        <EmptyDescription>
          {filters.search
            ? `Nothing matched “${filters.search}”. Search by customer name, phone, or the start of an account number.`
            : narrowed
              ? "No account matches those filters."
              : "Open one for a customer and they can start paying in."}
        </EmptyDescription>
      </EmptyHeader>
      {narrowed ? (
        <Button asChild variant="outline" size="sm">
          <Link to={hrefFor({ ...filters, search: "", type: "", from: "", to: "" })}>
            Clear filters
          </Link>
        </Button>
      ) : canManage && filters.status === "all" ? (
        <Button asChild size="sm">
          <Link to="/savings/new">
            <PlusIcon />
            Open account
          </Link>
        </Button>
      ) : null}
    </Empty>
  );
}
