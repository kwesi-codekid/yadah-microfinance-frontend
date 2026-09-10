import {
  BanIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  DownloadIcon,
  EyeIcon,
  FileTextIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PrinterIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  UserPlusIcon,
  UserRoundCogIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  data,
  Form,
  Link,
  Outlet,
  useFetcher,
  useLocation,
  useNavigation,
  useSubmit,
} from "react-router";
import { toast } from "sonner";

import {
  activateCustomer,
  deactivateCustomer,
  listCustomers,
  trashCustomer,
} from "~/api/customers";
import { ApiError } from "~/api/error";
import { listUsers } from "~/api/users";
import { FilterRail, RailFrame } from "~/components/filter-rail";
import { Page } from "~/components/page";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";
import { initialsOf, isOffice } from "~/lib/auth";
import { ID_TYPE_LABELS, type Customer, type CustomerStatus } from "~/lib/customers";
import {
  ageInYears,
  formatCount,
  formatDayRange,
  relativeDayLabel,
} from "~/lib/format";
import { requireOffice, requireUser, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/customers";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Customers · Yadah Dynamic Enterprise" }];
}

const PAGE_SIZE = 20;
const TABS = [
  { key: "all", label: "All customers" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/** Every filter the listing understands, as one object. */
interface Filters {
  status: Tab;
  search: string;
  /** Inclusive Accra days on the registration date, `YYYY-MM-DD`. */
  from: string;
  to: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function readFilters(url: URL): Filters {
  const statusParam = url.searchParams.get("status");
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : "";
  };
  return {
    status:
      statusParam === "active" || statusParam === "inactive" ? statusParam : "all",
    search: url.searchParams.get("search")?.trim() ?? "",
    from: day("from"),
    to: day("to"),
  };
}

/** The query string for a set of filters. Page 1 and `all` are the defaults. */
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
  return s ? `/customers?${s}` : "/customers";
}

/** Everyone signed in may read customers; only the office may register them. */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  // Moving a round is admin-only: a manager may edit a customer but must not
  // silently change who collects from them.
  const canReassign = user.role === "admin";
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
    const [list, active, inactive, collectors] = await Promise.all([
      listCustomers(token, {
        ...scope,
        page,
        limit: PAGE_SIZE,
        status: filters.status === "all" ? undefined : filters.status,
      }),
      listCustomers(token, { ...scope, page: 1, limit: 1, status: "active" }),
      listCustomers(token, { ...scope, page: 1, limit: 1, status: "inactive" }),
      // Read once with the page, not once per drawer. The reassign panel opens
      // over these rows and needs a round to move a customer to; asking for it
      // on each opening made the panel wait on the server every single time,
      // for a list that is identical every single time.
      //
      // Admin-only, both because only an admin may reassign and because
      // `GET /users` is closed to everyone else — a manager asking would be a
      // 403 that fails the whole listing.
      //
      // Soft, for the same reason the bell in the layout is: a page of
      // customers must not go down because the staff list is briefly away.
      // Without it the drawer falls back to the route that fetches for itself.
      canReassign
        ? listUsers(token, {
            role: "collector",
            status: "active",
            limit: 100,
          }).catch((error: unknown) => {
            // A 401 belongs to `withAuth`, which renews the token and retries.
            if (error instanceof ApiError && error.status === 401) throw error;
            return null;
          })
        : null,
    ]);
    return {
      list,
      collectors:
        collectors?.items.map(({ id, name }) => ({ id, name })) ?? null,
      counts: {
        all: active.total + inactive.total,
        active: active.total,
        inactive: inactive.total,
      },
    };
  });

  const now = new Date();
  const rows = result.list.items.map((c) => toRow(c, now));

  return data(
    {
      canManage: isOffice(user),
      canReassign,
      // Everything the reassign drawer needs to open without asking for it.
      collectors: result.collectors,
      filters,
      page,
      total: result.list.total,
      counts: result.counts,
      rows,
    },
    { headers },
  );
}

/** Opening the reassign drawer does not re-read the listing underneath it. */
export const shouldRevalidate = drawerParentShouldRevalidate;

interface ActionResult {
  ok: boolean;
  message: string;
  /** `CANNOT_TRASH` counts: what the customer still holds open. */
  holdings?: Record<string, number>;
}

/** Row actions: deactivate, reactivate, and move to the trash (office only). */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("customerId") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!id) {
    return data<ActionResult>({ ok: false, message: "Missing customer." }, { status: 400 });
  }

  try {
    const { data: message, headers } = await withAuth(request, async (token) => {
      if (intent === "deactivate") {
        await deactivateCustomer(token, id);
        return "Customer deactivated.";
      }
      if (intent === "activate") {
        await activateCustomer(token, id);
        return "Customer reactivated.";
      }
      if (intent === "trash") {
        await trashCustomer(token, id, reason || undefined);
        return "Customer moved to the trash.";
      }
      throw new Response("Unknown action.", { status: 400 });
    });
    return data<ActionResult>({ ok: true, message }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return data<ActionResult>(
        {
          ok: false,
          message: error.message,
          holdings: openHoldings(error),
        },
        { status: error.status },
      );
    }
    throw error;
  }
}

