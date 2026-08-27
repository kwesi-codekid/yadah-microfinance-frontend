import {
  CameraIcon,
  Loader2Icon,
  MinusIcon,
  PackageIcon,
  PlusIcon,
  ScanBarcodeIcon,
  SearchIcon,
  ShoppingBagIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { listItems } from "~/api/hire-purchase";
import { createSale } from "~/api/sales";
import { CameraScanner } from "~/components/camera-scanner";
import {
  CustomerPicker,
  type PickedCustomer,
} from "~/components/customer-picker";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { formatPesewas, parseCedis, toCedisInput } from "~/lib/format";
import { useBarcodeWedge, type ScanState } from "~/hooks/use-barcode-wedge";
import { newIdempotencyKey } from "~/lib/idempotency";
import {
  CHANNEL_OPTIONS,
  basketDiscount,
  basketSubtotal,
  basketTotal,
  checkBasket,
  checkLine,
  lineTotal,
  linesForApi,
  type BasketLine,
  type SaleChannel,
} from "~/lib/sales";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/pos";

export function meta(_: Route.MetaArgs) {
  return [{ title: "POS · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page, and the line under it. */
export const handle = {
  title: "POS",
  description: "Ring up a counter sale: stock out, money in, receipt printed.",
};

/** What the picker needs to know about a thing on the shelf. */
interface Sellable {
  id: string;
  name: string;
  sellingPrice: number;
  available: number;
  condition: string;
  barcode?: string;
}

/**
 * The shelf, so the till can be worked without a round trip per line.
 *
 * Everything in stock is loaded up front rather than searched: a counter sale
 * is rung up with a customer standing there, and a picker that has to fetch on
 * every keystroke is the wrong shape for that. The list is capped — a shelf
 * beyond that is a different problem than this screen solves, and the note
 * under the picker says so rather than letting the tail vanish silently.
 */
const SHELF_LIMIT = 100;

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);

  const { data: result, headers } = await withAuth(request, (token) =>
    listItems(token, {
      status: "active",
      inStockOnly: true,
      page: 1,
      limit: SHELF_LIMIT,
    }),
  );

  return data(
    {
      items: result.items.map((item): Sellable => ({
        id: item.id,
        name: item.name,
        sellingPrice: item.sellingPrice,
        available: item.quantityInStock,
        condition: item.condition,
        barcode: item.barcode,
      })),
      truncated: result.total > result.items.length,
    },
    { headers },
  );
}

/**
 * `POST /hire-purchase/sales`.
 *
 * The basket arrives as one JSON field rather than a spray of indexed inputs:
 * lines are added and removed client-side, and re-deriving their order from
 * `line[3][quantity]` names would be a parser to get wrong for no gain.
 */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();

  const customerId = String(form.get("customerId") ?? "").trim();
  const buyerName = String(form.get("buyerName") ?? "")
    .trim()
    .toUpperCase();
  const buyerPhone = String(form.get("buyerPhone") ?? "").trim();
  const channel = String(form.get("channel") ?? "cash") as SaleChannel;
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");

  let lines: { itemId: string; quantity: number; unitPrice?: number }[];
  try {
    lines = JSON.parse(String(form.get("lines") ?? "[]"));
  } catch {
    return data(
      { error: "The basket did not come through. Try again." },
      { status: 400 },
    );
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    return data({ error: "Add something to the basket." }, { status: 400 });
  }
  if (!customerId && !buyerName) {
    return data(
      { error: "Name the buyer, or pick a registered customer." },
      { status: 400 },
    );
  }
  if (idempotencyKey.length < 8) {
    return data({ error: "Reload the page and try again." }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      createSale(token, {
        ...(customerId ? { customerId } : { buyerName }),
        ...(buyerPhone ? { buyerPhone } : {}),
        lines,
        channel,
        idempotencyKey,
      }),
    );

    await redirectWithToast(
      `/sales/${result.sale.id}`,
      {
        tone: "success",
        message: result.replayed
          ? `Already rung up — receipt ${result.sale.receiptNo}.`
          : `Receipt ${result.sale.receiptNo} · ${formatPesewas(result.sale.total)}.`,
        description: result.replayed
          ? "Nothing was sold twice."
          : "Print the receipt from here.",
      },
      headers,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status },
      );
    }
    throw error;
  }
}

