import {
  BanIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  DownloadIcon,
  EyeIcon,
  FileTextIcon,
  KeyRoundIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  UserCogIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

import { ApiError } from "~/api/error";
import { disableUser, enableUser, listUsers, resetUserPassword } from "~/api/users";
import { Page } from "~/components/page";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
import {
  ResetPasswordDialog,
  RoleBadge,
  StatusPill,
} from "~/components/staff-form";
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
import { FilterMenu } from "~/components/listing";
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
import { initialsOf, ROLE_LABELS, ROLES, type Role } from "~/lib/auth";
import {
  checkPassword,
  type ResolvedStatus,
  type Staff,
  type StaffActionResult,
} from "~/lib/staff";
import { formatCount, formatDayRange } from "~/lib/format";
import { requireAdmin, requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/staff";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Staff · Yadah Dynamic Enterprise" }];
}

const PAGE_SIZE = 20;
/** The API's own ceiling on a page. Used to read the disabled set in one go. */
const MAX_LIMIT = 100;

const TABS = [
  { key: "all", label: "All staff" },
  { key: "active", label: "Active" },
  { key: "disabled", label: "Disabled" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/** Every filter the listing understands, as one object. */
interface Filters {
  status: Tab;
  role: Role | "all";
  search: string;
  /** Inclusive Accra days on when the account was added, `YYYY-MM-DD`. */
  from: string;
  to: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function readFilters(url: URL): Filters {
  const statusParam = url.searchParams.get("status");
  const roleParam = url.searchParams.get("role");
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : "";
  };
  return {
    status:
      statusParam === "active" || statusParam === "disabled" ? statusParam : "all",
    role: ROLES.includes(roleParam as Role) ? (roleParam as Role) : "all",
    search: url.searchParams.get("search")?.trim() ?? "",
    from: day("from"),
    to: day("to"),
  };
}

/** The query string for a set of filters. Page 1 and `all` are the defaults. */
function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status !== "all") p.set("status", f.status);
  if (f.role !== "all") p.set("role", f.role);
  if (f.search) p.set("search", f.search);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (page > 1) p.set("page", String(page));
  return p;
}

function hrefFor(f: Filters, page = 1): string {
  const s = queryFor(f, page).toString();
  return s ? `/staff?${s}` : "/staff";
}

/**
 * Office may read the staff list; only an admin may change anything on it. The
 * API enforces both, and this re-checks the read — hiding a button is not
 * access control.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireOffice(request);
  const url = new URL(request.url);

  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    // The tab counts have to survive the search, the role and the date range,
    // otherwise "Active 3" contradicts a filtered list showing one row.
    const scope = {
      role: filters.role === "all" ? undefined : filters.role,
      search: filters.search || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    };
    const [list, active, disabled] = await Promise.all([
      listUsers(token, {
        ...scope,
        page,
        limit: PAGE_SIZE,
        status: filters.status === "all" ? undefined : filters.status,
      }),
      listUsers(token, { ...scope, page: 1, limit: 1, status: "active" }),
      // Read whole, not counted: `PublicUser` carries no status, so the only
      // way to put a pill on a row in the All tab is to know who is disabled.
      listUsers(token, { ...scope, page: 1, limit: MAX_LIMIT, status: "disabled" }),
    ]);
    return { list, active, disabled };
  });

  const { list, active, disabled } = result;
  const disabledIds = new Set(disabled.items.map((u) => u.id));
  // Beyond one page of disabled accounts the set is partial, and a row's pill
  // would be a guess. Say "unknown" rather than mislabel someone as active.
  const statusResolved =
    filters.status !== "all" || disabled.total <= disabled.items.length;

  const rows = list.items.map((u) =>
    toRow(u, {
      status:
        filters.status !== "all"
          ? filters.status
          : !statusResolved
            ? "unknown"
            : disabledIds.has(u.id)
              ? "disabled"
              : "active",
      isSelf: u.id === user.id,
    }),
  );

  return data(
    {
      canManage: user.role === "admin",
      filters,
      page,
      total: list.total,
      counts: {
        all: active.total + disabled.total,
        active: active.total,
        disabled: disabled.total,
      },
      rows,
    },
    { headers },
  );
}

/** Opening a staff drawer — read, add or edit — does not re-read the listing. */
export const shouldRevalidate = drawerParentShouldRevalidate;

/** Shared with the dialog that fires these, in `~/lib/staff`. */
type ActionResult = StaffActionResult;

/**
 * Row actions: disable, re-enable and reset a password. All three are admin
 * only, and all three end every session that account is holding — so each one
 * confirms before it fires.
 */
