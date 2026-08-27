import {
  MoreHorizontalIcon,
  PrinterIcon,
  ReceiptIcon,
  ShoppingCartIcon,
  UserXIcon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  data,
  Link,
  useFetcher,
  useLocation,
  useNavigation,
  useSubmit,
} from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { listSales, voidSale } from "~/api/sales";
import {
  DayRangeChip,
  DayRangeFilter,
  ExportMenu,
  Figure,
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
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
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { formatAccraDateTime, formatCount, formatPesewas } from "~/lib/format";
import {
  CHANNEL_LABELS,
  SALE_STATUS_BLURBS,
  SALE_STATUS_LABELS,
  SALE_STATUS_TONE,
  canVoid,
  isWalkIn,
  unitCount,
  type Sale,
  type SaleStatus,
} from "~/lib/sales";
import { requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/sales";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Counter sales · Yadah Dynamic Enterprise" }];
}

const PAGE_SIZE = 20;

const STATUSES: SaleStatus[] = ["completed", "voided"];

const TABS = [
  { key: "all", label: "All" },
  { key: "completed", label: "Completed" },
  { key: "voided", label: "Voided" },
] as const;
type Tab = (typeof TABS)[number]["key"];

interface Filters {
  status: Tab;
  search: string;
  walkInOnly: boolean;
  from: string;
  to: string;
}

function readFilters(url: URL): Filters {
  const statusParam = url.searchParams.get("status") as SaleStatus | null;
  return {
    status: statusParam && STATUSES.includes(statusParam) ? statusParam : "all",
    search: url.searchParams.get("search")?.trim() ?? "",
    walkInOnly: url.searchParams.get("walkIn") === "1",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status !== "all") p.set("status", f.status);
  if (f.search) p.set("search", f.search);
  if (f.walkInOnly) p.set("walkIn", "1");
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (page > 1) p.set("page", String(page));
  return p;
}

function hrefFor(f: Filters, page = 1): string {
  const s = queryFor(f, page).toString();
  return s ? `/sales?${s}` : "/sales";
}

/** What the API wants, from what the URL says. */
function paramsFor(f: Filters) {
  return {
    search: f.search || undefined,
    walkInOnly: f.walkInOnly ? ("true" as const) : undefined,
    from: f.from || undefined,
    to: f.to || undefined,
  };
}

/**
 * `GET /hire-purchase/sales` — the day book. Office only.
 *
 * The tab counts are fetched the way every other listing here does it: one
 * one-row request per status, scoped by the same filters as the rows, so a
 * count never contradicts the list under it.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const scope = paramsFor(filters);
    const [list, ...counts] = await Promise.all([
      listSales(token, {
        ...scope,
        page,
        limit: PAGE_SIZE,
        status: filters.status === "all" ? undefined : filters.status,
      }),
      ...STATUSES.map((status) =>
        listSales(token, { ...scope, page: 1, limit: 1, status }),
      ),
    ]);
    return { list, counts };
  });

  const byStatus = Object.fromEntries(
    STATUSES.map((s, i) => [s, result.counts[i].total]),
  ) as Record<SaleStatus, number>;

  return data(
    {
      filters,
      page,
      total: result.list.total,
      // These cover the whole filter and exclude voided sales — not the page.
      totals: result.list.totals,
      counts: {
        all: STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
        ...byStatus,
      },
      rows: result.list.items.map(toRow),
    },
    { headers },
  );
}

interface ActionResult {
  ok: boolean;
  message: string;
}

/** Voiding, from the row menu. Ringing one up is a page of its own. */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const reason = String(form.get("reason") ?? "").trim();

  if (!id) {
    return data<ActionResult>({ ok: false, message: "No sale." }, { status: 400 });
  }
  if (!reason) {
    return data<ActionResult>(
      { ok: false, message: "Say why it is being voided." },
      { status: 400 },
    );
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      voidSale(token, id, reason),
    );
    return data<ActionResult>(
      { ok: true, message: `Receipt ${result.sale.receiptNo} voided. Stock went back.` },
      { headers },
    );
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
  receiptNo: string;
  buyerName: string;
  buyerPhone: string;
  customerId: string | null;
  walkIn: boolean;
  items: number;
  units: number;
  subtotal: number;
  discount: number;
  total: number;
  channel: string;
  status: SaleStatus;
  voidable: boolean;
  voidReason: string;
  createdAt: string;
}