/* -------------------------------------------------------------------- page --- */

type Shelf = "all" | "new" | "used";

export default function Pos({ loaderData }: Route.ComponentProps) {
  const { items, truncated } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [query, setQuery] = useState("");
  const [shelf, setShelf] = useState<Shelf>("all");
  const [walkIn, setWalkIn] = useState(true);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [channel, setChannel] = useState<SaleChannel>("cash");
  const [lines, setLines] = useState<BasketLine[]>([]);

  // One basket, one key. A retry after a dropped connection must not sell the
  // same stock twice. Re-minted after a "Clear order" so a fresh basket is a
  // fresh sale.
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    newIdempotencyKey(),
  );

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  /** Add one, or one more, of an item — the same move whether tapped or scanned. */
  const add = useCallback((item: Sellable) => {
    let bumped = false;
    setLines((current) => {
      const existing = current.find((l) => l.itemId === item.id);
      if (existing) {
        if (existing.quantity >= item.available) return current;
        bumped = true;
        return current.map((l) =>
          l.itemId === item.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...current,
        {
          itemId: item.id,
          name: item.name,
          listPrice: item.sellingPrice,
          available: item.available,
          quantity: 1,
          unitPrice: null,
        },
      ];
    });
    return bumped;
  }, []);

  const patch = (itemId: string, next: Partial<BasketLine>) =>
    setLines((current) =>
      current.map((l) => (l.itemId === itemId ? { ...l, ...next } : l)),
    );

  const drop = (itemId: string) =>
    setLines((current) => current.filter((l) => l.itemId !== itemId));

  const clear = () => {
    setLines([]);
    setIdempotencyKey(newIdempotencyKey());
  };

  // A scan is matched on the item's barcode first, then its id, then its
  // exact name — the last two so a label printed from Inventory still works
  // on a shelf that was never barcoded.
  const [camera, setCamera] = useState(false);
  const { state: scan, report } = useBarcodeWedge((code) => {
    const key = code.trim().toLowerCase();
    const item =
      items.find((i) => i.barcode && i.barcode.toLowerCase() === key) ??
      items.find((i) => i.id.toLowerCase() === key) ??
      items.find((i) => i.name.toLowerCase() === key);
    if (!item || item.available === 0) return false;
    add(item);
    return true;
  });

  const term = query.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (shelf === "all" || i.condition === shelf) &&
      (!term || i.name.toLowerCase().includes(term)),
  );
  const quantities = new Map(lines.map((l) => [l.itemId, l.quantity]));

  const subtotal = basketSubtotal(lines);
  const discount = basketDiscount(lines);
  const total = basketTotal(lines);
  const units = lines.reduce((n, l) => n + l.quantity, 0);

  const basketIssue = checkBasket(lines);
  const buyerIssue = walkIn
    ? buyerName.trim()
      ? null
      : "Name the buyer."
    : customer
      ? null
      : "Pick a customer.";
  const blocked = Boolean(basketIssue || buyerIssue) || submitting;

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* ------------------------------------------------------ the shelf --- */}
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 space-y-3 px-4 pt-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <ShelfTab active={shelf === "all"} onClick={() => setShelf("all")}>
              All items
            </ShelfTab>
            <ShelfTab active={shelf === "new"} onClick={() => setShelf("new")}>
              New
            </ShelfTab>
            <ShelfTab
              active={shelf === "used"}
              onClick={() => setShelf("used")}
            >
              Used
            </ShelfTab>

            <label className="ml-auto flex w-full items-center gap-2 rounded-full bg-card px-3.5 py-2 ring-1 ring-border focus-within:ring-2 focus-within:ring-ring/40 sm:w-64">
              <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the shelf"
                aria-label="Search the shelf"
                autoComplete="off"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </label>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            <li>
              <ScannerTile state={scan} onOpenCamera={() => setCamera(true)} />
            </li>
            {shown.map((item) => (
              <li key={item.id}>
                <ItemTile
                  item={item}
                  inBasket={quantities.get(item.id) ?? 0}
                  onAdd={() => add(item)}
                />
              </li>
            ))}
          </ul>

          {shown.length === 0 && (
            <div className="mt-10 text-center">
              <PackageIcon className="mx-auto size-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                {items.length === 0
                  ? "Nothing on the shelf. Add stock in Inventory."
                  : "Nothing matches. Try another name, or scan it."}
              </p>
            </div>
          )}

          {truncated && (
            <p className="mt-4 text-xs text-muted-foreground">
              Showing the first {SHELF_LIMIT} items — search, or scan, for the
              rest.
            </p>
          )}
        </div>
      </section>

      <CameraScanner
        open={camera}
        onOpenChange={setCamera}
        onScan={report}
        lastResult={
          scan.kind === "hit"
            ? { ok: true, text: "Added to the order." }
            : scan.kind === "miss"
              ? { ok: false, text: `No item for “${scan.code}”.` }
              : null
        }
      />

      {/* ------------------------------------------------------ the order --- */}
      <Form
        method="post"
        className="flex min-h-0 shrink-0 flex-col border-t border-border bg-card lg:h-full lg:w-[380px] lg:border-t-0 lg:border-l xl:w-[420px]"
      >
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input
          type="hidden"
          name="lines"
          value={JSON.stringify(linesForApi(lines))}
        />
        <input type="hidden" name="channel" value={channel} />

        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-5">
          <div>
            <h2 className="font-heading text-base font-bold tracking-tight">
              Current order
            </h2>
            <p className="tabular text-xs text-muted-foreground">
              {lines.length === 0
                ? "Tap an item or scan it to begin."
                : `${lines.length} ${lines.length === 1 ? "line" : "lines"} · ${units} ${units === 1 ? "unit" : "units"}`}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={clear}
            disabled={lines.length === 0}
            className="rounded-full"
          >
            Clear order
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {lines.length === 0 ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border text-center">
              <ShoppingBagIcon className="size-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                The basket is empty.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {lines.map((line) => (
                <OrderLine
                  key={line.itemId}
                  line={line}
                  onPatch={(next) => patch(line.itemId, next)}
                  onDrop={() => drop(line.itemId)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 space-y-4 border-t border-border px-5 py-4">
          {/* The buyer. A walk-in is the ordinary case at a counter. */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Buyer
              </span>
              <div className="inline-flex items-center gap-1 rounded-full bg-muted/70 p-0.5">
                <Half
                  active={walkIn}
                  onClick={() => {
                    setWalkIn(true);
                    setCustomer(null);
                  }}
                >
                  Walk-in
                </Half>
                <Half
                  active={!walkIn}
                  onClick={() => {
                    setWalkIn(false);
                    setBuyerName("");
                  }}
                >
                  Registered
                </Half>
              </div>
            </div>

            {walkIn ? (
              <div className="grid grid-cols-[1fr_130px] gap-2">
                <Input
                  name="buyerName"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value.toUpperCase())}
                  placeholder="BUYER'S NAME"
                  aria-label="Buyer's name"
                  maxLength={120}
                  autoComplete="off"
                />
                <Input
                  name="buyerPhone"
                  value={buyerPhone}
                  onChange={(e) => setBuyerPhone(e.target.value)}
                  placeholder="Phone"
                  aria-label="Buyer's phone"
                  inputMode="tel"
                  maxLength={20}
                  autoComplete="off"
                  className="tabular"
                />
              </div>
            ) : (
              <CustomerPicker value={customer} onChange={setCustomer} />
            )}
          </div>

          {/* How the money arrives. */}
          <div className="space-y-2.5">
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Paid by
            </span>
            <div className="grid grid-cols-3 gap-2">
              {CHANNEL_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setChannel(o.value)}
                  aria-pressed={channel === o.value}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
                    channel === o.value
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <dl className="space-y-1.5 rounded-xl bg-muted/50 px-4 py-3 text-sm">
            <Money label="Subtotal" value={subtotal} muted />
            {discount > 0 && (
              <Money label="Discount" value={-discount} tone="warning" />
            )}
            <div className="flex items-baseline justify-between border-t border-border pt-2">
              <dt className="font-medium">Total</dt>
              <dd className="tabular font-heading text-2xl font-bold tracking-tight">
                {formatPesewas(total)}
              </dd>
            </div>
          </dl>

          {(basketIssue || buyerIssue) && lines.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {buyerIssue ?? basketIssue}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full rounded-xl"
            disabled={blocked}
          >
            {submitting ? <Loader2Icon className="animate-spin" /> : null}
            Take payment
            {total > 0 && (
              <span className="tabular opacity-80">
                · {formatPesewas(total)}
              </span>
            )}
          </Button>
        </div>
      </Form>
    </div>
  );
}

