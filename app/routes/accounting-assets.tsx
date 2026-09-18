import {
  ArchiveIcon,
  PackageIcon,
  PlusIcon,
  TagIcon,
  WalletIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
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

import { disposeAsset, listAssets, listCashAccounts } from "~/api/accounting";
import { ApiError } from "~/api/error";
import { AsOfFilter, ChoiceFilter, ExportMenu, Figure, StatusPill } from "~/components/listing";
import { Page } from "~/components/page";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
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
import { DataTable, type Column, type TableTab } from "~/components/ui/data-table";
import { DateField } from "~/components/ui/date-field";
import { DropdownMenuItem } from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  ASSET_CATEGORY_OPTIONS,
  ASSET_STATUS_BLURBS,
  ASSET_STATUS_LABELS,
  ASSET_STATUS_TONE,
  ASSET_STATUSES,
  canDispose,
  monthlyDepreciation,
  netBookValueAt,
  type AssetCategory,
  type AssetStatus,
  type FixedAsset,
} from "~/lib/accounting";
import { accraDay, formatAccraDate, formatCount, formatDayRange, formatPesewas, parseCedis } from "~/lib/format";
import { requireAdmin, requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/accounting-assets";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Fixed assets · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = {
  title: "Fixed assets",
};

const PAGE_SIZE = 10;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "In use" },
  { key: "disposed", label: "Disposed" },
] as const;
type Tab = (typeof TABS)[number]["key"];

interface Filters {
  status: Tab;
  category: AssetCategory | "";
  /** The day depreciation is read as at. Empty means today. */
  asOf: string;
}

function readFilters(url: URL): Filters {
  const status = url.searchParams.get("status") as AssetStatus | null;
  const category = url.searchParams.get("category") as AssetCategory | null;
  const asOf = url.searchParams.get("asOf") ?? "";
  return {
    status: status && ASSET_STATUSES.includes(status) ? status : "all",
    category: category && ASSET_CATEGORIES.includes(category) ? category : "",
    asOf: DAY_RE.test(asOf) ? asOf : "",
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status !== "all") p.set("status", f.status);
  if (f.category) p.set("category", f.category);
  if (f.asOf) p.set("asOf", f.asOf);
  if (page > 1) p.set("page", String(page));
  return p;
}

/**
 * `GET /accounting/fixed-assets` — the register, depreciated as at a day.
 *
 * Depreciation is computed from cost, salvage and useful life rather than
 * posted monthly, so asking for a past `asOf` gives the register exactly as it
 * stood that day. The tab counts are one one-row request per status, scoped by
 * the same filters as the rows.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireOffice(request);
  const url = new URL(request.url);
  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const scope = { category: filters.category || undefined, asOf: filters.asOf || undefined };
    const [list, accounts, ...counts] = await Promise.all([
      listAssets(token, {
        ...scope,
        page,
        limit: PAGE_SIZE,
        status: filters.status === "all" ? undefined : filters.status,
      }),
      listCashAccounts(token),
      ...ASSET_STATUSES.map((status) =>
        listAssets(token, { ...scope, page: 1, limit: 1, status }),
      ),
    ]);
    return { list, accounts, counts };
  });

  const byStatus = Object.fromEntries(
    ASSET_STATUSES.map((s, i) => [s, result.counts[i].total]),
  ) as Record<AssetStatus, number>;

  const asOf = result.list.asOf ?? filters.asOf ?? "";
  const rows = result.list.items.map((asset) => toRow(asset, asOf || accraDay()));

  return data(
    {
      isAdmin: user.role === "admin",
      filters,
      asOf,
      page,
      total: result.list.total,
      counts: {
        all: ASSET_STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
        ...byStatus,
      },
      rows,
      // The page's own figures: this page only, and the screen says so.
      pageCost: rows.reduce((sum, r) => sum + r.cost, 0),
      pageBook: rows.reduce((sum, r) => sum + (r.status === "active" ? r.netBookValue : 0), 0),
      pageMonthly: rows.reduce((sum, r) => sum + (r.status === "active" ? r.monthly : 0), 0),
      accounts: result.accounts
        .filter((a) => (a.status ?? "active") === "active")
        .map((a) => ({ id: a.id, name: a.name })),
    },
    { headers },
  );
}

/** Opening the register drawer does not re-read the register underneath it. */
export const shouldRevalidate = drawerParentShouldRevalidate;