function toRow(sale: Sale): Row {
  return {
    id: sale.id,
    receiptNo: sale.receiptNo,
    buyerName: sale.buyerName,
    buyerPhone: sale.buyerPhone ?? "",
    customerId: sale.customerId,
    walkIn: isWalkIn(sale),
    items: sale.lines.length,
    units: unitCount(sale),
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    channel: CHANNEL_LABELS[sale.channel] ?? sale.channel,
    status: sale.status,
    voidable: canVoid(sale),
    voidReason: sale.voidReason ?? "",
    createdAt: sale.createdAt,
  };
}

export default function Sales({ loaderData }: Route.ComponentProps) {
  const { filters, page, total, totals, counts, rows } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const fetcher = useFetcher<ActionResult>();
  const { search } = useLocation();

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) toast.success(fetcher.data.message);
    else toast.error(fetcher.data.message);
  }, [fetcher.data]);

  const busy =
    navigation.state === "loading" && navigation.location?.pathname === "/sales";

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), {
      replace: true,
      preventScrollReset: true,
    });

  const narrowed = Boolean(
    filters.search || filters.walkInOnly || filters.from || filters.to,
  );

  return (
    <Page className="max-w-none">
      <PageHeader
        title="Counter sales"
        description="Things sold outright: stock out, money in, no agreement."
        actions={
          <Button asChild>
            <Link to="/sales/new" prefetch="intent">
              <ShoppingCartIcon />
              New sale
            </Link>
          </Button>
        }
      />

      {/* The API's totals cover the whole filter, not the page, and always
          leave voided sales out. Both of those are said here rather than left
          to be inferred from figures that will not add up to the rows. */}
      <dl className="mb-6 grid gap-3 sm:grid-cols-3">
        <Figure
          label="Sales"
          value={formatCount(totals.salesCount)}
          hint="Completed, across every page"
        />
        <Figure
          label="Revenue"
          value={formatPesewas(totals.revenue)}
          tone="success"
          hint="Voided sales excluded"
        />
        <Figure
          label="Profit"
          value={formatPesewas(totals.profit)}
          tone="revenue"
          hint="Margin over cost — office figure"
        />
      </dl>

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
          <SearchBox
            value={filters.search}
            apply={(next) => apply({ search: next })}
            hidden={{
              status: filters.status === "all" ? "" : filters.status,
              walkIn: filters.walkInOnly ? "1" : "",
              from: filters.from,
              to: filters.to,
            }}
            placeholder="Buyer, phone or receipt no."
            label="Search sales"
            busy={busy}
          />
          <Button
            variant="outline"
            size="sm"
            aria-pressed={filters.walkInOnly}
            onClick={() => apply({ walkInOnly: !filters.walkInOnly })}
            className={cn(filters.walkInOnly && "border-primary/50 text-primary")}
          >
            <UserXIcon />
            Walk-ins only
          </Button>
          <DayRangeFilter
            from={filters.from}
            to={filters.to}
            apply={(next) => apply(next)}
            title="Sold"
          />
          <ExportMenu
            path="/sales/export"
            query={queryFor({ ...filters, status: filters.status }).toString()}
            total={total}
            noun="sale"
          />
        </ListingToolbar>

        {narrowed && (
          <FilterBar total={total} noun="sale" plural="sales">
            {filters.search && (
              <FilterChip
                label={`“${filters.search}”`}
                onDrop={() => apply({ search: "" })}
              />
            )}
            {filters.walkInOnly && (
              <FilterChip
                label="Walk-ins only"
                onDrop={() => apply({ walkInOnly: false })}
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
                <ReceiptIcon />
              </EmptyMedia>
              <EmptyTitle>
                {narrowed ? "Nothing matches" : "Nothing sold over the counter yet"}
              </EmptyTitle>
              <EmptyDescription>
                {narrowed
                  ? "Widen the filters, or clear them to see every sale."
                  : "Ring one up and it appears here with its receipt number."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <Th>Receipt</Th>
                <Th>Buyer</Th>
                <Th className="text-right">Items</Th>
                <Th className="text-right">Discount</Th>
                <Th className="text-right">Total</Th>
                <Th>Channel</Th>
                <Th>Sold</Th>
                <Th>Status</Th>
                <Th className="w-12 text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <SaleRow key={row.id} row={row} fetcher={fetcher} search={search} />
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
    </Page>
  );
}

function SaleRow({
  row,
  fetcher,
  search,
}: {
  row: Row;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  search: string;
}) {
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <>
      <TableRow className={cn(row.status === "voided" && "text-muted-foreground")}>
        <TableCell className="px-4 py-3">
          <Link
            to={`/sales/${row.id}${search}`}
            prefetch="intent"
            className="tabular font-medium underline-offset-4 hover:underline"
          >
            {row.receiptNo}
          </Link>
        </TableCell>
        <TableCell className="px-4 py-3">
          <div className="min-w-0">
            {row.customerId ? (
              <Link
                to={`/customers/${row.customerId}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {row.buyerName}
              </Link>
            ) : (
              <span className="font-medium">{row.buyerName}</span>
            )}
            <p className="text-xs text-muted-foreground">
              {row.walkIn ? "Walk-in" : "Registered"}
              {row.buyerPhone ? ` · ${row.buyerPhone}` : ""}
            </p>
          </div>
        </TableCell>
        <TableCell className="tabular px-4 py-3 text-right">
          {formatCount(row.units)}
          {row.items !== row.units && (
            <span className="ml-1 text-xs text-muted-foreground">
              /{formatCount(row.items)} line{row.items === 1 ? "" : "s"}
            </span>
          )}
        </TableCell>
        <TableCell className="tabular px-4 py-3 text-right">
          {row.discount > 0 ? (
            <span className="text-warning">−{formatPesewas(row.discount)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="tabular px-4 py-3 text-right font-semibold">
          {formatPesewas(row.total)}
        </TableCell>
        <TableCell className="px-4 py-3 text-sm">{row.channel}</TableCell>
        <TableCell className="px-4 py-3 text-sm whitespace-nowrap">
          {formatAccraDateTime(row.createdAt)}
        </TableCell>
        <TableCell className="px-4 py-3">
          <StatusPill
            label={SALE_STATUS_LABELS[row.status]}
            blurb={row.voidReason || SALE_STATUS_BLURBS[row.status]}
            tone={SALE_STATUS_TONE[row.status]}
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
                <span className="sr-only">Actions for receipt {row.receiptNo}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem asChild>
                <Link to={`/sales/${row.id}${search}`} prefetch="intent">
                  <ReceiptIcon />
                  Open the sale
                </Link>
              </DropdownMenuItem>
              {/* A resource route answering with bytes — a plain anchor, so the
                  router does not try to navigate to it. A voided sale still
                  prints, which is why this is never disabled. */}
              <DropdownMenuItem asChild>
                <a href={`/sales/${row.id}/receipt`}>
                  <PrinterIcon />
                  Print receipt
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={!row.voidable}
                onSelect={(event) => {
                  event.preventDefault();
                  setReason("");
                  setConfirmVoid(true);
                }}
              >
                <XCircleIcon />
                Void this sale
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>

      <AlertDialog open={confirmVoid} onOpenChange={setConfirmVoid}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void receipt {row.receiptNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              The {formatCount(row.units)} unit{row.units === 1 ? "" : "s"} go back
              on the shelf and the {formatPesewas(row.total)} stops counting toward
              revenue. The sale itself stays on the record, stamped with your name
              and this reason. There is no undo.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5">
            <Label
              htmlFor={`reason-${row.id}`}
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Why<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id={`reason-${row.id}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Wrong item rung up"
              maxLength={200}
              autoComplete="off"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={!reason.trim()}
              onClick={() => {
                setConfirmVoid(false);
                fetcher.submit({ id: row.id, reason: reason.trim() }, { method: "post" });
              }}
            >
              Void the sale
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
