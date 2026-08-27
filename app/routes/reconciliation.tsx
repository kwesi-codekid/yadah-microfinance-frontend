import {
  ChartNoAxesColumnIcon,
  HandCoinsIcon,
  MoreHorizontalIcon,
  ScaleIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  data,
  Link,
  Outlet,
  useLocation,
  useNavigation,
  useSubmit,
} from "react-router";

import { listReconciliations } from "~/api/reconciliation";
import { listUsers } from "~/api/users";
import {
  ChoiceFilter,
  DayRangeChip,
  DayRangeFilter,
  ExportMenu,
  FilterBar,
  FilterChip,
  ListingCard,
  ListingFooter,
  ListingToolbar,
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
import { formatAccraDate, formatPesewas } from "~/lib/format";
import {
  STATUS_BLURBS,
  STATUS_LABELS,
  STATUS_TONE,
  VARIANCE_LABELS,
  VARIANCE_TONE,
  isPending,
  varianceKind,
  type Reconciliation,
  type ReconciliationStatus,
} from "~/lib/reconciliation";
import { requireUser, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/reconciliation";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Cash handover · Yadah Dynamic Enterprise" }];
}

const PAGE_SIZE = 20;

const STATUSES: ReconciliationStatus[] = ["declared", "reconciled"];

const TABS = [
  { key: "all", label: "All" },
  { key: "declared", label: "Awaiting count" },
  { key: "reconciled", label: "Reconciled" },
] as const;
type Tab = (typeof TABS)[number]["key"];

interface Filters {
  status: Tab;
  collectorId: string;
  varianceOnly: boolean;
  from: string;
  to: string;
}

function readFilters(url: URL): Filters {
  const statusParam = url.searchParams.get("status") as ReconciliationStatus | null;
  return {
    status: statusParam && STATUSES.includes(statusParam) ? statusParam : "all",
    collectorId: url.searchParams.get("collectorId") ?? "",
    varianceOnly: url.searchParams.get("variance") === "1",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status !== "all") p.set("status", f.status);
  if (f.collectorId) p.set("collectorId", f.collectorId);
  if (f.varianceOnly) p.set("variance", "1");
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (page > 1) p.set("page", String(page));
  return p;
}

function hrefFor(f: Filters, page = 1): string {
  const s = queryFor(f, page).toString();
  return s ? `/reconciliation?${s}` : "/reconciliation";
}

/**
 * `GET /reconciliation` — the handover book.
 *
 * Every role, and the API does the scoping: a collector sees only their own
 * days whatever this asks for, which is why there is no role check narrowing
 * the request here. What the role *does* decide is the shape of the screen —
 * a collector gets their own record and the button to close today, the office
 * gets everyone's and the collector filter.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);

  const office = user.role === "admin" || user.role === "manager";
  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const scope = {
      collectorId: filters.collectorId || undefined,
      varianceOnly: filters.varianceOnly ? ("true" as const) : undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    };
    const [list, collectors, ...counts] = await Promise.all([
      listReconciliations(token, {
        ...scope,
        page,
        limit: PAGE_SIZE,
        status: filters.status === "all" ? undefined : filters.status,
      }),
      // Only the office can filter by collector, so only the office pays for
      // the list that populates the filter.
      office
        ? listUsers(token, { role: "collector", status: "active", limit: 100 })
        : Promise.resolve(null),
      ...STATUSES.map((status) =>
        listReconciliations(token, { ...scope, page: 1, limit: 1, status }),
      ),
    ]);
    return { list, collectors, counts };
  });

  const byStatus = Object.fromEntries(
    STATUSES.map((s, i) => [s, result.counts[i].total]),
  ) as Record<ReconciliationStatus, number>;

  return data(
    {
      office,
      filters,
      page,
      total: result.list.total,
      counts: {
        all: STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
        ...byStatus,
      },
      collectors:
        result.collectors?.items.map(({ id, name }) => ({ value: id, label: name })) ??
        [],
      rows: result.list.items.map(toRow),
    },
    { headers },
  );
}

/** Opening the declare drawer does not re-read the book underneath it. */
export const shouldRevalidate = drawerParentShouldRevalidate;

/* -------------------------------------------------------------------- rows --- */

interface Row {
  id: string;
  accraDay: string;
  collectorName: string;
  expected: number;
  declared: number;
  received: number | null;
  variance: number | null;
  status: ReconciliationStatus;
  pending: boolean;
  reason: string;
}

function toRow(r: Reconciliation): Row {
  return {
    id: r.id,
    accraDay: r.accraDay,
    collectorName: r.collectorName ?? "Collector",
    expected: r.expectedAmount,
    declared: r.declaredAmount,
    received: r.receivedAmount ?? null,
    variance: r.variance ?? null,
    status: r.status,
    pending: isPending(r),
    reason: r.varianceReason ?? "",
  };
}

