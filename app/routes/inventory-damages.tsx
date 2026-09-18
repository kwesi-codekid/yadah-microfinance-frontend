import {
  CheckIcon,
  MoreHorizontalIcon,
  PackageXIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect } from "react";
import {
  data,
  Link,
  Outlet,
  useFetcher,
  useLocation,
  useNavigation,
  useSubmit,
} from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import {
  approveDamage,
  getDamageSummary,
  listDamages,
  rejectDamage,
  trashDamage,
} from "~/api/hire-purchase";
import {
  ChoiceFilter,
  ExportMenu,
  FilterBar,
  FilterChip,
  FilterMenu,
  Figure,
  ListingCard,
  ListingFooter,
  ListingToolbar,
  SearchBox,
  StatusPill,
  Th,
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
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { isOffice } from "~/lib/auth";
import { formatAccraDate, formatCount, formatPesewas } from "~/lib/format";
import {
  DAMAGE_CAUSES,
  DAMAGE_CAUSE_LABELS,
  DAMAGE_STATUS_LABELS,
  damageTone,
  type DamageCause,
  type DamageStatus,
  type HpDamage,
} from "~/lib/hire-purchase";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/inventory-damages";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Damages · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = { title: "Damages" };

const PAGE_SIZE = 20;

const TABS = [
  { key: "pending", label: "Awaiting approval" },
  { key: "approved", label: "Written off" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
] as const;
type Tab = (typeof TABS)[number]["key"];

interface Filters {
  status: Tab;
  cause: DamageCause | "";
  search: string;
}

function readFilters(url: URL): Filters {
  const status = url.searchParams.get("status") as Tab | null;
  const cause = url.searchParams.get("cause") as DamageCause | null;
  return {
    // Pending leads: the register's reason for existing is the queue of
    // reports the office has not looked at yet.
    status: status && TABS.some((t) => t.key === status) ? status : "pending",
    cause: cause && DAMAGE_CAUSES.includes(cause) ? cause : "",
    search: url.searchParams.get("search")?.trim() ?? "",
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status !== "pending") p.set("status", f.status);
  if (f.cause) p.set("cause", f.cause);
  if (f.search) p.set("search", f.search);
  if (page > 1) p.set("page", String(page));
  return p;
}

function hrefFor(f: Filters, page = 1): string {
  const s = queryFor(f, page).toString();
  return s ? `/inventory/damages?${s}` : "/inventory/damages";
}

/**
 * `GET /hire-purchase/damages` — stock that left the shelf without being sold.
 *
 * The counter reports and the office decides, so this page is two things at
 * once: a queue for whoever approves, and a record of what the shop has lost.
 * The figures count APPROVED reports only — a report nobody has looked at is
 * not yet a loss, and showing it as one would overstate every month.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireCounter(request);
  const url = new URL(request.url);
  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const scope = {
      cause: filters.cause || undefined,
      search: filters.search || undefined,
    };
    const [list, summary] = await Promise.all([
      listDamages(token, {
        ...scope,
        page,
        limit: PAGE_SIZE,
        status: filters.status === "all" ? undefined : filters.status,
      }),
      // The totals are the whole register, not this page of it, so a filter
      // never makes the shop look like it lost less than it did.
      getDamageSummary(token).catch(() => null),
    ]);
    return { list, summary };
  });

  return data(
    {
      rows: result.list.items,
      total: result.list.total,
      page,
      pendingCount: result.list.pendingCount,
      filteredCost: result.list.totalCostValue,
      summary: result.summary,
      filters,
      canDecide: isOffice(viewer),
    },
    { headers },
  );
}

export async function action({ request }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  if (!id) return data({ error: "Nothing was selected." }, { status: 400 });

  try {
    if (intent === "approve") {
      const { data: result } = await withAuth(request, (token) => approveDamage(token, id));
      return data({
        ok: `${formatCount(result.damage.quantity)} × ${result.damage.itemName} written off.`,
      });
    }
    if (intent === "reject") {
      const reason = String(form.get("reason") ?? "").trim();
      if (!reason) return data({ error: "Say why it was refused." }, { status: 400 });
      await withAuth(request, (token) => rejectDamage(token, id, reason));
      return data({ ok: "Report rejected. The shelf is untouched." });
    }
    if (intent === "trash") {
      await withAuth(request, (token) => trashDamage(token, id, "Removed from the register"));
      return data({ ok: "Report removed." });
    }
    return data({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

/** Opening the report drawer does not re-read the register underneath it. */
export const shouldRevalidate = drawerParentShouldRevalidate;

export default function InventoryDamages({ loaderData }: Route.ComponentProps) {
  const { rows, total, page, pendingCount, filteredCost, summary, filters, canDecide } =
    loaderData;
  const submit = useSubmit();
  const navigation = useNavigation();
  const location = useLocation();
  const fetcher = useFetcher<typeof action>();
  const busy = navigation.state === "loading";

  useEffect(() => {
    if (fetcher.data && "ok" in fetcher.data && fetcher.data.ok) {
      toast.success(fetcher.data.ok);
    }
    if (fetcher.data && "error" in fetcher.data && fetcher.data.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.data]);

  const apply = (next: Partial<Filters>) => {
    submit(queryFor({ ...filters, ...next }), {
      method: "get",
      action: "/inventory/damages",
    });
  };

  const narrowed = filters.status !== "pending" || Boolean(filters.cause || filters.search);

  return (
    <Page className="max-w-none">
      <dl className="mb-6 grid gap-3 sm:grid-cols-3">
        <Figure
          label="Written off"
          value={formatPesewas(summary?.totalCostValue ?? filteredCost)}
          hint={
            summary
              ? `${formatCount(summary.totalQuantity)} unit${summary.totalQuantity === 1 ? "" : "s"} at cost`
              : "Approved reports, at cost"
          }
          tone="danger"
        />
        <Figure
          label="Awaiting approval"
          value={formatCount(pendingCount)}
          hint={pendingCount === 0 ? "Nothing to decide" : "Not a loss until approved"}
          tone={pendingCount > 0 ? "warning" : "muted"}
        />
        <Figure
          label="Biggest cause"
          value={
            summary?.byCause[0]
              ? DAMAGE_CAUSE_LABELS[summary.byCause[0].cause]
              : "—"
          }
          hint={
            summary?.byCause[0]
              ? formatPesewas(summary.byCause[0].costValue)
              : "Nothing written off yet"
          }
          tone="muted"
        />
      </dl>

      <ListingCard>
        <ListingToolbar
          tabs={
            <FilterMenu
              label="Status"
              active={filters.status}
              items={TABS.map((tab) => ({
                key: tab.key,
                label: tab.label,
                to: hrefFor({ ...filters, status: tab.key }),
              }))}
            />
          }
        >
          <SearchBox
            value={filters.search}
            apply={(search) => apply({ search })}
            hidden={{
              status: filters.status === "pending" ? "" : filters.status,
              cause: filters.cause,
            }}
            placeholder="Item or description"
            label="Search damage reports"
            busy={busy}
          />
          <ChoiceFilter
            value={filters.cause}
            options={DAMAGE_CAUSES.map((cause) => ({
              value: cause,
              label: DAMAGE_CAUSE_LABELS[cause],
            }))}
            apply={(cause) => apply({ cause })}
            title="Cause"
            allLabel="Any cause"
            width="w-52"
          />
          <ExportMenu
            path="/inventory/damages/export"
            query={queryFor(filters).toString()}
            total={total}
            noun="report"
          />
          <Button asChild size="sm">
            <Link to={{ pathname: "new", search: location.search }}>
              <PlusIcon />
              Report damage
            </Link>
          </Button>
        </ListingToolbar>

        {narrowed && (
          <FilterBar total={total} noun="report" plural="reports">
            {filters.status !== "pending" && (
              <FilterChip
                label={TABS.find((t) => t.key === filters.status)?.label ?? ""}
                onDrop={() => apply({ status: "pending" })}
              />
            )}
            {filters.cause && (
              <FilterChip
                label={DAMAGE_CAUSE_LABELS[filters.cause]}
                onDrop={() => apply({ cause: "" })}
              />
            )}
            {filters.search && (
              <FilterChip label={`“${filters.search}”`} onDrop={() => apply({ search: "" })} />
            )}
          </FilterBar>
        )}

        {rows.length === 0 ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PackageXIcon />
              </EmptyMedia>
              <EmptyTitle>
                {narrowed ? "Nothing matched" : "Nothing has been written off"}
              </EmptyTitle>
              <EmptyDescription>
                {narrowed
                  ? "Widen the filters, or clear them to see the whole register."
                  : "When something is broken, spoiled or missing from the shelf, report it here and the office writes it off."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table className={busy ? "opacity-60 transition-opacity" : undefined}>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Item</Th>
                  <Th className="hidden sm:table-cell">Cause</Th>
                  <Th className="hidden md:table-cell">Happened</Th>
                  <Th className="text-right">Units</Th>
                  <Th className="hidden text-right lg:table-cell">Cost</Th>
                  <Th>Status</Th>
                  <Th className="w-10">
                    <span className="sr-only">Actions</span>
                  </Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Row key={row.id} row={row} canDecide={canDecide} fetcher={fetcher} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <ListingFooter
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          hrefFor={(next) => hrefFor(filters, next)}
        />
      </ListingCard>

      <Outlet />
    </Page>
  );
}

function Row({
  row,
  canDecide,
  fetcher,
}: {
  row: HpDamage;
  canDecide: boolean;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
}) {
  const pending = row.status === "pending";
  const decide = (intent: "approve" | "trash") => {
    fetcher.submit({ intent, id: row.id }, { method: "post", action: "/inventory/damages" });
  };

  return (
    <TableRow>
      <TableCell>
        <Link
          to={`/inventory/damages/${row.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.itemName}
        </Link>
        <p className="line-clamp-1 text-xs text-muted-foreground">{row.description}</p>
      </TableCell>
      <TableCell className="hidden text-muted-foreground sm:table-cell">
        {DAMAGE_CAUSE_LABELS[row.cause]}
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        {formatAccraDate(row.occurredOn)}
      </TableCell>
      <TableCell className="tabular text-right">{formatCount(row.quantity)}</TableCell>
      <TableCell className="tabular hidden text-right lg:table-cell">
        {/* Blank rather than zero while pending: nothing has been valued yet,
            and a zero would read as "this cost nothing". */}
        {row.costValue == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          formatPesewas(row.costValue)
        )}
      </TableCell>
      <TableCell>
        <StatusPill
          tone={damageTone(row.status)}
          label={DAMAGE_STATUS_LABELS[row.status]}
        />
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${row.itemName}`}>
              <MoreHorizontalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to={`/inventory/damages/${row.id}`}>Open</Link>
            </DropdownMenuItem>
            {canDecide && pending && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => decide("approve")}>
                  <CheckIcon />
                  Approve and write off
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={`/inventory/damages/${row.id}`}>
                    <XIcon />
                    Reject…
                  </Link>
                </DropdownMenuItem>
              </>
            )}
            {canDecide && row.status !== "approved" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => decide("trash")}>
                  <Trash2Icon />
                  Remove from the register
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