/* ------------------------------------------------------------------- parts --- */

/**
 * The first tile on the shelf, and the one that is never tapped: it shows
 * that the scanner is live, and what the last scan did.
 */
function ScannerTile({
  state,
  onOpenCamera,
}: {
  state: ScanState;
  onOpenCamera: () => void;
}) {
  const hit = state.kind === "hit";
  const miss = state.kind === "miss";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "relative flex h-full min-h-[132px] flex-col justify-between overflow-hidden rounded-xl border-2 p-3 transition-colors",
        hit && "border-success bg-success-subtle",
        miss && "border-destructive bg-danger-subtle",
        !hit && !miss && "border-dashed border-foreground/30 bg-card",
      )}
    >
      <div className="flex items-center justify-between">
        <ScanBarcodeIcon
          className={cn(
            "size-5",
            hit
              ? "text-success"
              : miss
                ? "text-destructive"
                : "text-foreground",
          )}
        />
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              hit ? "bg-success" : miss ? "bg-destructive" : "bg-brand-coral",
              !hit && !miss && "motion-safe:animate-pulse",
            )}
          />
          {hit ? "Added" : miss ? "Not found" : "Live"}
        </span>
      </div>

      {/* The bar the scanner's red line sweeps across. */}
      <div aria-hidden className="relative my-2 h-9 overflow-hidden">
        <svg
          viewBox="0 0 120 36"
          className="h-full w-full text-foreground/70"
          preserveAspectRatio="none"
        >
          {[
            0, 5, 8, 14, 17, 23, 28, 31, 37, 42, 45, 51, 56, 59, 65, 70, 73, 79,
            84, 87, 93, 98, 101, 107, 112, 116,
          ].map((x, i) => (
            <rect
              key={x}
              x={x}
              y="0"
              width={i % 3 === 0 ? 3 : 1.5}
              height="36"
              fill="currentColor"
            />
          ))}
        </svg>
        {!hit && !miss && (
          <span className="pos-scanline absolute inset-x-0 top-0 h-px bg-brand-coral shadow-[0_0_6px_1px_var(--brand-coral)]" />
        )}
      </div>

      <p className="truncate text-xs font-semibold">
        {hit
          ? "Scanned and added"
          : miss
            ? `No item for “${state.code}”`
            : "Scan an item"}
      </p>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] text-muted-foreground">
          {miss
            ? "Check the label, or search by name."
            : "Ready whenever you are."}
        </p>
        <button
          type="button"
          onClick={onOpenCamera}
          className="flex shrink-0 items-center gap-1 rounded-full bg-foreground px-2 py-1 text-[11px] font-medium text-background transition-colors hover:bg-foreground/85 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <CameraIcon className="size-3" />
          Camera
        </button>
      </div>

      <style>{`
        @keyframes pos-scan { from { transform: translateY(0) } to { transform: translateY(35px) } }
        @media (prefers-reduced-motion: no-preference) {
          .pos-scanline { animation: pos-scan 1.6s ease-in-out infinite alternate; }
        }
      `}</style>
    </div>
  );
}