export default function ReconciliationBook({ loaderData }: Route.ComponentProps) {
  const { office, filters, page, total, counts, collectors, rows } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const { search } = useLocation();

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), {
      replace: true,
      preventScrollReset: true,
    });

  const narrowed = Boolean(
    filters.collectorId || filters.varianceOnly || filters.from || filters.to,
  );
  const collectorName = collectors.find((c) => c.value === filters.collectorId)?.label;

  return (
    <Page className="max-w-none">
      <PageHeader
        title="Cash handover"
        description={
          office
            ? "What each collector declared, and what the office counted."
            : "The days you have closed, and what the office counted."
        }
        actions={
          <>
            {office && (
              <Button asChild variant="outline">
                <Link to="/reconciliation/variances" prefetch="intent">
                  <ChartNoAxesColumnIcon />
                  Variances
                </Link>
              </Button>
            )}
            {/* Declaring is the collector's half. The office has its own cash
                and may close a day too; the API pins whoever asks to
                themselves either way. */}
            <Button asChild>
              <Link to={`/reconciliation/declare${search}`} prefetch="intent" preventScrollReset>
                <HandCoinsIcon />
                Declare cash
              </Link>
            </Button>
          </>
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
          {office && collectors.length > 0 && (
            <ChoiceFilter
              value={filters.collectorId}
              options={collectors}
              apply={(next) => apply({ collectorId: next })}
              title="Collector"
              allLabel="Every collector"
              width="w-56"
            />
          )}
          <Button
            variant="outline"
            size="sm"
            aria-pressed={filters.varianceOnly}
            onClick={() => apply({ varianceOnly: !filters.varianceOnly })}
            className={cn(filters.varianceOnly && "border-primary/50 text-primary")}
          >
            <TriangleAlertIcon />
            Gaps only
          </Button>
          <DayRangeFilter
            from={filters.from}
            to={filters.to}
            apply={(next) => apply(next)}
            title="Day"
          />
          {office && (
            <ExportMenu
              path="/reconciliation/export"
              query={queryFor(filters).toString()}
              total={total}
              noun="day"
            />
          )}
        </ListingToolbar>

        {narrowed && (
          <FilterBar total={total} noun="day" plural="days">
            {filters.collectorId && (
              <FilterChip
                label={collectorName ?? "One collector"}
                onDrop={() => apply({ collectorId: "" })}
              />
            )}
            {filters.varianceOnly && (
              <FilterChip
                label="Gaps only"
                onDrop={() => apply({ varianceOnly: false })}
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
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ScaleIcon />
              </EmptyMedia>
              <EmptyTitle>
                {narrowed ? "Nothing matches" : "No day has been closed yet"}
              </EmptyTitle>
              <EmptyDescription>
                {narrowed
                  ? "Widen the filters, or clear them to see every day."
                  : "A collector declares what they are handing over, then the office counts it. Both halves show up here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <Th>Day</Th>
                {office && <Th>Collector</Th>}
                <Th className="text-right">Expected</Th>
                <Th className="text-right">Declared</Th>
                <Th className="text-right">Counted</Th>
                <Th className="text-right">Variance</Th>
                <Th>Status</Th>
                <Th className="w-12 text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="px-4 py-3 whitespace-nowrap">
                    <Link
                      to={`/reconciliation/${row.id}`}
                      prefetch="intent"
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {formatAccraDate(`${row.accraDay}T12:00:00Z`)}
                    </Link>
                  </TableCell>
                  {office && (
                    <TableCell className="px-4 py-3">{row.collectorName}</TableCell>
                  )}
                  <TableCell className="tabular px-4 py-3 text-right text-muted-foreground">
                    {formatPesewas(row.expected)}
                  </TableCell>
                  <TableCell className="tabular px-4 py-3 text-right">
                    {formatPesewas(row.declared)}
                  </TableCell>
                  <TableCell className="tabular px-4 py-3 text-right">
                    {row.received == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      formatPesewas(row.received)
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <VarianceCell variance={row.variance} />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <StatusPill
                      label={STATUS_LABELS[row.status]}
                      blurb={row.reason || STATUS_BLURBS[row.status]}
                      tone={STATUS_TONE[row.status]}
                    />
                  </TableCell>
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
                            Actions for {row.collectorName} on {row.accraDay}
                          </span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem asChild>
                          <Link to={`/reconciliation/${row.id}`} prefetch="intent">
                            <ScaleIcon />
                            Open the day
                          </Link>
                        </DropdownMenuItem>
                        {/* Counting is the office's half, and a collector may
                            not confirm their own cash — so the item is drawn
                            and disabled rather than hidden, which is how every
                            row menu in this app says "not for you". */}
                        <DropdownMenuItem asChild disabled={!office || !row.pending}>
                          <Link to={`/reconciliation/${row.id}`} prefetch="intent">
                            <HandCoinsIcon />
                            Count and confirm
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <ListingFooter
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          hrefFor={(p) => hrefFor(filters, p)}
        />
      </ListingCard>

      {/* The declare drawer opens over the book. */}
      <Outlet />
    </Page>
  );
}

/**
 * A variance, drawn as what it means rather than as a signed number. "Short
 * GH₵ 50" is read correctly at a glance; "−50.00" has to be reasoned about, and
 * on this table the reasoning is exactly what people get wrong.
 */
function VarianceCell({ variance }: { variance: number | null }) {
  if (variance == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const kind = varianceKind(variance);
  return (
    <span
      className={cn(
        "tabular text-sm font-medium",
        VARIANCE_TONE[kind] === "danger" && "text-danger",
        VARIANCE_TONE[kind] === "warning" && "text-warning",
        VARIANCE_TONE[kind] === "success" && "text-muted-foreground",
      )}
    >
      {kind === "square"
        ? VARIANCE_LABELS.square
        : `${VARIANCE_LABELS[kind]} ${formatPesewas(Math.abs(variance))}`}
    </span>
  );
}
