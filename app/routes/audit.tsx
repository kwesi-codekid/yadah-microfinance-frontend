import {
  ArrowRightIcon,
  ExternalLinkIcon,
  FileClockIcon,
  FilterIcon,
  ListTreeIcon,
  UserIcon,
} from "lucide-react";
import { useState } from "react";
import { data, Link, useNavigation, useSubmit } from "react-router";

import { listAuditLogs } from "~/api/audit";
import { listUsers } from "~/api/users";
import {
  DayRangeFilter,
  ExportMenu,
  FilterChip,
  FilterMenu,
  type MenuChoice,
} from "~/components/listing";
import { Page } from "~/components/page";
import { DataTable, type Column } from "~/components/ui/data-table";
import { DropdownMenuItem, DropdownMenuSeparator } from "~/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import {
  AREA_VAR,
  AUDIT_AREAS,
  AUDIT_AREA_KEYS,
  areaOf,
  describeAction,
  describeDevice,
  describeEndpoint,
  describeEntityType,
  entityPath,
  snapshotLines,
  type AuditArea,
  type AuditLog,
  type SnapshotLine,
} from "~/lib/audit";
import { ROLE_LABELS, type Role } from "~/lib/auth";
import {
  accraDay,
  formatAccraDate,
  formatAccraDateTime,
  formatAmount,
  formatPesewas,
} from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/audit";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Audit log · Yadah Dynamic Enterprise" }];
}

/** Twenty rows: an entry is one line, and the trail is read down, not across. */
const PAGE_SIZE = 20;

/** The API's ceiling on a page — how much of the staff list can be read at once. */
const STAFF_LIMIT = 100;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[0-9a-f]{24}$/;

interface Filters {
  area: AuditArea | "";
  actorId: string;
  /** Arrive together, from a record's own page: "everything done to this". */
  entityType: string;
  entityId: string;
  from: string;
  to: string;
}

function readFilters(url: URL): Filters {
  const area = url.searchParams.get("area") as AuditArea | null;
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : "";
  };
  const id = (key: string) => {
    const v = url.searchParams.get(key)?.trim() ?? "";
    return ID_RE.test(v) ? v : "";
  };
  const entityType = url.searchParams.get("entityType")?.trim() ?? "";
  const entityId = id("entityId");
  return {
    area: area && AUDIT_AREA_KEYS.includes(area) ? area : "",
    actorId: id("actorId"),
    // One without the other narrows to nothing sensible, so both or neither.
    entityType: entityId && /^[a-z][a-z-]*$/.test(entityType) ? entityType : "",
    entityId: entityId && /^[a-z][a-z-]*$/.test(entityType) ? entityId : "",
    from: day("from"),
    to: day("to"),
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.area) p.set("area", f.area);
  if (f.actorId) p.set("actorId", f.actorId);
  if (f.entityType && f.entityId) {
    p.set("entityType", f.entityType);
    p.set("entityId", f.entityId);
  }
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (page > 1) p.set("page", String(page));
  return p;
}

/**
 * `GET /audit-logs` — the trail. Office only, like the endpoint: it names who
 * did what across every module, including staff accounts and the company's
 * own books, none of which the counter reads.
 *
 * The staff list is read alongside for two reasons: the Who menu, and the
 * name on the chip when a person arrives in the URL. A trail that could only
 * say `actorId=8f3c…` would tell nobody whose work they were looking at.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const area = AUDIT_AREAS.find((a) => a.key === filters.area);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const [feed, staff] = await Promise.all([
      listAuditLogs(token, {
        page,
        limit: PAGE_SIZE,
        action: area?.prefixes.join(","),
        actorId: filters.actorId || undefined,
        entityType: filters.entityType || undefined,
        entityId: filters.entityId || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
      }),
      // Best-effort: the trail must not go down because the staff list did.
      listUsers(token, { limit: STAFF_LIMIT }).catch(() => null),
    ]);
    return { feed, staff };
  });

  const { feed, staff } = result;
  const people = (staff?.items ?? [])
    .map((u) => ({ id: u.id, name: u.name, role: u.role }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const rows = feed.items.map(toRow);
  // The chip for a record names it off the rows themselves — the API joins
  // the label onto every entry, so the first one is as good as a lookup.
  const entityLabel = rows[0]?.entityLabel ?? null;

  return data(
    {
      filters,
      page,
      total: feed.total,
      rows,
      people,
      actorName:
        filters.actorId
          ? (people.find((p) => p.id === filters.actorId)?.name ??
            rows.find((r) => r.actorId === filters.actorId)?.actor ??
            null)
          : null,
      entityLabel,
      today: accraDay(),
    },
    { headers },
  );
}

/* -------------------------------------------------------------------- rows --- */