interface ActionResult {
  ok: boolean;
  message: string;
}

/** Disposal, from the row menu. Admin only, like registering. */
export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const disposedOn = String(form.get("disposedOn") ?? "").trim();
  const proceeds = String(form.get("disposalProceeds") ?? "").trim();
  const cashAccountId = String(form.get("cashAccountId") ?? "").trim();
  const note = String(form.get("note") ?? "").trim();

  if (!id) {
    return data<ActionResult>({ ok: false, message: "No asset." }, { status: 400 });
  }
  if (disposedOn && !DAY_RE.test(disposedOn)) {
    return data<ActionResult>({ ok: false, message: "Pick a valid day." }, { status: 400 });
  }
  const disposalProceeds = proceeds ? parseCedis(proceeds) : 0;
  if (disposalProceeds == null || disposalProceeds < 0) {
    return data<ActionResult>(
      { ok: false, message: "Proceeds have to be a cedi amount, or blank." },
      { status: 400 },
    );
  }
  if (disposalProceeds > 0 && !cashAccountId) {
    return data<ActionResult>(
      { ok: false, message: "Name the account the proceeds went into." },
      { status: 400 },
    );
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      disposeAsset(token, id, {
        disposedOn: disposedOn || undefined,
        disposalProceeds,
        cashAccountId: cashAccountId || undefined,
        note: note || undefined,
      }),
    );
    return data<ActionResult>(
      {
        ok: true,
        message: `${result.asset.name} disposed of.${
          disposalProceeds > 0
            ? ` ${formatPesewas(disposalProceeds)} came back in.`
            : " It is off the balance sheet from that day."
        }`,
      },
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
  name: string;
  category: AssetCategory;
  categoryLabel: string;
  serial: string;
  assignedTo: string;
  cost: number;
  acquiredOn: string;
  life: number;
  salvage: number;
  monthly: number;
  depreciated: number;
  netBookValue: number;
  status: AssetStatus;
  disposedOn: string;
  proceeds: number;
  disposable: boolean;
}

function toRow(a: FixedAsset, asOf: string): Row {
  const salvage = a.salvageValue ?? 0;
  const monthly = a.monthlyDepreciation ?? monthlyDepreciation({ ...a, salvageValue: salvage });
  const nbv = a.netBookValue ?? netBookValueAt({ ...a, salvageValue: salvage }, asOf);
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    categoryLabel: ASSET_CATEGORY_LABELS[a.category] ?? a.category,
    serial: a.serialNumber ?? "",
    assignedTo: a.assignedToName ?? "",
    cost: a.cost,
    acquiredOn: a.acquiredOn ? formatAccraDate(`${a.acquiredOn}T12:00:00Z`) : "",
    life: a.usefulLifeMonths,
    salvage,
    monthly,
    depreciated: a.accumulatedDepreciation ?? Math.max(0, a.cost - nbv),
    netBookValue: nbv,
    status: a.status,
    disposedOn: a.disposedOn ? formatAccraDate(`${a.disposedOn}T12:00:00Z`) : "",
    proceeds: a.disposalProceeds ?? 0,
    disposable: canDispose(a),
  };
}

/* -------------------------------------------------------------------- page --- */

