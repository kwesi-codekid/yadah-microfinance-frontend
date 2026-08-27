import {
  BanknoteArrowDownIcon,
  EyeIcon,
  MoreHorizontalIcon,
  PackageIcon,
  PlusIcon,
  ReceiptTextIcon,
  UserIcon,
} from "lucide-react";
import {
  data,
  Link,
  Outlet,
  useLocation,
  useNavigation,
  useSubmit,
} from "react-router";

import { listAgreements } from "~/api/hire-purchase";
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
  SearchBox,
  StatusPill,
  StatusTabs,
  Th,
} from "~/components/listing";
import { Page, PageHeader } from "~/components/page";
import { RedemptionCountdown } from "~/components/redemption";
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
import { formatPesewas, relativeDayLabel } from "~/lib/format";
import {
  AGREEMENT_STATUS_BLURBS,
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_STATUS_TONE,
  awaitingDeposit,
  isRunning,
  paymentProgress,
  type AgreementStatus,
  type HpAgreement,
} from "~/lib/hire-purchase";
import { requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/hire-purchase";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Hire purchase · Yadah Dynamic Enterprise" }];
}

const PAGE_SIZE = 20;

/** The states that are a queue — something is owed of the office in each. */
const LIVE: AgreementStatus[] = ["pending", "active", "in-arrears", "repossessed"];

const TABS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Awaiting deposit" },
  { key: "active", label: "Active" },
  { key: "in-arrears", label: "In arrears" },
  { key: "repossessed", label: "Repossessed" },
] as const;

/**
 * Everything the API filters on, including the endings. The four closed states
 * are not tabs — nothing is owed of anyone once an agreement is over — but they
 * still have to be reachable, so they live in the dropdown.
 */
const STATUS_OPTIONS: { value: AgreementStatus; label: string }[] = (
  [
    "pending",
    "active",
    "in-arrears",
    "repossessed",
    "closed-completed",
    "closed-redeemed",
    "closed-forfeited",
    "rejected",
  ] as AgreementStatus[]
).map((value) => ({ value, label: AGREEMENT_STATUS_LABELS[value] }));

const ALL_STATUSES = STATUS_OPTIONS.map((option) => option.value);