interface Row {
  id: string;
  date: string;
  time: string;
  stamp: string;
  actorId: string;
  actor: string;
  actorRole: Role | null;
  /** True when the account that made the change no longer exists. */
  actorGone: boolean;
  action: string;
  what: string;
  area: AuditArea | null;
  entityType: string;
  entityTypeLabel: string;
  entityId: string;
  entityLabel: string | null;
  entityPath: string | null;
  amountBefore: number | null;
  amountAfter: number | null;
  lines: SnapshotLine[];
  /** How many fields the snapshots show moving. */
  changed: number;
  requestId: string | null;
  /** The device as the office would name it, or null for a worker's entry. */
  device: string | null;
  /** The raw user agent, for the drawer's tooltip. */
  userAgent: string | null;
  /** `POST /susu/accounts/…/deposits`, or null for a worker's entry. */
  endpoint: string | null;
}

function toRow(log: AuditLog): Row {
  const lines = snapshotLines(log.before, log.after);
  return {
    id: log.id,
    date: formatAccraDate(log.createdAt),
    // The full stamp reads `25 Aug 2026, 1:32 pm`; the date has its own line.
    time: formatAccraDateTime(log.createdAt).split(", ")[1] ?? "",
    stamp: formatAccraDateTime(log.createdAt),
    actorId: log.actorId,
    actor: log.actorName ?? "A removed account",
    actorRole: log.actorRole ?? null,
    actorGone: !log.actorName,
    action: log.action,
    what: describeAction(log.action),
    area: areaOf(log.action),
    entityType: log.entityType,
    entityTypeLabel: describeEntityType(log.entityType),
    entityId: log.entityId,
    entityLabel: log.entityLabel ?? null,
    entityPath: entityPath(log.entityType, log.entityId),
    amountBefore: log.amountBefore ?? null,
    amountAfter: log.amountAfter ?? null,
    lines,
    changed: lines.filter((l) => l.changed).length,
    requestId: log.requestId ?? null,
    device: describeDevice(log.userAgent),
    userAgent: log.userAgent ?? null,
    endpoint: describeEndpoint(log.method, log.path),
  };
}

