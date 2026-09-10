import {
  BanknoteArrowDownIcon,
  BanknoteArrowUpIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CoinsIcon,
  DownloadIcon,
  EyeIcon,
  FileTextIcon,
  HandCoinsIcon,
  LayersIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Form,
  Link,
  Outlet,
  useLocation,
  useNavigation,
  useSubmit,
} from "react-router";
import { data } from "react-router";

import { listAccounts } from "~/api/susu";
import { FilterRail, RailFrame } from "~/components/filter-rail";
import { Page } from "~/components/page";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { DateField } from "~/components/ui/date-field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { isCounter } from "~/lib/auth";
import {
  formatCount,
  formatDayRange,
  formatPesewas,
  relativeDayLabel,
} from "~/lib/format";
import { requireUser, withAuth } from "~/lib/session.server";
import {
  CYCLE_TARGET,
  SUSU_STATUS_LABELS,
  type SusuAccount,
  type SusuStatus,
} from "~/lib/susu";
import {
  CycleBar,
  PagerButton,
  SusuStatusPill,
  Th,
} from "~/components/susu-bits";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/susu";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Susu · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page, and the line under it. */
export const handle = {
  title: "Susu",
  description: "One account is one cycle: 31 deposits at a fixed daily amount.",
};

const PAGE_SIZE = 20;

const TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "pending-payout", label: "Pending payout" },
  { key: "closed", label: "Closed" },
  { key: "terminated", label: "Terminated" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const STATUSES: SusuStatus[] = [
  "active",
  "completed",
  "pending-payout",
  "closed",
  "terminated",
];

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
 * are about to collect into. Opening a cycle, closing one and paying it out
 * belong to the counter, which is the office and the teller; the API enforces
 * that and each action route re-checks it.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);

  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    // The tab counts have to survive the search and the date range, otherwise
    // "Active 3" contradicts a filtered list showing one row.
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
      ...STATUSES.map((status) =>
        listAccounts(token, { ...scope, page: 1, limit: 1, status }),
      ),
    ]);
    return { list, counts };
  });

  const byStatus = Object.fromEntries(
    STATUSES.map((s, i) => [s, result.counts[i].total]),
  ) as Record<SusuStatus, number>;

  const now = new Date();
  return data(
    {
      // Opening a cycle, paying one out and collecting are all counter work.
      canManage: isCounter(user),
      filters,
      page,
      total: result.list.total,
      counts: {
        all: STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
        ...byStatus,
      },
      rows: result.list.items.map((a) => toRow(a, now)),
    },
    { headers },
  );
}

/** Opening the "new account" or collection drawer does not re-read the listing. */
export const shouldRevalidate = drawerParentShouldRevalidate;

/* -------------------------------------------------------------------- rows --- */

interface Row {
  id: string;
  accountNumber: string;
  customerId: string;
  customerName: string;
  dailyAmount: number;
  depositsCount: number;
  cycleTarget: number;
  totalDeposited: number;
  withdrawnAmount: number;
  balance: number;
  payoutRemaining: number;
  status: SusuStatus;
  opened: string;
}

function toRow(a: SusuAccount, now: Date): Row {
  return {
    id: a.id,
    accountNumber: a.accountNumber,
    customerId: a.customerId,
    customerName: a.customerName ?? "—",
    dailyAmount: a.dailyAmount,
    depositsCount: a.depositsCount,
    cycleTarget: a.cycleTarget || CYCLE_TARGET,
    totalDeposited: a.totalDeposited,
    withdrawnAmount: a.withdrawnAmount,
    balance: a.balance,
    payoutRemaining: a.payoutRemaining,
    status: a.status,
    opened: relativeDayLabel(a.openedAt, now),
  };
}