function ItemTile({
  item,
  inBasket,
  onAdd,
}: {
  item: Sellable;
  inBasket: number;
  onAdd: () => void;
}) {
  const soldOut = inBasket >= item.available;
  const low = item.available <= 3;

  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={soldOut}
      aria-label={`Add ${item.name}, ${formatPesewas(item.sellingPrice)}`}
      className={cn(
        "flex h-full min-h-[132px] w-full flex-col justify-between rounded-xl border bg-card p-3 text-left transition-[border-color,box-shadow,transform] focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
        inBasket > 0
          ? "border-foreground"
          : "border-border hover:border-foreground/40",
        soldOut ? "cursor-not-allowed opacity-50" : "active:scale-[0.98]",
      )}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm leading-snug font-semibold">
            {item.name}
          </p>
          {item.condition === "used" && (
            <span className="mt-1 inline-block rounded-full bg-warning-subtle px-1.5 py-0.5 text-[10px] font-medium text-warning">
              Used
            </span>
          )}
        </div>
        {inBasket > 0 && (
          <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-bold text-background">
            {inBasket}
          </span>
        )}
      </div>

      <div className="mt-3 flex w-full items-end justify-between gap-2">
        <p className="tabular text-base font-bold">
          {formatPesewas(item.sellingPrice)}
        </p>
        <p
          className={cn(
            "tabular text-[11px]",
            soldOut
              ? "text-destructive"
              : low
                ? "text-warning"
                : "text-muted-foreground",
          )}
        >
          {soldOut ? "None left" : `${item.available - inBasket} left`}
        </p>
      </div>
    </button>
  );
}