/** Everything that would identify a row when someone types into the search box. */
function haystack(row: Row): string {
  return [
    row.what,
    row.action,
    row.actor,
    row.entityTypeLabel,
    row.entityLabel,
    row.device,
    row.endpoint,
    ...row.lines.flatMap((l) => [l.before, l.after]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/* -------------------------------------------------------------------- page --- */

/**
 * The trail, drawn as the ledger is drawn — the same table, the same ⋯ menu
 * on every row — because it answers the ledger's question one level down:
 * not what moved, but who moved it, and what it looked like before.
 *
 * Every row is a sentence with the person as its subject: *Efua Mensah*
 * recorded a susu deposit on *#SU00000012*. The figures sit to the right the
 * way a change reads on the corrections queue, old struck through, new in
 * weight. What the sentence leaves out — the fields, one by one — is a click
 * away in the drawer, which is why the page opens with no band of totals
 * above it: a trail has no headline number, and a tile of "entries today"
 * would be furniture.
 *
 * Paging is the API's: the trail is unbounded, so a page is a request. The
 * search box picks through the page in hand, and the note under the table
 * says so rather than letting a miss be read as an absence.
 */
export default function AuditTrail({ loaderData }: Route.ComponentProps) {
  const { filters, page, total, rows, people, actorName, entityLabel } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();

  const [search, setSearch] = useState("");
  // The entry being read in full, if any. One drawer over the table, opened
  // by whichever row asked; nothing is fetched, the row already holds it all.
  const [reading, setReading] = useState<Row | null>(null);

  const busy =
    navigation.state === "loading" && navigation.location?.pathname === "/audit";

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), {
      replace: true,
      preventScrollReset: true,
    });

  const goToPage = (next: number) =>
    submit(queryFor(filters, next), { replace: true, preventScrollReset: true });

  // Only the open view's total is ever known — the API counts what it was
  // asked for. A closed view carries no count rather than a misleading zero.
  const areaItems: MenuChoice[] = [
    {
      key: "",
      label: "Everything",
      count: filters.area ? 0 : total,
      onSelect: () => apply({ area: "" }),
    },
    ...AUDIT_AREAS.map((a) => ({
      key: a.key,
      label: (
        <span className="inline-flex items-center gap-1.5">
          <AreaDot area={a.key} />
          {a.label}
        </span>
      ),
      count: filters.area === a.key ? total : 0,
      onSelect: () => apply({ area: a.key }),
    })),
  ];

  const whoItems: MenuChoice[] = [
    { key: "", label: "Anyone", onSelect: () => apply({ actorId: "" }) },
    ...people.map((p) => ({
      key: p.id,
      label: p.name,
      onSelect: () => apply({ actorId: p.id }),
    })),
  ];

  const query = search.trim().toLowerCase();
  const visible = query ? rows.filter((row) => haystack(row).includes(query)) : rows;

  const narrowed = Boolean(
    filters.area || filters.actorId || filters.entityId || filters.from || filters.to,
  );

  const columns: Column<Row>[] = [
    {
      key: "when",
      header: "When",
      className: "whitespace-nowrap text-muted-foreground",
      cell: (row) => (
        <>
          <p>{row.date}</p>
          <p className="text-xs">{row.time}</p>
        </>
      ),
    },
    {
      key: "who",
      header: "Who",
      // Below `md` the person rides under the sentence instead — see `What`.
      className: "hidden md:table-cell",
      cell: (row) => (
        <>
          <p className={cn("truncate font-medium", row.actorGone && "italic text-muted-foreground")}>
            {row.actor}
          </p>
          {row.actorRole && (
            <p className="text-xs text-muted-foreground">{ROLE_LABELS[row.actorRole]}</p>
          )}
        </>
      ),
    },
    { key: "what", header: "What", cell: (row) => <What row={row} /> },
    {
      key: "from",
      header: "From",
      className: "hidden max-w-56 text-muted-foreground lg:table-cell",
      // The device the change was made on, and the call that made it. A
      // worker's entry has neither, and says so rather than leaving a blank
      // that could be read as "not recorded".
      cell: (row) =>
        row.endpoint ? (
          <>
            <p className="truncate" title={row.userAgent ?? undefined}>
              {row.device ?? "Unknown device"}
            </p>
            <p className="truncate text-xs" title={row.endpoint}>
              {row.endpoint}
            </p>
          </>
        ) : (
          <p className="italic">System job</p>
        ),
    },
    {
      key: "change",
      header: "Change · GH₵",
      align: "end",
      cell: (row) => <Change row={row} onOpen={() => setReading(row)} />,
    },
  ];

  return (
    <Page className="max-w-none">
      {/* The two filters the toolbar has no control of its own for: a person
          or a record picked elsewhere arrives in the URL, so a chip is how the
          page says so and how it is let go. */}
      {(filters.actorId || filters.entityId) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {filters.actorId && (
            <FilterChip
              onDrop={() => apply({ actorId: "" })}
              label={
                <>
                  <UserIcon className="size-3" />
                  {actorName ?? "One person"}
                </>
              }
            />
          )}
          {filters.entityId && (
            <FilterChip
              onDrop={() => apply({ entityType: "", entityId: "" })}
              label={
                <>
                  <ListTreeIcon className="size-3" />
                  {describeEntityType(filters.entityType)}
                  {entityLabel ? ` ${entityLabel}` : ""}
                </>
              }
            />
          )}
        </div>
      )}

      <DataTable
        filters={
          <>
            <FilterMenu label="Area" items={areaItems} active={filters.area} />
            {people.length > 0 && (
              <FilterMenu
                label="Who"
                items={whoItems}
                active={filters.actorId}
                icon={<UserIcon />}
              />
            )}
          </>
        }
        actions={
          <>
            <DayRangeFilter
              from={filters.from}
              to={filters.to}
              apply={(next) => apply(next)}
              title="Recorded"
            />
            <ExportMenu
              path="/audit/export"
              query={queryFor(filters).toString()}
              total={total}
              noun="entry"
            />
          </>
        }
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search this page"
        searchLabel="Search the entries on this page"
        columns={columns}
        rows={visible}
        rowKey={(row) => row.id}
        // A search is a local narrowing of the page in hand, so the footer
        // counts the matches; without one the footer is the API's own paging.
        paging={
          query ? undefined : { page, pageSize: PAGE_SIZE, total, onPageChange: goToPage }
        }
        loading={busy}
        rowActions={(row) => (
          <>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setReading(row);
              }}
            >
              <FileClockIcon />
              Read the entry
            </DropdownMenuItem>
            {/* Disabled rather than absent on a record with no page: it is the
                same menu on every row, and an item that comes and goes reads
                as a bug. */}
            {row.entityPath ? (
              <DropdownMenuItem asChild>
                <Link to={row.entityPath}>
                  <ExternalLinkIcon />
                  Open the {row.entityTypeLabel.toLowerCase()}
                </Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>
                <ExternalLinkIcon />
                No page to open
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={filters.entityId === row.entityId}
              onSelect={() => apply({ entityType: row.entityType, entityId: row.entityId })}
            >
              <FilterIcon />
              Everything done to this {row.entityTypeLabel.toLowerCase()}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={row.actorGone || filters.actorId === row.actorId}
              onSelect={() => apply({ actorId: row.actorId })}
            >
              <UserIcon />
              Everything {row.actorGone ? "by this account" : `by ${row.actor}`}
            </DropdownMenuItem>
          </>
        )}
        noun={{ one: "entry", many: "entries" }}
        pageSize={PAGE_SIZE}
        empty={
          query
            ? "Nothing on this page matches that. Clear the search to see the page again."
            : narrowed
              ? "Nothing was recorded that way. Widen the range, or choose Everything."
              : "Nothing has been recorded yet. Every deposit, approval, edit and payout will leave a line here."
        }
      />

      {reading && <EntrySheet key={reading.id} row={reading} onClose={() => setReading(null)} />}
    </Page>
  );
}

