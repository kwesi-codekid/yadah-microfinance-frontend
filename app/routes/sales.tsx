import {
  BanknoteIcon,
  CoinsIcon,
  PrinterIcon,
  ReceiptIcon,
  ShoppingCartIcon,
  UserXIcon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { data, Link, useFetcher, useLocation, useNavigation, useSubmit } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { listSales, voidSale } from "~/api/sales";
import {
  DayRangeFilter,
  ExportMenu,
  SearchBox,
  StatusPill,
} from "~/components/listing";
import { Page } from "~/components/page";
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
  DataTable,
  type Column,
  type TableTab,
} from "~/components/ui/data-table";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatAccraDate, formatAccraDateTime, formatCount, formatPesewas } from "~/lib/format";
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
  return [{ title: "Sales · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page, and the line under it. */
export const handle = {
  title: "Sales",
  description: "Everything sold outright: stock out, money in, no agreement.",
};

/** Ten rows, as the ledger and the customer's statement page them. */
const PAGE_SIZE = 10;

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

/** Voiding, from the row menu. Ringing one up is the POS. */
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
  date: string;
  time: string;
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
    date: formatAccraDate(sale.createdAt),
    // The full stamp reads `25 Aug 2026, 1:32 pm`; the date has its own line.
    time: formatAccraDateTime(sale.createdAt).split(", ")[1] ?? "",
  };
}

/**
 * The day book, drawn as the ledger and the customer's statement are drawn.
 *
 * A sale is a money event like any other, so it gets the same table: the same
 * toolbar strip, the same KPI cards over it, the same ⋯ menu on every row and
 * the same ten-row footer. What is particular to a sale is the basket — units
 * against lines — and the void, which is the one thing here that changes a
 * record and so is the one thing behind a confirmation.
 *
 * The search and the paging are the API's, not the table's: this endpoint
 * searches server-side and pages server-side, so both go through the URL and
 * come back as a new page of rows.
 */
