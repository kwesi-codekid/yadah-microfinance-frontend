import {
  BoxesIcon,
  EyeIcon,
  EyeOffIcon,
  MoreHorizontalIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  ReceiptTextIcon,
  ScalingIcon,
  Trash2Icon,
  UploadIcon,
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

import { ApiError } from "~/api/error";
import { allLabels, listItems, trashItem } from "~/api/hire-purchase";
import {
  ChoiceFilter,
  ExportMenu,
  FilterBar,
  FilterChip,
  FilterMenu,
  ListingCard,
  ListingFooter,
  ListingToolbar,
  SearchBox,
  StatusPill,
  Th,
} from "~/components/listing";
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
import { formatCount, formatPesewas } from "~/lib/format";
import {
  CONDITION_LABELS,
  ITEM_STATUS_LABELS,
  depositFor,
  isSellable,
  marginOf,
  marginPercent,
  type HpItem,
  type ItemStatus,
} from "~/lib/hire-purchase";
import { isOffice } from "~/lib/auth";
import { requireCounter, requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/inventory";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Inventory · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = {
  title: "Inventory",
};

const PAGE_SIZE = 20;

const STATUSES: ItemStatus[] = ["active", "discontinued"];

const TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "discontinued", label: "Discontinued" },
] as const;
type Tab = (typeof TABS)[number]["key"];

interface Filters {
  status: Tab;
  search: string;
  inStockOnly: boolean;
  /** A label id, or empty for every brand / category. */
  brandId: string;
  categoryId: string;
}

function readFilters(url: URL): Filters {
  const statusParam = url.searchParams.get("status") as ItemStatus | null;
  return {
    status: statusParam && STATUSES.includes(statusParam) ? statusParam : "all",
    search: url.searchParams.get("search")?.trim() ?? "",
    inStockOnly: url.searchParams.get("inStock") === "1",
    brandId: url.searchParams.get("brand")?.trim() ?? "",
    categoryId: url.searchParams.get("category")?.trim() ?? "",
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status !== "all") p.set("status", f.status);
  if (f.search) p.set("search", f.search);
  if (f.inStockOnly) p.set("inStock", "1");
  if (f.brandId) p.set("brand", f.brandId);
  if (f.categoryId) p.set("category", f.categoryId);
  if (page > 1) p.set("page", String(page));
  return p;
}

function hrefFor(f: Filters, page = 1): string {
  const s = queryFor(f, page).toString();
  return s ? `/inventory?${s}` : "/inventory";
}

/**
 * `GET /hire-purchase/items` — the shelf. The counter keeps it; only taking an
 * item out of the listings stays with the office.
 *
 * Stock is what decides whether an agreement can be signed at all, so the count
 * is a column rather than something to go looking for, and "in stock only" is
 * one press away.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireCounter(request);
  const url = new URL(request.url);

  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const scope = {
      search: filters.search || undefined,
      inStockOnly: filters.inStockOnly || undefined,
      brandId: filters.brandId || undefined,
      categoryId: filters.categoryId || undefined,
    };
    const [list, brands, categories, ...counts] = await Promise.all([
      listItems(token, {
        ...scope,
        page,
        limit: PAGE_SIZE,
        status: filters.status === "all" ? undefined : filters.status,
      }),
      allLabels(token, "brand"),
      allLabels(token, "category"),
      ...STATUSES.map((status) =>
        listItems(token, { ...scope, page: 1, limit: 1, status }),
      ),
    ]);
    return { list, brands, categories, counts };
  });

  const byStatus = Object.fromEntries(
    STATUSES.map((s, i) => [s, result.counts[i].total]),
  ) as Record<ItemStatus, number>;

  return data(
    {
      canTrash: isOffice(viewer),
      filters,
      // The two pickers' options, and the names behind an applied filter.
      brands: result.brands.map((b) => ({ value: b.id, label: b.name })),
      categories: result.categories.map((c) => ({ value: c.id, label: c.name })),
      page,
      total: result.list.total,
      counts: {
        all: STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
        ...byStatus,
      },
      rows: result.list.items.map(toRow),
    },
    { headers },
  );
}

/** Opening a drawer does not re-read the shelf underneath it. */
export const shouldRevalidate = drawerParentShouldRevalidate;

interface ActionResult {
  ok: boolean;
  message: string;
}