/** The `{ susu, savings, loans, hirePurchase }` counts on a `CANNOT_TRASH`. */
function openHoldings(error: ApiError): Record<string, number> | undefined {
  if (error.code !== "CANNOT_TRASH" || !error.details) return undefined;
  if (typeof error.details !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(error.details as Record<string, unknown>)) {
    if (typeof value === "number" && value > 0) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

interface Row {
  id: string;
  shortId: string;
  fullName: string;
  initials: string;
  tint: number;
  age: number | null;
  gender: string | null;
  phone: string;
  contactSub: string | null;
  idLabel: string | null;
  idNumber: string | null;
  status: CustomerStatus;
  registered: string;
  /** Empty when they are on nobody's round. Read by the reassign drawer. */
  assignedCollectorId: string;
}

function toRow(c: Customer, now: Date): Row {
  const idType = c.identification?.idType;
  return {
    id: c.id,
    shortId: shortId(c.id),
    fullName: c.fullName,
    initials: initialsOf(c.fullName),
    tint: tintIndex(c.id),
    age: c.dateOfBirth ? ageInYears(c.dateOfBirth, now) : null,
    gender: c.gender ?? null,
    phone: c.phone,
    contactSub: c.altPhone ?? null,
    idLabel: idType ? ID_TYPE_LABELS[idType] : null,
    idNumber: c.identification?.idNumber ?? null,
    status: c.status,
    registered: relativeDayLabel(c.createdAt, now),
    assignedCollectorId: c.assignedCollectorId ?? "",
  };
}

function tintIndex(id: string): number {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum = (sum + id.charCodeAt(i)) % 6;
  return sum + 1;
}

function shortId(id: string): string {
  return id.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase() || id.toUpperCase();
}

export default function Customers({ loaderData }: Route.ComponentProps) {
  const { canManage, canReassign, filters, page, total, counts, rows } =
    loaderData;
  const navigation = useNavigation();
  // Rides along on every link out of here, so a drawer closes onto the same
  // filters it opened over — and so opening one leaves the query string
  // untouched, which is what `shouldRevalidate` reads to refuse the reload.
  const { search } = useLocation();

  // A navigation back into this listing — the search box and the table both
  // dim while one is in flight, so a slow query never looks like no result.
  const busy =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/customers";

  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  const filtered = Boolean(filters.search || filters.from || filters.to);

  return (
    <RailFrame
      rail={({ horizontal }) => (
        <FilterRail
          label="Filter customers by status"
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
            {canManage && (
              <Button asChild size="sm">
                <Link to="/customers/new">
                  <UserPlusIcon />
                  Register customer
                </Link>
              </Button>
            )}
          </div>
        </div>

        {filtered && <ActiveFilters filters={filters} total={total} />}

        {rows.length === 0 ? (
          <CustomersEmpty filters={filters} />
        ) : (
          <div className={cn("transition-opacity", busy && "opacity-60")}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Customer</Th>
                  <Th className="hidden lg:table-cell">Age / Sex</Th>
                  <Th className="hidden sm:table-cell">Contact</Th>
                  <Th className="hidden xl:table-cell">Identification</Th>
                  <Th>Status</Th>
                  <Th className="hidden md:table-cell">Registered</Th>
                  <Th className="w-16 text-right">Actions</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <CustomerRow
                    key={row.id}
                    row={row}
                    canManage={canManage}
                    canReassign={canReassign}
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

      {/* The reassign drawer renders here — over the rows, not a page away
          from them. */}
      <Outlet />
    </Page>
    </RailFrame>
  );
}

function Th({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <TableHead
      className={cn(
        "h-10 px-4 text-xs font-bold tracking-wider text-foreground uppercase",
        className,
      )}
    >
      {children}
    </TableHead>
  );
}

/* ------------------------------------------------------------------ search --- */

const DEBOUNCE_MS = 300;

/**
 * Searches as you type. The term lives in the URL so the result is linkable and
 * survives a reload, but typing must not push a history entry per keystroke —
 * hence `replace`. The input is controlled from local state rather than from
 * the loader, so the caret never jumps when a response lands mid-word.
 */
function SearchBox({ filters, busy }: { filters: Filters; busy: boolean }) {
  const submit = useSubmit();
  const [value, setValue] = useState(filters.search);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // Adopt a term that changed elsewhere — the back button, or a cleared filter
  // chip — without stepping on what is being typed right now.
  const applied = filters.search;
  useEffect(() => {
    setValue((current) => (current === applied ? current : applied));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const run = (next: string) => {
    // A new term always returns to page 1; `queryFor` leaves `page` out.
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
      className="relative w-full sm:w-72"
      onSubmit={(e) => {
        // Enter should not wait out the debounce.
        e.preventDefault();
        clearTimeout(timer.current);
        run(value);
      }}
    >
      {/* No-JS fallback: without the handler above, these carry the filters. */}
      {filters.status !== "all" && (
        <input type="hidden" name="status" value={filters.status} />
      )}
      {filters.from && <input type="hidden" name="from" value={filters.from} />}
      {filters.to && <input type="hidden" name="to" value={filters.to} />}

      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        // Deliberately `type="text"`: the native `search` clear button empties
        // the box without telling React, which used to leave the results
        // filtered by a term no longer on screen. The X below replaces it.
        type="text"
        name="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search name, phone or ID number"
        aria-label="Search customers"
        autoComplete="off"
        className="pl-9 pr-9"
      />
      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center">
        {pending ? (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        ) : value ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
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

/** Registration-date range. Applies on close, so both ends move together. */
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
        <Button variant="outline" size="sm" className={cn(active && "border-primary/50 text-primary")}>
          <SlidersHorizontalIcon />
          {active ? formatDayRange(filters.from, filters.to) : "Registered"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        {/* Keyed on the applied range so reopening after a Clear shows it. */}
        <div ref={fieldsRef} key={`${filters.from}|${filters.to}`} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Registered from
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
              Registered to
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
              // Each DateField keeps its value in a hidden input; read those
              // on apply rather than mirroring every calendar click into state.
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

/** What is narrowing the list right now, and one click to drop each of them. */
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

/**
 * Downloads the *filtered* listing, not the page. The API ignores pagination on
 * an export and caps it at 10,000 rows, so the count is worth saying out loud.
 */
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
          <a href={`/customers/export?format=csv${query ? `&${query}` : ""}`}>
            <FileTextIcon />
            CSV
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`/customers/export?format=xlsx${query ? `&${query}` : ""}`}>
            <DownloadIcon />
            Excel (.xlsx)
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* -------------------------------------------------------------------- rows --- */

function CustomerRow({
  row,
  canManage,
  canReassign,
  search,
}: {
  row: Row;
  canManage: boolean;
  canReassign: boolean;
  search: string;
}) {
  return (
    <TableRow className="group">
      <TableCell className="px-4 py-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            style={{
              backgroundColor: `var(--tint-${row.tint}-bg)`,
              color: `var(--tint-${row.tint}-fg)`,
            }}
          >
            {row.initials}
          </span>
          <div className="min-w-0">
            <Link
              to={`/customers/${row.id}`}
              className="block truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
            >
              {row.fullName}
            </Link>
            <p className="tabular truncate text-xs text-muted-foreground">#{row.shortId}</p>
          </div>
        </div>
      </TableCell>

      <TableCell className="hidden px-4 py-3 lg:table-cell">
        {row.age != null ? (
          <div>
            <p className="tabular text-sm text-foreground">{row.age}y</p>
            {row.gender && <p className="text-xs text-muted-foreground capitalize">{row.gender}</p>}
          </div>
        ) : (
          <Dash />
        )}
      </TableCell>

      <TableCell className="hidden px-4 py-3 sm:table-cell">
        <a href={`tel:${row.phone}`} className="tabular text-sm font-medium text-primary hover:underline">
          {row.phone}
        </a>
        <p className="truncate text-xs text-muted-foreground">{row.contactSub ?? "—"}</p>
      </TableCell>

      <TableCell className="hidden px-4 py-3 xl:table-cell">
        {row.idLabel ? (
          <div>
            <p className="text-sm text-foreground">{row.idLabel}</p>
            {row.idNumber && (
              <p className="tabular truncate text-xs text-muted-foreground">{row.idNumber}</p>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Not on file</span>
        )}
      </TableCell>

      <TableCell className="px-4 py-3">
        <StatusPill status={row.status} />
      </TableCell>

      <TableCell className="hidden px-4 py-3 text-sm text-muted-foreground md:table-cell">
        {row.registered}
      </TableCell>

      <TableCell className="px-4 py-3">
        <RowActions
          row={row}
          canManage={canManage}
          canReassign={canReassign}
          search={search}
        />
      </TableCell>
    </TableRow>
  );
}

/** View · Statement · Print · Edit · Reassign · Deactivate · Move to trash. */
function RowActions({
  row,
  canManage,
  canReassign,
  search,
}: {
  row: Row;
  canManage: boolean;
  canReassign: boolean;
  search: string;
}) {
  const fetcher = useFetcher<ActionResult>();
  const [confirm, setConfirm] = useState<"deactivate" | "trash" | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      toast.success(fetcher.data.message);
      return;
    }
    const { message, holdings } = fetcher.data;
    toast.error(message, {
      description: holdings
        ? `Still open: ${Object.entries(holdings)
            .map(([k, n]) => `${n} ${HOLDING_LABELS[k] ?? k}`)
            .join(", ")}.`
        : undefined,
    });
  }, [fetcher.state, fetcher.data]);

  const submit = (intent: "deactivate" | "activate" | "trash") =>
    fetcher.submit(
      intent === "trash"
        ? { intent, customerId: row.id, reason }
        : { intent, customerId: row.id },
      { method: "post" },
    );

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
          >
            <MoreHorizontalIcon />
            <span className="sr-only">Actions for {row.fullName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem asChild>
            <Link to={`/customers/${row.id}`}>
              <EyeIcon />
              View
            </Link>
          </DropdownMenuItem>
          {canManage && (
            <>
              <DropdownMenuItem asChild>
                <Link to={`/customers/${row.id}/statement`}>
                  <FileTextIcon />
                  Statement
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href={`/customers/${row.id}/registration-form`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <PrinterIcon />
                  Print
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`/customers/${row.id}/edit`}>
                  <PencilIcon />
                  Edit
                </Link>
              </DropdownMenuItem>
              {/* Drawn for everyone who can reach this menu and disabled for a
                  manager, rather than hidden — the same way every other row menu
                  in this app says "not yours to do". */}
              <DropdownMenuItem asChild disabled={!canReassign}>
                <Link
                  to={`/customers/${row.id}/reassign${search}`}
                  prefetch="intent"
                >
                  <UserRoundCogIcon />
                  Reassign collector
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {row.status === "active" ? (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={(e) => {
                    e.preventDefault();
                    setConfirm("deactivate");
                  }}
                >
                  <BanIcon />
                  Deactivate
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => submit("activate")}>
                  <CircleCheckIcon />
                  Activate
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                onSelect={(e) => {
                  e.preventDefault();
                  setReason("");
                  setConfirm("trash");
                }}
              >
                <Trash2Icon />
                Move to trash
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          {confirm === "trash" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Move {row.fullName} to the trash?</AlertDialogTitle>
                <AlertDialogDescription>
                  They disappear from the listings and from lookups, and can be
                  restored from Trash. Their phone number stays reserved. This is
                  refused while they still hold an open susu account, savings
                  account, loan or hire-purchase agreement.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor={`reason-${row.id}`} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Reason (optional)
                </Label>
                <Textarea
                  id={`reason-${row.id}`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={300}
                  rows={2}
                  placeholder="Duplicate record, registered in error…"
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() => submit("trash")}
                >
                  Move to trash
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Deactivate {row.fullName}?</AlertDialogTitle>
                <AlertDialogDescription>
                  They stay visible and their records are kept, but the profile and
                  its accounts cannot be edited until reactivated.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() => submit("deactivate")}
                >
                  Deactivate
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** How the `CANNOT_TRASH` detail keys read in the toast. */
const HOLDING_LABELS: Record<string, string> = {
  susu: "susu account(s)",
  savings: "savings account(s)",
  loans: "loan(s)",
  hirePurchase: "hire-purchase agreement(s)",
};

function StatusPill({ status }: { status: CustomerStatus }) {
  const active = status === "active";
  return (
    <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap">
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", active ? "bg-success" : "bg-muted-foreground/50")}
      />
      <span className={active ? "text-foreground" : "text-muted-foreground"}>
        {active ? "Active" : "Inactive"}
      </span>
    </span>
  );
}

function CustomersEmpty({ filters }: { filters: Filters }) {
  const narrowed = Boolean(filters.search || filters.from || filters.to);
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UsersIcon className="size-6" />
        </EmptyMedia>
        <EmptyTitle>{narrowed ? "No matches" : "No customers yet"}</EmptyTitle>
        <EmptyDescription>
          {filters.search
            ? `Nothing matched “${filters.search}”. Check the spelling, or search by phone or ID number.`
            : narrowed
              ? "No one was registered in that date range."
              : "Registered customers will appear here."}
        </EmptyDescription>
      </EmptyHeader>
      {narrowed && (
        <Button asChild variant="outline" size="sm">
          <Link to={hrefFor({ ...filters, search: "", from: "", to: "" })}>
            Clear filters
          </Link>
        </Button>
      )}
    </Empty>
  );
}

function PagerButton({
  to,
  disabled,
  label,
  children,
}: {
  to: string;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled aria-label={label}>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={to} aria-label={label} prefetch="intent" preventScrollReset>
        {children}
      </Link>
    </Button>
  );
}

function Dash() {
  return <span className="text-muted-foreground">{"—"}</span>;
}