export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("userId") ?? "");
  const newPassword = String(form.get("newPassword") ?? "");

  if (!id) {
    return data<ActionResult>({ ok: false, message: "Missing staff member." }, { status: 400 });
  }
  // The API refuses this with CANNOT_MODIFY_SELF, but saying it here is kinder
  // than bouncing off the server for something the UI already knows.
  if (id === admin.id && intent !== "reset-password") {
    return data<ActionResult>(
      { ok: false, message: "You cannot disable your own account." },
      { status: 400 },
    );
  }
  if (intent === "reset-password" && checkPassword(newPassword)) {
    return data<ActionResult>(
      { ok: false, message: checkPassword(newPassword)! },
      { status: 400 },
    );
  }

  try {
    const { data: message, headers } = await withAuth(request, async (token) => {
      if (intent === "disable") {
        await disableUser(token, id);
        return "Staff member disabled. Every session they held is closed.";
      }
      if (intent === "enable") {
        await enableUser(token, id);
        return "Staff member re-enabled.";
      }
      if (intent === "reset-password") {
        await resetUserPassword(token, id, newPassword);
        return "Password reset. Hand the new one over — they are signed out everywhere.";
      }
      throw new Response("Unknown action.", { status: 400 });
    });
    return data<ActionResult>({ ok: true, message }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return data<ActionResult>(
        { ok: false, message: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}

/* -------------------------------------------------------------------- rows --- */

interface Row {
  id: string;
  name: string;
  initials: string;
  tint: number;
  username: string;
  phone: string;
  email: string | null;
  role: Role;
  status: ResolvedStatus;
  /** The signed-in admin's own row — the API refuses several actions on it. */
  isSelf: boolean;
}

function toRow(u: Staff, extra: { status: ResolvedStatus; isSelf: boolean }): Row {
  return {
    id: u.id,
    name: u.name,
    initials: initialsOf(u.name),
    tint: tintIndex(u.id),
    username: u.username,
    phone: u.phone,
    email: u.email ?? null,
    role: u.role,
    ...extra,
  };
}

function tintIndex(id: string): number {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum = (sum + id.charCodeAt(i)) % 6;
  return sum + 1;
}

export default function StaffRoute({ loaderData }: Route.ComponentProps) {
  const { canManage, filters, page, total, counts, rows } = loaderData;
  const navigation = useNavigation();

  const busy =
    navigation.state === "loading" && navigation.location?.pathname === "/staff";
  // Every link into a drawer carries the filters, so closing one comes back to
  // the page it was opened from rather than to an unfiltered list.
  const { search } = useLocation();

  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  const filtered = Boolean(
    filters.search || filters.from || filters.to || filters.role !== "all",
  );

  return (
    <Page className="max-w-none">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-3 lg:flex-row lg:items-center lg:justify-between">
          <FilterMenu
            label="Status"
            items={TABS.map((tab) => ({
              key: tab.key,
              label: tab.label,
              count: counts[tab.key],
              to: hrefFor({ ...filters, status: tab.key }),
            }))}
            active={filters.status}
          />
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox filters={filters} busy={busy} />
            <RoleFilter filters={filters} />
            <DateRangeFilter filters={filters} />
            <ExportMenu filters={filters} total={total} />
            {canManage && (
              <Button asChild size="sm">
                <Link to={`/staff/new${search}`} prefetch="intent">
                  <UserPlusIcon />
                  Add staff member
                </Link>
              </Button>
            )}
          </div>
        </div>

        {filtered && <ActiveFilters filters={filters} total={total} />}

        {rows.length === 0 ? (
          <StaffEmpty filters={filters} />
        ) : (
          <div className={cn("transition-opacity", busy && "opacity-60")}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Staff member</Th>
                  <Th className="hidden sm:table-cell">Contact</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th className="w-16 text-right">Actions</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <StaffRow
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

      {/* Add, edit and view render here — a drawer over the list, not a page
          away from it. */}
      <Outlet />
    </Page>
  );
}

function Th({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <TableHead
      className={cn(
        "h-10 px-4 text-xs font-medium tracking-wider text-muted-foreground uppercase",
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
      {/* No-JS fallback: without the handler above, these carry the filters. */}
      {filters.status !== "all" && (
        <input type="hidden" name="status" value={filters.status} />
      )}
      {filters.role !== "all" && <input type="hidden" name="role" value={filters.role} />}
      {filters.from && <input type="hidden" name="from" value={filters.from} />}
      {filters.to && <input type="hidden" name="to" value={filters.to} />}

      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="text"
        name="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search name, username or phone"
        aria-label="Search staff"
        autoComplete="off"
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

/** Role is a filter rather than a tab: the tabs already carry the status. */
function RoleFilter({ filters }: { filters: Filters }) {
  const submit = useSubmit();
  const active = filters.role !== "all";

  const pick = (role: Filters["role"]) =>
    submit(queryFor({ ...filters, role }), {
      replace: true,
      preventScrollReset: true,
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(active && "border-primary/50 text-primary")}
        >
          <UserCogIcon />
          {active ? ROLE_LABELS[filters.role as Role] : "Role"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => pick("all")}>Every role</DropdownMenuItem>
        <DropdownMenuSeparator />
        {ROLES.map((r) => (
          <DropdownMenuItem key={r} onSelect={() => pick(r)}>
            {ROLE_LABELS[r]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** When the account was added. Applies on close, so both ends move together. */
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
          {active ? formatDayRange(filters.from, filters.to) : "Added"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div ref={fieldsRef} key={`${filters.from}|${filters.to}`} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Added from
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
              Added to
            </Label>
            <DateField
              name="to"
              defaultValue={filters.to || undefined}
              placeholder="Any date"
              endMonth={new Date()}
            />
          </div>
        </div>
        {/* The API filters on this date but never returns it, so there is no
            column to check the range against. The chip above is the receipt. */}
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
      {filters.role !== "all" && (
        <Chip
          onDrop={() => drop({ role: "all" })}
          label={
            <>
              <UserCogIcon className="size-3" />
              {ROLE_LABELS[filters.role as Role]}
            </>
          }
        />
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
          <a href={`/staff/export?format=csv${query ? `&${query}` : ""}`}>
            <FileTextIcon />
            CSV
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`/staff/export?format=xlsx${query ? `&${query}` : ""}`}>
            <DownloadIcon />
            Excel (.xlsx)
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* -------------------------------------------------------------------- rows --- */

function StaffRow({
  row,
  canManage,
  search,
}: {
  row: Row;
  canManage: boolean;
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
              to={`/staff/${row.id}${search}`}
              prefetch="intent"
              className="block truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
            >
              {row.name}
              {row.isSelf && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  you
                </span>
              )}
            </Link>
            <p className="truncate text-xs text-muted-foreground">@{row.username}</p>
          </div>
        </div>
      </TableCell>

      <TableCell className="hidden px-4 py-3 sm:table-cell">
        <a
          href={`tel:${row.phone}`}
          className="tabular text-sm font-medium text-primary hover:underline"
        >
          {row.phone}
        </a>
        <p className="truncate text-xs text-muted-foreground">{row.email ?? "—"}</p>
      </TableCell>

      <TableCell className="px-4 py-3">
        <RoleBadge role={row.role} />
      </TableCell>

      <TableCell className="px-4 py-3">
        <StatusPill status={row.status} />
      </TableCell>

      <TableCell className="px-4 py-3">
        <RowActions row={row} canManage={canManage} search={search} />
      </TableCell>
    </TableRow>
  );
}

/** View · Edit · Reset password · Disable / Enable. */
function RowActions({
  row,
  canManage,
  search,
}: {
  row: Row;
  canManage: boolean;
  search: string;
}) {
  const fetcher = useFetcher<ActionResult>();
  const [confirm, setConfirm] = useState<"disable" | "enable" | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      toast.success(fetcher.data.message);
      setResetting(false);
    } else {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data]);

  const submit = (intent: "disable" | "enable") =>
    fetcher.submit({ intent, userId: row.id }, { method: "post" });

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
            <span className="sr-only">Actions for {row.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem asChild>
            <Link to={`/staff/${row.id}${search}`} prefetch="intent">
              <EyeIcon />
              View
            </Link>
          </DropdownMenuItem>
          {canManage && (
            <>
              <DropdownMenuItem asChild>
                <Link to={`/staff/${row.id}/edit${search}`} prefetch="intent">
                  <PencilIcon />
                  Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setResetting(true);
                }}
              >
                <KeyRoundIcon />
                Reset password
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {row.status === "disabled" ? (
                <DropdownMenuItem onSelect={() => submit("enable")}>
                  <CircleCheckIcon />
                  Enable
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={row.isSelf}
                  onSelect={(e) => {
                    e.preventDefault();
                    if (row.isSelf) return;
                    setConfirm("disable");
                  }}
                >
                  <BanIcon />
                  Disable
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable {row.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They are signed out everywhere and cannot sign in until
              re-enabled. Nothing is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => submit("disable")}
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ResetPasswordDialog
        open={resetting}
        onOpenChange={setResetting}
        name={row.name}
        userId={row.id}
        fetcher={fetcher}
      />
    </div>
  );
}

function StaffEmpty({ filters }: { filters: Filters }) {
  const narrowed = Boolean(
    filters.search || filters.from || filters.to || filters.role !== "all",
  );
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UserCogIcon className="size-6" />
        </EmptyMedia>
        <EmptyTitle>{narrowed ? "No matches" : "No staff yet"}</EmptyTitle>
        <EmptyDescription>
          {filters.search
            ? `Nothing matched “${filters.search}”. Check the spelling, or search by username or phone.`
            : narrowed
              ? "No account matches those filters."
              : "Staff accounts will appear here."}
        </EmptyDescription>
      </EmptyHeader>
      {narrowed && (
        <Button asChild variant="outline" size="sm">
          <Link to={hrefFor({ ...filters, search: "", from: "", to: "", role: "all" })}>
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