/* ------------------------------------------------------------------- cells --- */

/** The dot that stands for an area, in the module's colour where it has one. */
function AreaDot({ area, className }: { area: AuditArea | null; className?: string }) {
  const colour = area ? AREA_VAR[area] : undefined;
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-full", !colour && "bg-muted-foreground/50", className)}
      style={colour ? { backgroundColor: colour } : undefined}
    />
  );
}

/**
 * What happened, in one cell: the sentence, and under it the record it
 * happened to — linked to its page where it has one, named by its number or
 * its name where the API could find one, and by its type and the tail of its
 * id where it could not.
 */
function What({ row }: { row: Row }) {
  const name = row.entityLabel ?? `${row.entityTypeLabel} …${row.entityId.slice(-6)}`;
  return (
    <div className="flex items-start gap-2.5">
      <AreaDot area={row.area} className="mt-1.5" />
      <div className="min-w-0">
        <p className="font-medium text-foreground">{row.what}</p>
        <p className="truncate text-xs text-muted-foreground">
          {/* The person has a column from `md` up; narrower than that they
              ride here rather than dropping off the screen. */}
          <span className={cn("md:hidden", row.actorGone && "italic")}>{row.actor} · </span>
          {row.entityLabel && <span>{row.entityTypeLabel} </span>}
          {row.entityPath ? (
            <Link
              to={row.entityPath}
              className={cn(
                "underline-offset-4 hover:text-foreground hover:underline",
                row.entityLabel?.startsWith("#") && "tabular",
              )}
            >
              {name}
            </Link>
          ) : (
            <span className={cn(row.entityLabel?.startsWith("#") && "tabular")}>{name}</span>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * The figures, where money moved: the balance or total before, struck
 * through and muted, and what it became, in weight — the same treatment the
 * corrections queue gives a change, so a change reads as a change on both
 * screens. Where no money moved but fields did, the count of them, as the
 * way into the drawer; where nothing was snapshotted at all, a dash.
 */
function Change({ row, onOpen }: { row: Row; onOpen: () => void }) {
  const money = row.amountBefore !== null || row.amountAfter !== null;
  if (money) {
    return (
      <>
        <p className="tabular whitespace-nowrap">
          {row.amountBefore !== null && (
            <span className="text-muted-foreground line-through">
              {formatAmount(row.amountBefore)}
            </span>
          )}{" "}
          {row.amountAfter !== null && (
            <span className="font-medium">{formatAmount(row.amountAfter)}</span>
          )}
        </p>
        {row.changed > 0 && (
          <button
            type="button"
            onClick={onOpen}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {row.changed} {row.changed === 1 ? "field" : "fields"}
          </button>
        )}
      </>
    );
  }
  if (row.lines.length > 0) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {row.changed > 0
          ? `${row.changed} ${row.changed === 1 ? "field" : "fields"}`
          : `${row.lines.length} ${row.lines.length === 1 ? "field" : "fields"} recorded`}
      </button>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

/* ------------------------------------------------------------------ drawer --- */

/**
 * One entry, read in full: the sentence, the record, and every field the
 * writer snapshotted, before beside after. A line that moved is drawn in the
 * foreground; one that was recorded but did not move sits back in grey, so
 * the eye lands on the change and not on the context around it.
 *
 * Nothing is fetched. The row already holds everything the API knows about
 * the entry, and a trail that re-read itself to open a drawer would be
 * slower for no more truth.
 */
function EntrySheet({ row, onClose }: { row: Row; onClose: () => void }) {
  const money = row.amountBefore !== null || row.amountAfter !== null;
  const moved = row.lines.filter((l) => l.changed);
  const stayed = row.lines.filter((l) => !l.changed);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="shrink-0 gap-1 border-b border-border px-5 py-4 pr-14">
          <SheetTitle className="font-heading text-lg font-bold tracking-tight">
            {row.what}
          </SheetTitle>
          <SheetDescription>
            {row.actor}
            {row.actorRole ? `, ${ROLE_LABELS[row.actorRole].toLowerCase()}` : ""} · {row.stamp}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {/* The record, named and linked. */}
          <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{row.entityTypeLabel}</dt>
            <dd className={cn("min-w-0 truncate", row.entityLabel?.startsWith("#") && "tabular")}>
              {row.entityPath ? (
                <Link to={row.entityPath} className="underline-offset-4 hover:underline">
                  {row.entityLabel ?? `…${row.entityId.slice(-6)}`}
                </Link>
              ) : (
                (row.entityLabel ?? `…${row.entityId.slice(-6)}`)
              )}
            </dd>
          </dl>

          {/* The money, where money moved: the same two figures the row shows,
              with room here to say what each one is. */}
          {money && (
            <div className="mb-5 flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="eyebrow text-muted-foreground">Before</p>
                <p className="tabular font-semibold text-muted-foreground">
                  {row.amountBefore !== null ? formatPesewas(row.amountBefore) : "—"}
                </p>
              </div>
              <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="eyebrow text-muted-foreground">After</p>
                <p className="tabular font-semibold">
                  {row.amountAfter !== null ? formatPesewas(row.amountAfter) : "—"}
                </p>
              </div>
            </div>
          )}

          {row.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The entry records that this happened, and nothing more about the record.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="eyebrow py-2 pr-3 text-muted-foreground">
                    Field
                  </th>
                  <th scope="col" className="eyebrow py-2 pr-3 text-muted-foreground">
                    Before
                  </th>
                  <th scope="col" className="eyebrow py-2 text-muted-foreground">
                    After
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...moved, ...stayed].map((line) => (
                  <tr
                    key={line.key}
                    className={cn(
                      "border-b border-border align-top last:border-0",
                      !line.changed && "text-muted-foreground",
                    )}
                  >
                    <td className="py-2 pr-3 text-muted-foreground">{line.label}</td>
                    <td
                      className={cn(
                        "py-2 pr-3 wrap-break-word",
                        line.changed && line.before !== null && "text-muted-foreground line-through",
                      )}
                    >
                      {line.before ?? "—"}
                    </td>
                    <td className={cn("py-2 wrap-break-word", line.changed && "font-medium")}>
                      {line.after ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Where it came from. A worker's entry names the worker's absence of
            a device instead, so "nothing here" is never mistaken for "not
            recorded". The raw user agent sits in the tooltip: the reading
            above it is a reading, and the office can check it. */}
        <div className="shrink-0 space-y-0.5 border-t border-border px-5 py-3 text-xs text-muted-foreground">
          {row.endpoint ? (
            <>
              <p title={row.userAgent ?? undefined}>
                From {row.device ?? "an unknown device"}
              </p>
              <p className="wrap-break-word">Through {row.endpoint}</p>
            </>
          ) : (
            <p>Made by the system itself — a scheduled job, not a person on a device.</p>
          )}
          {row.requestId && (
            <p className="wrap-break-word">
              Request {row.requestId} — the same code is in the server logs.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