/** Trashing an item, from the row menu. Everything else is a drawer. */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  if (!id) return data<ActionResult>({ ok: false, message: "No item." }, { status: 400 });

  try {
    const { data: _result, headers } = await withAuth(request, (token) =>
      trashItem(token, id),
    );
    return data<ActionResult>(
      { ok: true, message: "Item moved to the trash." },
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
  /** Brand, category and condition, joined for the line under the name. */
  detail: string;
  description: string;
  condition: string;
  quantityInStock: number;
  costPrice: number;
  sellingPrice: number;
  deposit: number;
  margin: number;
  marginPct: number | null;
  status: ItemStatus;
  sellable: boolean;
}

function toRow(item: HpItem): Row {
  return {
    id: item.id,
    name: item.name,
    detail: [item.brand?.name, item.category?.name, item.condition === "used" ? "Used" : ""]
      .filter(Boolean)
      .join(" · "),
    description: item.description ?? "",
    condition: CONDITION_LABELS[item.condition],
    quantityInStock: item.quantityInStock,
    costPrice: item.costPrice,
    sellingPrice: item.sellingPrice,
    deposit: depositFor(item.sellingPrice),
    margin: marginOf(item),
    marginPct: marginPercent(item),
    status: item.status,
    sellable: isSellable(item),
  };
}

export default function Inventory({ loaderData }: Route.ComponentProps) {
  const { canTrash, filters, brands, categories, page, total, counts, rows } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const { search } = useLocation();

  /**
   * Cost and margin are office figures and a customer must never see them.
   * Kept in component state rather than the URL on purpose: the shelf comes up
   * covered on every visit and on every reload, and a link someone pastes into
   * a chat cannot carry the reveal with it.
   */
  const [showCost, setShowCost] = useState(false);

  const busy =
    navigation.state === "loading" && navigation.location?.pathname === "/inventory";

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), {
      replace: true,
      preventScrollReset: true,
    });

  const narrowed = Boolean(
    filters.search || filters.inStockOnly || filters.brandId || filters.categoryId,
  );

  const railItems = TABS.map((t) => ({
    key: t.key,
    label: t.label,
    count: counts[t.key],
    to: hrefFor({ ...filters, status: t.key as Tab }),
  }));

  return (
    <Page className="max-w-none">
      <ListingCard>
        <ListingToolbar
          tabs={<FilterMenu label="Status" items={railItems} active={filters.status} />}
        >
          <SearchBox
            value={filters.search}
            apply={(next) => apply({ search: next })}
            hidden={{
              status: filters.status === "all" ? "" : filters.status,
              inStock: filters.inStockOnly ? "1" : "",
              brand: filters.brandId,
              category: filters.categoryId,
            }}
            placeholder="Search item, brand or category"
            label="Search inventory"
            busy={busy}
          />
          <ChoiceFilter
            value={filters.categoryId}
            options={categories}
            apply={(next) => apply({ categoryId: next })}
            title="Category"
            allLabel="Every category"
          />
          <ChoiceFilter
            value={filters.brandId}
            options={brands}
            apply={(next) => apply({ brandId: next })}
            title="Brand"
            allLabel="Every brand"
          />
          <Button
            variant="outline"
            size="sm"
            aria-pressed={filters.inStockOnly}
            onClick={() => apply({ inStockOnly: !filters.inStockOnly })}
            className={cn(filters.inStockOnly && "border-primary/50 text-primary")}
          >
            <BoxesIcon />
            In stock only
          </Button>
          {/* The reveal, and the reason for it, in one control. */}
          <Button
            variant="outline"
            size="sm"
            aria-pressed={showCost}
            onClick={() => setShowCost((current) => !current)}
            title="Cost and margin are office figures. Never show them to a customer."
          >
            {showCost ? <EyeOffIcon /> : <EyeIcon />}
            {showCost ? "Hide cost" : "Show cost"}
          </Button>
          <ExportMenu
            path="/inventory/export"
            query={(() => {
              const p = queryFor(filters);
              p.delete("page");
              return p.toString();
            })()}
            total={total}
            noun="item"
          />
          <Button asChild size="sm" variant="outline">
            <Link to="/inventory/import">
              <UploadIcon />
              Import
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to={`/inventory/new${search}`} prefetch="intent" preventScrollReset>
              <PlusIcon />
              Add item
            </Link>
          </Button>
        </ListingToolbar>

        {narrowed && (
          <FilterBar total={total}>
            {filters.search && (
              <FilterChip
                onDrop={() => apply({ search: "" })}
                label={`“${filters.search}”`}
              />
            )}
            {filters.inStockOnly && (
              <FilterChip
                onDrop={() => apply({ inStockOnly: false })}
                label="In stock only"
              />
            )}
            {filters.categoryId && (
              <FilterChip
                onDrop={() => apply({ categoryId: "" })}
                label={categories.find((c) => c.value === filters.categoryId)?.label ?? "Category"}
              />
            )}
            {filters.brandId && (
              <FilterChip
                onDrop={() => apply({ brandId: "" })}
                label={brands.find((b) => b.value === filters.brandId)?.label ?? "Brand"}
              />
            )}
          </FilterBar>
        )}

        {showCost && (
          <p className="flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-xs text-warning">
            <EyeIcon className="size-3.5 shrink-0" />
            Cost and margin are showing. These are Yadah&rsquo;s figures — turn
            the screen away from the customer.
          </p>
        )}

        {rows.length === 0 ? (
          <InventoryEmpty filters={filters} narrowed={narrowed} />
        ) : (
          <div className={cn("transition-opacity", busy && "opacity-60")}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Item</Th>
                  <Th className="hidden text-right sm:table-cell">In stock</Th>
                  <Th className="text-right">Selling price</Th>
                  <Th className="hidden text-right lg:table-cell">Deposit</Th>
                  {showCost && (
                    <>
                      <Th className="text-right">Cost</Th>
                      <Th className="text-right">Margin</Th>
                    </>
                  )}
                  <Th>Status</Th>
                  <Th className="w-12 text-right">Actions</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <ItemRow key={row.id} row={row} showCost={showCost} canTrash={canTrash} />
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

      {/* Add, edit and adjust-stock render here, over the shelf. */}
      <Outlet />
    </Page>
  );
}

function ItemRow({
  row,
  showCost,
  canTrash,
}: {
  row: Row;
  showCost: boolean;
  /** Taking an item off the listings is the office's, not the counter's. */
  canTrash: boolean;
}) {
  const fetcher = useFetcher<ActionResult>();
  const [confirmTrash, setConfirmTrash] = useState(false);

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) toast.success(fetcher.data.message);
    else toast.error(fetcher.data.message);
  }, [fetcher.data]);

  const empty = row.quantityInStock <= 0;

  return (
    <>
      <TableRow className="group">
        <TableCell className="px-4 py-3">
          <p className="truncate font-medium text-foreground">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[row.detail, row.description].filter(Boolean).join(" · ") || row.condition}
          </p>
        </TableCell>

        <TableCell
          className={cn(
            "tabular hidden px-4 py-3 text-right font-medium whitespace-nowrap sm:table-cell",
            empty && "text-muted-foreground",
          )}
        >
          {empty ? "Out of stock" : formatCount(row.quantityInStock)}
        </TableCell>

        <TableCell className="tabular px-4 py-3 text-right font-medium whitespace-nowrap">
          {formatPesewas(row.sellingPrice)}
        </TableCell>

        {/* Half the selling price, to the pesewa, and the figure the counter is
            actually asked for first. Derived rather than looked up. */}
        <TableCell className="tabular hidden px-4 py-3 text-right whitespace-nowrap text-muted-foreground lg:table-cell">
          {formatPesewas(row.deposit)}
        </TableCell>

        {showCost && (
          <>
            <TableCell className="tabular px-4 py-3 text-right whitespace-nowrap text-muted-foreground">
              {formatPesewas(row.costPrice)}
            </TableCell>
            <TableCell className="tabular px-4 py-3 text-right whitespace-nowrap">
              <span
                className={cn(
                  "font-medium",
                  row.margin > 0 ? "text-revenue-foreground" : "text-muted-foreground",
                )}
              >
                {formatPesewas(row.margin)}
              </span>
              {row.marginPct !== null && (
                <p className="text-xs text-muted-foreground">{row.marginPct}%</p>
              )}
            </TableCell>
          </>
        )}

        <TableCell className="px-4 py-3">
          <StatusPill
            label={ITEM_STATUS_LABELS[row.status]}
            blurb={
              row.status === "active"
                ? "Can back a new agreement while there is stock."
                : "Kept for the agreements that reference it, but not sold."
            }
            tone={row.sellable ? "success" : "muted"}
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
                <span className="sr-only">Actions for {row.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem asChild disabled={!row.sellable}>
                <Link to={`/hire-purchase/new?itemId=${row.id}`} prefetch="intent">
                  <ReceiptTextIcon />
                  Sign an agreement
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to={`/inventory/${row.id}/edit`} prefetch="intent">
                  <PencilIcon />
                  Edit item
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`/inventory/${row.id}/stock`} prefetch="intent">
                  <ScalingIcon />
                  Adjust stock
                </Link>
              </DropdownMenuItem>
              {canTrash && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={(event) => {
                      event.preventDefault();
                      setConfirmTrash(true);
                    }}
                  >
                    <Trash2Icon />
                    Move to trash
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>

      <AlertDialog open={confirmTrash} onOpenChange={setConfirmTrash}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move {row.name} to the trash?</AlertDialogTitle>
            <AlertDialogDescription>
              Only an item no agreement has used can be trashed. It can be
              restored from Trash.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => fetcher.submit({ id: row.id }, { method: "post" })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function InventoryEmpty({
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
          <PackageIcon className="size-6" />
        </EmptyMedia>
        <EmptyTitle>
          {narrowed
            ? "No matches"
            : filters.status === "all"
              ? "Nothing on the shelf"
              : `Nothing ${filters.status}`}
        </EmptyTitle>
        <EmptyDescription>
          {filters.search
            ? `Nothing matched “${filters.search}”.`
            : filters.inStockOnly
              ? "Every item is out of stock. Adjust a stock count or add something new."
              : "Add an item and it can be sold on hire purchase."}
        </EmptyDescription>
      </EmptyHeader>
      {narrowed ? (
        <Button asChild variant="outline" size="sm">
          <Link
            to={hrefFor({ ...filters, search: "", inStockOnly: false, brandId: "", categoryId: "" })}
          >
            Clear filters
          </Link>
        </Button>
      ) : filters.status === "all" ? (
        <Button asChild size="sm">
          <Link to="/inventory/new">
            <PlusIcon />
            Add item
          </Link>
        </Button>
      ) : null}
    </Empty>
  );
}