export default function Susu({ loaderData }: Route.ComponentProps) {
  const { canManage, filters, page, total, counts, rows } = loaderData;
  const navigation = useNavigation();
  const { search } = useLocation();

  const busy =
    navigation.state === "loading" && navigation.location?.pathname === "/susu";

  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  const filtered = Boolean(filters.search || filters.from || filters.to);

  return (
    <RailFrame
      rail={({ horizontal }) => (
        <FilterRail
          label="Filter susu accounts by status"
          sections={[
            {
              label: "Status",
              items: TABS.map((tab) => ({
                key: tab.key,
                label: tab.label,
                count: counts[tab.key],
                to: hrefFor({ ...filters, status: tab.key }),
              })),
            },
          ]}
          active={filters.status}
          horizontal={horizontal}
        />
      )}
    >
    <Page className="max-w-none">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-3 lg:flex-row lg:items-center lg:justify-end">
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox filters={filters} busy={busy} />
            <DateRangeFilter filters={filters} />
            <ExportMenu filters={filters} total={total} />
            <Button asChild variant="outline" size="sm">
              <Link to="/susu/summary">
                <LayersIcon />
                Day summary
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to={`/susu/collect${search}`} prefetch="intent">
                <HandCoinsIcon />
                Collect all
              </Link>
            </Button>
            {canManage && (
              <Button asChild size="sm">
                <Link to={`/susu/new${search}`} prefetch="intent">
                  <PlusIcon />
                  Open account
                </Link>
              </Button>
            )}
          </div>
        </div>

        {filtered && <ActiveFilters filters={filters} total={total} />}

        {rows.length === 0 ? (
          <SusuEmpty filters={filters} canManage={canManage} />
        ) : (
          <div className={cn("transition-opacity", busy && "opacity-60")}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Account</Th>
                  <Th className="hidden md:table-cell">Cycle</Th>
                  <Th className="text-right">Daily</Th>
                  <Th className="text-right">Deposited</Th>
                  <Th>Status</Th>
                  <Th className="hidden lg:table-cell">Opened</Th>
                  <Th className="w-16 text-right">Actions</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <AccountRow
                    key={row.id}
                    row={row}
                    canManage={canManage}
                    search={search}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {total > 0 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
            <p>
              Showing <span className="tabular font-medium text-foreground">{first}</span>
              –<span className="tabular font-medium text-foreground">{last}</span> of{" "}
              <span className="tabular font-medium text-foreground">{formatCount(total)}</span>
            </p>
            <div className="flex items-center gap-2">
              <PagerButton
                to={hrefFor(filters, page - 1)}
                disabled={page <= 1}
                label="Previous page"
              >
                <ChevronLeftIcon />
                Prev
              </PagerButton>
              <PagerButton
                to={hrefFor(filters, page + 1)}
                disabled={last >= total}
                label="Next page"
              >
                Next
                <ChevronRightIcon />
              </PagerButton>
            </div>
          </div>
        )}
      </div>

      {/* Open account and collect-all render here — drawers over the book. */}
      <Outlet />
    </Page>
    </RailFrame>
  );
}

function AccountRow({
  row,
  canManage,
  search,
}: {
  row: Row;
  canManage: boolean;
  search: string;
}) {
  const owed = row.status === "pending-payout" && row.payoutRemaining > 0;

  return (
    <TableRow className="group">
      <TableCell className="px-4 py-3">
        <Link
          to={`/susu/${row.id}`}
          className="block truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {row.customerName}
        </Link>
        <p className="tabular truncate text-xs text-muted-foreground">
          #{row.accountNumber}
        </p>
      </TableCell>

      <TableCell className="hidden px-4 py-3 md:table-cell">
        <CycleBar count={row.depositsCount} target={row.cycleTarget} />
      </TableCell>

      <TableCell className="tabular px-4 py-3 text-right whitespace-nowrap">
        {formatPesewas(row.dailyAmount)}
      </TableCell>

      <TableCell className="px-4 py-3 text-right">
        <p className="tabular font-medium whitespace-nowrap">
          {formatPesewas(row.totalDeposited)}
        </p>
        {row.withdrawnAmount > 0 && (
          <p className="tabular text-xs whitespace-nowrap text-muted-foreground">
            {formatPesewas(row.balance)} held
          </p>
        )}
        {owed && (
          <p className="tabular text-xs whitespace-nowrap text-warning">
            {formatPesewas(row.payoutRemaining)} owed
          </p>
        )}
      </TableCell>

      <TableCell className="px-4 py-3">
        <SusuStatusPill status={row.status} />
      </TableCell>

      <TableCell className="hidden px-4 py-3 text-sm text-muted-foreground lg:table-cell">
        {row.opened}
      </TableCell>

      <TableCell className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          {/* Money the branch still owes is the one thing on this screen that
              needs doing today, so it is a button on the row rather than two
              clicks down a menu. */}
          {owed && canManage && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/susu/${row.id}?payout=1`} prefetch="intent">
                <BanknoteArrowUpIcon />
                Pay out
              </Link>
            </Button>
          )}
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
          >
            <Link to={`/customers/${row.customerId}`}>
              <UserIcon />
              Customer
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontalIcon />
                <span className="sr-only">
                  Actions for account {row.accountNumber}
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
              {row.status === "active" && (
                <DropdownMenuItem asChild>
                  <Link to={`/susu/${row.id}/deposit`} prefetch="intent">
                    <BanknoteArrowDownIcon />
                    Record deposit
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {canManage && (
                <DropdownMenuItem asChild>
                  <Link to={`/susu/collect?customerId=${row.customerId}${search ? `&${search.slice(1)}` : ""}`} prefetch="intent">
                    <HandCoinsIcon />
                    Collect all for them
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

const DEBOUNCE_MS = 300;

/**
 * Searches as you type. The term lives in the URL so the result is linkable and
 * survives a reload, but typing must not push a history entry per keystroke —
 * hence `replace`. The API's search is typo-tolerant across the customer's
 * name, their phone, and the start of an account number.
 */
function SearchBox({ filters, busy }: { filters: Filters; busy: boolean }) {
  const submit = useSubmit();
  const [value, setValue] = useState(filters.search);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const applied = filters.search;
  useEffect(() => {
    setValue((current) => (current === applied ? current : applied));
  }, [applied]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const run = (next: string) => {
    submit(queryFor({ ...filters, search: next }), {
      replace: true,
      preventScrollReset: true,
    });
  };

  const onChange = (next: string) => {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(next), DEBOUNCE_MS);
  };

  const clear = () => {
    clearTimeout(timer.current);
    setValue("");
    run("");
    inputRef.current?.focus();
  };

  const pending = busy && value.trim() !== applied;

  return (
    <Form
      method="get"
      role="search"
      className="relative w-full sm:w-64"
      onSubmit={(e) => {
        e.preventDefault();
        clearTimeout(timer.current);
        run(value);
      }}
    >
      {filters.status !== "all" && (
        <input type="hidden" name="status" value={filters.status} />
      )}
      {filters.from && <input type="hidden" name="from" value={filters.from} />}
      {filters.to && <input type="hidden" name="to" value={filters.to} />}

      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="text"
        name="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search name, phone or account no."
        aria-label="Search susu accounts"
        autoComplete="off"
        maxLength={100}
        className="pr-9 pl-9"
      />
      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center">
        {pending ? (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        ) : value ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear the search"
            className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <XIcon className="size-4" />
          </button>
        ) : null}
      </div>
    </Form>
  );
}

/* ----------------------------------------------------------------- filters --- */

function DateRangeFilter({ filters }: { filters: Filters }) {
  const submit = useSubmit();
  const [open, setOpen] = useState(false);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const active = Boolean(filters.from || filters.to);

  const apply = (next: { from: string; to: string }) => {
    setOpen(false);
    submit(queryFor({ ...filters, ...next }), {
      replace: true,
      preventScrollReset: true,
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(active && "border-primary/50 text-primary")}
        >
          <SlidersHorizontalIcon />
          {active ? formatDayRange(filters.from, filters.to) : "Opened"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div ref={fieldsRef} key={`${filters.from}|${filters.to}`} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Opened from
            </Label>
            <DateField
              name="from"
              defaultValue={filters.from || undefined}
              placeholder="Any date"
              endMonth={new Date()}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Opened to
            </Label>
            <DateField
              name="to"
              defaultValue={filters.to || undefined}
              placeholder="Any date"
              endMonth={new Date()}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!active}
            onClick={() => apply({ from: "", to: "" })}
          >
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const read = (name: string) =>
                fieldsRef.current?.querySelector<HTMLInputElement>(
                  `input[name='${name}']`,
                )?.value ?? "";
              apply({ from: read("from"), to: read("to") });
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ActiveFilters({ filters, total }: { filters: Filters; total: number }) {
  const submit = useSubmit();
  const drop = (next: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...next }), {
      replace: true,
      preventScrollReset: true,
    });

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-sm">
      <span className="text-muted-foreground">
        {formatCount(total)} {total === 1 ? "match" : "matches"}
      </span>
      {filters.search && (
        <Chip onDrop={() => drop({ search: "" })} label={`“${filters.search}”`} />
      )}
      {(filters.from || filters.to) && (
        <Chip
          onDrop={() => drop({ from: "", to: "" })}
          label={
            <>
              <CalendarIcon className="size-3" />
              {formatDayRange(filters.from, filters.to)}
            </>
          }
        />
      )}
    </div>
  );
}

function Chip({ label, onDrop }: { label: ReactNode; onDrop: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium">
      {label}
      <button
        type="button"
        onClick={onDrop}
        className="text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Remove this filter"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}

function ExportMenu({ filters, total }: { filters: Filters; total: number }) {
  const query = useMemo(() => {
    const p = queryFor(filters);
    p.delete("page");
    return p.toString();
  }, [filters]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={total === 0}>
          <DownloadIcon />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal text-muted-foreground">
          {formatCount(Math.min(total, 10_000))} row{total === 1 ? "" : "s"}, matching
          the filters above
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={`/susu/export?format=csv${query ? `&${query}` : ""}`}>
            <FileTextIcon />
            CSV
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`/susu/export?format=xlsx${query ? `&${query}` : ""}`}>
            <DownloadIcon />
            Excel (.xlsx)
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SusuEmpty({
  filters,
  canManage,
}: {
  filters: Filters;
  canManage: boolean;
}) {
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
              : "Open one for a customer and their cycle starts."}
        </EmptyDescription>
      </EmptyHeader>
      {narrowed ? (
        <Button asChild variant="outline" size="sm">
          <Link to={hrefFor({ ...filters, search: "", from: "", to: "" })}>
            Clear filters
          </Link>
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