function OrderLine({
  line,
  onPatch,
  onDrop,
}: {
  line: BasketLine;
  onPatch: (next: Partial<BasketLine>) => void;
  onDrop: () => void;
}) {
  const [haggling, setHaggling] = useState(line.unitPrice != null);
  // Held as typed so a half-entered "12." does not snap back under the cursor.
  const [priceText, setPriceText] = useState(
    line.unitPrice == null ? "" : toCedisInput(line.unitPrice),
  );
  const issue = checkLine(line);
  const discounted = line.unitPrice != null && line.unitPrice < line.listPrice;

  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{line.name}</p>
          <p className="tabular text-xs text-muted-foreground">
            {formatPesewas(line.unitPrice ?? line.listPrice)} each
            {discounted && (
              <span className="ml-1 line-through">
                {formatPesewas(line.listPrice)}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Step
            label={`One less ${line.name}`}
            onClick={() =>
              line.quantity <= 1
                ? onDrop()
                : onPatch({ quantity: line.quantity - 1 })
            }
          >
            <MinusIcon className="size-3.5" />
          </Step>
          <span
            className={cn(
              "tabular w-7 text-center text-sm font-semibold",
              issue && "text-destructive",
            )}
          >
            {line.quantity}
          </span>
          <Step
            label={`One more ${line.name}`}
            onClick={() => onPatch({ quantity: line.quantity + 1 })}
            disabled={line.quantity >= line.available}
          >
            <PlusIcon className="size-3.5" />
          </Step>
        </div>

        <p className="tabular w-20 shrink-0 text-right text-sm font-bold">
          {formatPesewas(lineTotal(line))}
        </p>

        <button
          type="button"
          onClick={onDrop}
          aria-label={`Remove ${line.name}`}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-danger-subtle hover:text-destructive"
        >
          <Trash2Icon className="size-4" />
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-3 text-xs">
        {haggling ? (
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Charge GH₵</span>
            <Input
              value={priceText}
              onChange={(e) => {
                const text = e.target.value;
                setPriceText(text);
                onPatch({
                  unitPrice: text.trim() === "" ? null : parseCedis(text),
                });
              }}
              inputMode="decimal"
              autoComplete="off"
              placeholder={toCedisInput(line.listPrice)}
              className="tabular h-7 w-24 text-xs"
              autoFocus={line.unitPrice == null}
            />
            <button
              type="button"
              onClick={() => {
                setHaggling(false);
                setPriceText("");
                onPatch({ unitPrice: null });
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              Shelf price
            </button>
          </label>
        ) : (
          <button
            type="button"
            onClick={() => setHaggling(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            Change price
          </button>
        )}
        {issue && <span className="text-destructive">{issue}</span>}
      </div>
    </li>
  );
}

function Step({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex size-7 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-muted disabled:hover:text-foreground"
    >
      {children}
    </button>
  );
}

function ShelfTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
        active
          ? "bg-foreground text-background"
          : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Half({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Money({
  label,
  value,
  muted,
  tone,
}: {
  label: string;
  value: number;
  muted?: boolean;
  tone?: "warning";
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className={cn(muted && "text-muted-foreground")}>{label}</dt>
      <dd className={cn("tabular", tone === "warning" && "text-warning")}>
        {value < 0 ? `−${formatPesewas(-value)}` : formatPesewas(value)}
      </dd>
    </div>
  );
}