export default function Sales({ loaderData }: Route.ComponentProps) {
  const { filters, page, total, totals, counts, rows } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const fetcher = useFetcher<ActionResult>();
  const { search } = useLocation();

  // The sale being voided, and the reason given for it. Held here rather than
  // per row: one dialog over the table, opened by whichever menu asked for it.
  const [voiding, setVoiding] = useState<Row | null>(null);
  const [reason, setReason] = useState("");

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

  const goToPage = (next: number) =>
    submit(queryFor(filters, next), { replace: true, preventScrollReset: true });

  const tabs: TableTab[] = TABS.map((t) => ({
    value: t.key,
    label: t.label,
    count: counts[t.key],
  }));

  const narrowed = Boolean(
    filters.search || filters.walkInOnly || filters.from || filters.to,
  );

  const columns: Column<Row>[] = [
    {
      key: "date",
      header: "Sold",
      className: "whitespace-nowrap text-muted-foreground",
      cell: (row) => (
        <>
          <p>{row.date}</p>
          <p className="text-xs">{row.time}</p>
        </>
      ),
    },
    {
      key: "receipt",
      header: "Receipt",
      cell: (row) => (
        <Link
          to={`/sales/${row.id}${search}`}
          prefetch="intent"
          className="tabular font-medium underline-offset-4 hover:underline"
        >
          {row.receiptNo}
        </Link>
      ),
    },
    {
      key: "buyer",
      header: "Buyer",
      cell: (row) => <Buyer row={row} />,
    },
    {
      key: "basket",
      header: "Items",
      align: "end",
      className: "tabular hidden md:table-cell",
      // Units is the figure that matters at the counter; the line count only
      // earns its place when a basket holds more of one thing than of another.
      cell: (row) => (
        <>
          {formatCount(row.units)}
          {row.items !== row.units && (
            <span className="ml-1 text-xs text-muted-foreground">
              /{formatCount(row.items)} line{row.items === 1 ? "" : "s"}
            </span>
          )}
        </>
      ),
    },
    {
      key: "channel",
      header: "Channel",
      className: "hidden text-muted-foreground lg:table-cell",
      cell: (row) => row.channel,
    },
    {
      key: "total",
      header: "Total · GH₵",
      align: "end",
      cell: (row) => <Total row={row} />,
    },
    {
      key: "discount",
      header: "Discount",
      align: "end",
      className: "tabular hidden md:table-cell",
      // What came off for haggling. A dash means the sale went at shelf prices,
      // not that the figure is unknown.
      cell: (row) =>
        row.discount > 0 ? (
          <span className="font-medium text-warning">
            −{formatPesewas(row.discount)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusPill
          label={SALE_STATUS_LABELS[row.status]}
          blurb={row.voidReason || SALE_STATUS_BLURBS[row.status]}
          tone={SALE_STATUS_TONE[row.status]}
        />
      ),
    },
  ];

  return (
    <Page className="max-w-none">
      <TotalsBand totals={totals} voided={counts.voided} />

      <DataTable
        actions={
          <>
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
              query={queryFor(filters).toString()}
              total={total}
              noun="sale"
            />
            <Button asChild size="sm">
              <Link to="/pos" prefetch="intent">
                <ShoppingCartIcon />
                New sale
              </Link>
            </Button>
          </>
        }
        tabs={tabs}
        activeTab={filters.status}
        onTabChange={(value) => apply({ status: value as Tab })}
        tabsLabel="Filter sales by status"
        // This endpoint searches server-side, so the term goes through the URL
        // rather than sifting the ten rows in hand. `SearchBox` owns the
        // debounce and keeps working as a plain GET without JavaScript, which
        // is why it replaces the table's own box rather than sitting beside it.
        searchSlot={
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
        }
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        paging={{ page, pageSize: PAGE_SIZE, total, onPageChange: goToPage }}
        loading={busy}
        rowActions={(row) => (
          <>
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
                setVoiding(row);
              }}
            >
              <XCircleIcon />
              Void this sale
            </DropdownMenuItem>
          </>
        )}
        noun={{ one: "sale", many: "sales" }}
        pageSize={PAGE_SIZE}
        empty={
          narrowed
            ? "Nothing matches these filters. Widen them, or clear them to see every sale."
            : filters.status === "voided"
              ? "Nothing has been voided."
              : "Nothing sold over the counter yet. Ring one up at the POS and it appears here with its receipt number."
        }
      />

      <AlertDialog
        open={voiding !== null}
        onOpenChange={(open) => !open && setVoiding(null)}
      >
        <AlertDialogContent>
          {voiding && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Void receipt {voiding.receiptNo}?</AlertDialogTitle>
                <AlertDialogDescription>
                  The {formatCount(voiding.units)} unit
                  {voiding.units === 1 ? "" : "s"} go back on the shelf and the{" "}
                  {formatPesewas(voiding.total)} stops counting toward revenue. The
                  sale itself stays on the record, stamped with your name and this
                  reason. There is no undo.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-1.5">
                <Label htmlFor="void-reason" className="eyebrow text-muted-foreground">
                  Why<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Input
                  id="void-reason"
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
                    const id = voiding.id;
                    setVoiding(null);
                    fetcher.submit({ id, reason: reason.trim() }, { method: "post" });
                  }}
                >
                  Void the sale
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

/* ------------------------------------------------------------------ totals --- */

/**
 * What the filter came to, as the four KPI cards the dashboard and the ledger
 * open with. The API's figures cover the **whole filter** rather than the page
 * on screen and always leave voided sales out, so a page of ten rows can sit
 * under a total covering four hundred — which is why each card says what it is
 * counting rather than leaving it to be inferred from figures that will not add
 * up to the rows.
 */