interface Filters {
  status: AgreementStatus | "all";
  search: string;
  /** Inclusive Accra days on when the agreement was signed. */
  from: string;
  to: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function readFilters(url: URL): Filters {
  const statusParam = url.searchParams.get("status") as AgreementStatus | null;
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : "";
  };
  return {
    status: statusParam && ALL_STATUSES.includes(statusParam) ? statusParam : "all",
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
  return s ? `/hire-purchase?${s}` : "/hire-purchase";
}

/**
 * `GET /hire-purchase/agreements` — the contract book. Office only.
 *
 * Counts are fetched for the four live states only. The endings are reachable
 * through the status dropdown, and counting them on every page load would be
 * four more calls to answer a question nobody is asking.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const scope = {
      search: filters.search || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    };
    const [list, all, ...counts] = await Promise.all([
      listAgreements(token, {
        ...scope,
        page,
        limit: PAGE_SIZE,
        status: filters.status === "all" ? undefined : filters.status,
      }),
      listAgreements(token, { ...scope, page: 1, limit: 1 }),
      ...LIVE.map((status) =>
        listAgreements(token, { ...scope, page: 1, limit: 1, status }),
      ),
    ]);
    return { list, all, counts };
  });

  const byStatus = Object.fromEntries(
    LIVE.map((s, i) => [s, result.counts[i].total]),
  ) as Record<AgreementStatus, number>;

  const now = new Date();
  return data(
    {
      filters,
      page,
      total: result.list.total,
      counts: { all: result.all.total, ...byStatus },
      rows: result.list.items.map((agreement) => toRow(agreement, now)),
    },
    { headers },
  );
}

/** Opening the "sign an agreement" drawer does not re-read the listing. */
export const shouldRevalidate = drawerParentShouldRevalidate;

/* -------------------------------------------------------------------- rows --- */

interface Row {
  id: string;
  customerId: string;
  customerName: string;
  itemName: string;
  durationMonths: number;
  depositRequired: number;
  remaining: number;
  totalPayable: number;
  progress: number;
  status: AgreementStatus;
  signed: string;
  redemptionDeadline: string | null;
  awaiting: boolean;
  running: boolean;
}

function toRow(a: HpAgreement, now: Date): Row {
  return {
    id: a.id,
    customerId: a.customerId,
    customerName: a.customerName ?? "—",
    itemName: a.item.name,
    durationMonths: a.durationMonths,
    depositRequired: a.depositRequired,
    remaining: a.remaining,
    totalPayable: a.totalPayable ?? 0,
    progress: paymentProgress(a),
    status: a.status,
    signed: relativeDayLabel(a.createdAt, now),
    redemptionDeadline: a.redemptionDeadline ?? null,
    awaiting: awaitingDeposit(a),
    running: isRunning(a),
  };
}

export default function HirePurchase({ loaderData }: Route.ComponentProps) {
  const { filters, page, total, counts, rows } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const { search } = useLocation();

  const busy =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/hire-purchase";

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), {
      replace: true,
      preventScrollReset: true,
    });

  const closedStatus =
    filters.status !== "all" && !LIVE.includes(filters.status)
      ? filters.status
      : "";
  const narrowed = Boolean(filters.search || filters.from || filters.to || closedStatus);

  return (
    <Page className="max-w-none">
      <PageHeader
        title="Hire purchase"
        description="Half down, the rest financed. The item goes out when the deposit lands."
        actions={
          <Button asChild>
            <Link
              to={`/hire-purchase/new${search}`}
              prefetch="intent"
              preventScrollReset
            >
              <PlusIcon />
              Sign an agreement
            </Link>
          </Button>
        }
      />

      <ListingCard>
        <ListingToolbar
          tabs={
            <StatusTabs
              tabs={TABS.map((t) => ({
                ...t,
                count: counts[t.key as keyof typeof counts],
              }))}
              active={closedStatus ? "" : filters.status}
              hrefFor={(key) =>
                hrefFor({ ...filters, status: key as AgreementStatus | "all" })
              }
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
            placeholder="Search customer or item"
            label="Search agreements"
            busy={busy}
          />
          <ChoiceFilter
            value={closedStatus as AgreementStatus | ""}
            options={STATUS_OPTIONS}
            apply={(next) => apply({ status: next || "all" })}
            title="Any status"
            allLabel="Any status"
            width="w-52"
          />
          <DayRangeFilter
            from={filters.from}
            to={filters.to}
            title="Signed"
            apply={(next) => apply(next)}
          />
          <ExportMenu
            path="/hire-purchase/export"
            query={(() => {
              const p = queryFor(filters);
              p.delete("page");
              return p.toString();
            })()}
            total={total}
            noun="agreement"
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
            {closedStatus && (
              <FilterChip
                onDrop={() => apply({ status: "all" })}
                label={AGREEMENT_STATUS_LABELS[closedStatus]}
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
          <AgreementsEmpty filters={filters} narrowed={narrowed} />
        ) : (
          <div className={cn("transition-opacity", busy && "opacity-60")}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Customer</Th>
                  <Th className="hidden md:table-cell">Item</Th>
                  <Th className="text-right">Owing</Th>
                  <Th>Status</Th>
                  <Th className="hidden lg:table-cell">Signed</Th>
                  <Th className="w-12 text-right">Actions</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <AgreementRow key={row.id} row={row} />
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

      {/* Signing renders here — a drawer over the book. */}
      <Outlet />
    </Page>
  );
}

function AgreementRow({ row }: { row: Row }) {
  return (
    <TableRow className="group">
      <TableCell className="px-4 py-3">
        <Link
          to={`/hire-purchase/${row.id}`}
          className="block truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {row.customerName}
        </Link>
        <p className="truncate text-xs text-muted-foreground md:hidden">
          {row.itemName}
        </p>
        <p className="hidden text-xs text-muted-foreground md:block">
          {row.durationMonths} months
        </p>
      </TableCell>

      <TableCell className="hidden max-w-48 px-4 py-3 md:table-cell">
        <p className="truncate">{row.itemName}</p>
      </TableCell>

      {/* Before the deposit there is no balance to speak of — `remaining` is
          zero until activation — so the row shows what is actually being waited
          for instead of a misleading nil. */}
      <TableCell className="px-4 py-3 text-right whitespace-nowrap">
        {row.awaiting ? (
          <>
            <span className="tabular font-medium">
              {formatPesewas(row.depositRequired)}
            </span>
            <p className="text-xs text-muted-foreground">deposit due</p>
          </>
        ) : (
          <>
            <span className="tabular font-medium">{formatPesewas(row.remaining)}</span>
            {row.running && row.totalPayable > 0 && (
              <span
                className="mt-1 block h-1 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${Math.round(row.progress * 100)}% paid`}
              >
                <span
                  className={cn(
                    "block h-full",
                    row.status === "in-arrears" ? "bg-warning" : "bg-primary",
                  )}
                  style={{ width: `${row.progress * 100}%` }}
                />
              </span>
            )}
          </>
        )}
      </TableCell>

      <TableCell className="px-4 py-3">
        <StatusPill
          label={AGREEMENT_STATUS_LABELS[row.status]}
          blurb={AGREEMENT_STATUS_BLURBS[row.status]}
          tone={AGREEMENT_STATUS_TONE[row.status]}
        />
        {row.redemptionDeadline && row.status === "repossessed" && (
          <RedemptionCountdown deadline={row.redemptionDeadline} compact />
        )}
      </TableCell>

      <TableCell className="hidden px-4 py-3 text-sm text-muted-foreground lg:table-cell">
        {row.signed}
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
                Actions for {row.customerName}&rsquo;s agreement
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild>
              <Link to={`/hire-purchase/${row.id}`}>
                <EyeIcon />
                View agreement
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild disabled={!row.awaiting && !row.running}>
              <Link to={`/hire-purchase/${row.id}/pay`} prefetch="intent">
                <BanknoteArrowDownIcon />
                {row.awaiting ? "Record deposit" : "Record payment"}
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

function AgreementsEmpty({
  filters,
  narrowed,
}: {
  filters: Filters;
  narrowed: boolean;
}) {
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ReceiptTextIcon className="size-6" />
        </EmptyMedia>
        <EmptyTitle>
          {narrowed
            ? "No matches"
            : filters.status === "all"
              ? "No agreements yet"
              : `Nothing ${AGREEMENT_STATUS_LABELS[filters.status].toLowerCase()}`}
        </EmptyTitle>
        <EmptyDescription>
          {filters.search
            ? `Nothing matched “${filters.search}”. Search by customer or item.`
            : narrowed
              ? "No agreement matches those filters."
              : "Sign one against something on the shelf and it will appear here."}
        </EmptyDescription>
      </EmptyHeader>
      {narrowed ? (
        <Button asChild variant="outline" size="sm">
          <Link to={hrefFor({ ...filters, search: "", from: "", to: "", status: "all" })}>
            Clear filters
          </Link>
        </Button>
      ) : filters.status === "all" ? (
        <Button asChild variant="outline" size="sm">
          <Link to="/inventory">
            <PackageIcon />
            Check the shelf
          </Link>
        </Button>
      ) : null}
    </Empty>
  );
}