export default function AccountingAssets({ loaderData }: Route.ComponentProps) {
  const {
    isAdmin,
    filters,
    asOf,
    page,
    total,
    counts,
    rows,
    pageCost,
    pageBook,
    pageMonthly,
    accounts,
  } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const fetcher = useFetcher<ActionResult>();
  const { search } = useLocation();

  const [disposing, setDisposing] = useState<Row | null>(null);
  const [proceeds, setProceeds] = useState("");
  const [into, setInto] = useState(accounts[0]?.id ?? "");

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) toast.success(fetcher.data.message);
    else toast.error(fetcher.data.message);
  }, [fetcher.data]);

  const busy =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/accounting/assets";

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), { replace: true, preventScrollReset: true });

  const goToPage = (next: number) =>
    submit(queryFor(filters, next), { replace: true, preventScrollReset: true });

  const tabs: TableTab[] = TABS.map((t) => ({
    value: t.key,
    label: t.label,
    count: counts[t.key],
  }));

  const narrowed = Boolean(filters.category || filters.asOf);

  const columns: Column<Row>[] = [
    {
      key: "asset",
      header: "Asset",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.categoryLabel}
            {row.serial ? ` · ${row.serial}` : ""}
            {row.assignedTo ? ` · ${row.assignedTo}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "acquired",
      header: "Acquired",
      className: "hidden whitespace-nowrap text-muted-foreground md:table-cell",
      cell: (row) => (
        <>
          <p>{row.acquiredOn}</p>
          <p className="text-xs">
            {formatCount(row.life)} month{row.life === 1 ? "" : "s"}
          </p>
        </>
      ),
    },
    {
      key: "cost",
      header: "Cost · GH₵",
      align: "end",
      className: "tabular hidden lg:table-cell",
      cell: (row) => (
        <>
          <p>{formatPesewas(row.cost)}</p>
          {row.salvage > 0 && (
            <p className="text-xs text-muted-foreground">salvage {formatPesewas(row.salvage)}</p>
          )}
        </>
      ),
    },
    {
      key: "depreciation",
      header: "Depreciated",
      align: "end",
      className: "tabular hidden text-muted-foreground md:table-cell",
      cell: (row) =>
        row.status === "active" ? (
          <>
            <p>{formatPesewas(row.depreciated)}</p>
            <p className="text-xs">{formatPesewas(row.monthly)} / month</p>
          </>
        ) : (
          "—"
        ),
    },
    {
      key: "nbv",
      header: "Book value · GH₵",
      align: "end",
      cell: (row) =>
        row.status === "active" ? (
          <span className="tabular font-semibold">{formatPesewas(row.netBookValue)}</span>
        ) : (
          <span className="tabular text-muted-foreground">
            {row.proceeds > 0 ? `+${formatPesewas(row.proceeds)}` : "—"}
          </span>
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusPill
          label={ASSET_STATUS_LABELS[row.status]}
          blurb={
            row.status === "disposed" && row.disposedOn
              ? `Disposed of on ${row.disposedOn}.`
              : ASSET_STATUS_BLURBS[row.status]
          }
          tone={ASSET_STATUS_TONE[row.status]}
        />
      ),
    },
  ];

  return (
    <Page className="max-w-none">

      {/* This page's figures rather than the register's: the API gives no
          totals, so a total over four hundred rows would be a lie about ten. */}
      <dl className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Figure label="Cost, this page" value={formatPesewas(pageCost)} hint="What was paid for the rows shown" tone="muted" />
        <Figure label="Book value, this page" value={formatPesewas(pageBook)} hint="In-use rows, less depreciation to date" />
        <Figure
          label="Monthly depreciation"
          value={formatPesewas(pageMonthly)}
          hint="What these in-use rows take off profit each month"
          tone="warning"
          className="col-span-2 lg:col-span-1"
        />
      </dl>

      <DataTable
        actions={
          <>
            <ChoiceFilter
              value={filters.category}
              options={ASSET_CATEGORY_OPTIONS}
              apply={(next) => apply({ category: next })}
              title="Category"
              allLabel="Every category"
              icon={<TagIcon />}
              width="w-56"
            />
            <AsOfFilter
              value={filters.asOf}
              apply={(next) => apply({ asOf: next })}
              title="Read the register as at"
            />
            <ExportMenu
              path="/accounting/assets/export"
              query={queryFor(filters).toString()}
              total={total}
              noun="asset"
            />
            {isAdmin && (
              <Button asChild size="sm">
                <Link to={`/accounting/assets/new${search}`} prefetch="intent" preventScrollReset>
                  <PlusIcon />
                  Register an asset
                </Link>
              </Button>
            )}
          </>
        }
        tabs={tabs}
        activeTab={filters.status}
        onTabChange={(value) => apply({ status: value as Tab })}
        tabsLabel="Filter assets by status"
        searchPlaceholder="Name, serial or category"
        searchLabel="Search this page"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        paging={{ page, pageSize: PAGE_SIZE, total, onPageChange: goToPage }}
        loading={busy}
        rowActions={(row) => (
          <>
            <DropdownMenuItem
              disabled={!isAdmin || !row.disposable}
              onSelect={(event) => {
                event.preventDefault();
                setProceeds("");
                setInto(accounts[0]?.id ?? "");
                setDisposing(row);
              }}
            >
              <ArchiveIcon />
              {isAdmin ? "Dispose of it" : "Dispose of it (admin only)"}
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/accounting/balance-sheet">
                <WalletIcon />
                See it on the balance sheet
              </Link>
            </DropdownMenuItem>
          </>
        )}
        noun={{ one: "asset", many: "assets" }}
        pageSize={PAGE_SIZE}
        empty={
          narrowed
            ? "Nothing matches these filters. Widen them, or clear them to see the whole register."
            : filters.status === "disposed"
              ? "Nothing has been disposed of."
              : isAdmin
                ? "Nothing on the register yet. A motorbike or a computer is an asset, not an expense — register it here and only its depreciation reaches profit and loss."
                : "Nothing on the register yet. An admin registers assets."
        }
      />

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <PackageIcon className="size-3.5" />
        Depreciation is straight-line from cost to salvage over the useful life,
        computed as at {asOf ? formatDayRange(asOf, asOf) : "today"}. There is no
        monthly posting to miss.
      </p>

      <AlertDialog
        open={disposing !== null}
        onOpenChange={(open) => !open && setDisposing(null)}
      >
        <AlertDialogContent>
          {disposing && (
            <fetcher.Form method="post">
              <input type="hidden" name="id" value={disposing.id} />
              <AlertDialogHeader>
                <AlertDialogTitle>Dispose of {disposing.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  It leaves the balance sheet from this day, at a book value of{" "}
                  {formatPesewas(disposing.netBookValue)}.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="my-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="disposedOn" className="eyebrow text-muted-foreground">
                      On
                    </Label>
                    <DateField
                      id="disposedOn"
                      name="disposedOn"
                      defaultValue={accraDay()}
                      endMonth={new Date()}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="disposalProceeds" className="eyebrow text-muted-foreground">
                      Fetched · GH₵
                    </Label>
                    <Input
                      id="disposalProceeds"
                      name="disposalProceeds"
                      value={proceeds}
                      onChange={(event) => setProceeds(event.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
                      autoComplete="off"
                      className="tabular"
                    />
                  </div>
                </div>
                {(parseCedis(proceeds) ?? 0) > 0 && (
                  <div className="space-y-1.5">
                    <Label htmlFor="dispose-into" className="eyebrow text-muted-foreground">
                      Into<span className="ml-0.5 text-destructive">*</span>
                    </Label>
                    {accounts.length === 0 ? (
                      <p className="text-sm text-destructive">
                        No company account to receive it. Open one first.
                      </p>
                    ) : (
                      <Select name="cashAccountId" value={into} onValueChange={setInto}>
                        <SelectTrigger id="dispose-into" className="w-full">
                          <SelectValue placeholder="Select an account" />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="dispose-note" className="eyebrow text-muted-foreground">
                    Note
                  </Label>
                  <Textarea id="dispose-note" name="note" rows={2} maxLength={300} placeholder="Sold to a staff member" />
                </div>
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel type="button">Keep it</AlertDialogCancel>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={(parseCedis(proceeds) ?? 0) > 0 && !into}
                  onClick={() => setDisposing(null)}
                >
                  Dispose of it
                </Button>
              </AlertDialogFooter>
            </fetcher.Form>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* Registering renders here, over the register. */}
      <Outlet />
    </Page>
  );
}