function TotalsBand({
  totals,
  voided,
}: {
  totals: { salesCount: number; revenue: number; profit: number };
  voided: number;
}) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat
        label="Sales"
        value={formatCount(totals.salesCount)}
        note="Completed, across every page"
        icon={ReceiptIcon}
        tone="neutral"
      />
      <Stat
        label="Revenue"
        value={formatPesewas(totals.revenue)}
        note="Taken at the till. Voided sales excluded."
        icon={BanknoteIcon}
        tone="in"
      />
      <Stat
        label="Profit"
        value={formatPesewas(totals.profit)}
        note="Margin over cost — an office figure, never on a receipt."
        icon={CoinsIcon}
        tone="revenue"
      />
      <Stat
        label="Voided"
        value={formatCount(voided)}
        note="Reversed after the fact. Stock went back on the shelf."
        icon={XCircleIcon}
        tone="out"
      />
    </div>
  );
}

/** The dashboard's KPI tile, with the ledger's own colours in the square. */
function Stat({
  label,
  value,
  note,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof ReceiptIcon;
  tone: "in" | "out" | "revenue" | "neutral";
}) {
  return (
    <div className="relative rounded-2xl bg-card p-4">
      <span
        aria-hidden
        className={cn(
          "absolute top-3.5 right-3.5 rounded-lg p-2",
          tone === "in" && "bg-cash-in-subtle",
          tone === "out" && "bg-cash-out-subtle",
          tone === "revenue" && "bg-revenue-subtle",
          tone === "neutral" && "bg-internal-subtle",
        )}
      >
        <Icon
          className={cn(
            "size-4",
            tone === "in" && "text-cash-in",
            tone === "out" && "text-cash-out",
            tone === "revenue" && "text-revenue-foreground",
            tone === "neutral" && "text-internal",
          )}
        />
      </span>
      {/* Keyed so a change of filter re-enters the number instead of snapping,
          exactly as the dashboard's own cards do. */}
      <p
        key={value}
        className={cn(
          "tabular animate-in fade-in slide-in-from-bottom-1 pr-10 text-[22px] font-bold tracking-tight duration-300 motion-reduce:animate-none",
          tone === "in" && "text-cash-in",
          tone === "revenue" && "text-revenue-foreground",
          tone === "out" && "text-muted-foreground",
          tone === "neutral" && "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs font-medium">{label}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}

/* ------------------------------------------------------------------- cells --- */

/**
 * Who bought it. A walk-in is the case this module exists to allow — a name and
 * nothing else — so the row says which kind of buyer it was rather than leaving
 * a blank where a customer link would be.
 */
function Buyer({ row }: { row: Row }) {
  return (
    <div className="min-w-0">
      {row.customerId ? (
        <Link
          to={`/customers/${row.customerId}`}
          className="block truncate font-medium underline-offset-4 hover:underline"
        >
          {row.buyerName}
        </Link>
      ) : (
        <p className="truncate font-medium">{row.buyerName}</p>
      )}
      <p className="truncate text-xs text-muted-foreground">
        {row.walkIn ? "Walk-in" : "Registered"}
        {row.buyerPhone ? ` · ${row.buyerPhone}` : ""}
        {/* The channel has its own column from `lg` up; narrower than that it
            rides here rather than dropping off the screen. */}
        <span className="lg:hidden"> · {row.channel}</span>
      </p>
    </div>
  );
}

/** What was paid, struck through once the sale is reversed. */
function Total({ row }: { row: Row }) {
  const voided = row.status === "voided";

  return (
    <>
      <p
        className={cn(
          "tabular font-medium",
          voided && "text-muted-foreground line-through",
        )}
      >
        {formatPesewas(row.total)}
      </p>
      {/* The basket and the discount have columns from `md` up; below that they
          ride under the total instead of disappearing. */}
      <p className="tabular text-xs text-muted-foreground md:hidden">
        {formatCount(row.units)} unit{row.units === 1 ? "" : "s"}
        {row.discount > 0 && (
          <span className="text-warning"> · −{formatPesewas(row.discount)}</span>
        )}
      </p>
    </>
  );
}
