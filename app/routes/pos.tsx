import {
  Loader2Icon,
  PlusIcon,
  ShoppingCartIcon,
  TriangleAlertIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { listItems } from "~/api/hire-purchase";
import { createSale } from "~/api/sales";
import { CustomerPicker, type PickedCustomer } from "~/components/customer-picker";
import { BackLink, Page } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { formatAmount, formatPesewas, parseCedis, toCedisInput } from "~/lib/format";
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
import type { Route } from "./+types/sale-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "New sale · Yadah Dynamic Enterprise" }];
}

/** What the picker needs to know about a thing on the shelf. */
interface Sellable {
  id: string;
  name: string;
  sellingPrice: number;
  available: number;
  condition: string;
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
const SHELF_LIMIT = 200;

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
      items: result.items.map(
        (item): Sellable => ({
          id: item.id,
          name: item.name,
          sellingPrice: item.sellingPrice,
          available: item.quantityInStock,
          condition: item.condition,
        }),
      ),
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
  const buyerName = String(form.get("buyerName") ?? "").trim().toUpperCase();
  const buyerPhone = String(form.get("buyerPhone") ?? "").trim();
  const channel = String(form.get("channel") ?? "cash") as SaleChannel;
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");

  let lines: { itemId: string; quantity: number; unitPrice?: number }[];
  try {
    lines = JSON.parse(String(form.get("lines") ?? "[]"));
  } catch {
    return data({ error: "The basket did not come through. Try again." }, { status: 400 });
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

export default function SaleNew({ loaderData }: Route.ComponentProps) {
  const { items, truncated } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [walkIn, setWalkIn] = useState(true);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [channel, setChannel] = useState<SaleChannel>("cash");
  const [lines, setLines] = useState<BasketLine[]>([]);

  // One basket, one key. A retry after a dropped connection must not sell the
  // same stock twice.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  const inBasket = new Set(lines.map((l) => l.itemId));
  const addable = items.filter((i) => !inBasket.has(i.id) && i.available > 0);

  const add = (item: Sellable) =>
    setLines((current) => [
      ...current,
      {
        itemId: item.id,
        name: item.name,
        listPrice: item.sellingPrice,
        available: item.available,
        quantity: 1,
        unitPrice: null,
      },
    ]);

  const patch = (itemId: string, next: Partial<BasketLine>) =>
    setLines((current) =>
      current.map((l) => (l.itemId === itemId ? { ...l, ...next } : l)),
    );

  const drop = (itemId: string) =>
    setLines((current) => current.filter((l) => l.itemId !== itemId));

  const subtotal = basketSubtotal(lines);
  const discount = basketDiscount(lines);
  const total = basketTotal(lines);

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
    <Page className="max-w-none">
      <BackLink to="/sales" className="mb-4">
        All counter sales
      </BackLink>

      <Form method="post" className="space-y-6">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="lines" value={JSON.stringify(linesForApi(lines))} />
        <input type="hidden" name="channel" value={channel} />

        {actionData?.error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <p className="font-medium">{actionData.error}</p>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* The basket. */}
          <section className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Add from the shelf
              </Label>
              <ItemPicker items={addable} onPick={add} />
              <p className="text-xs text-muted-foreground">
                In-stock items only.
                {truncated
                  ? ` Showing the first ${SHELF_LIMIT} — narrow the shelf in Inventory if what you want is missing.`
                  : ""}
              </p>
            </div>

            {lines.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-12 text-center">
                <ShoppingCartIcon className="mx-auto size-6 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">
                  Nothing in the basket yet.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {lines.map((line) => (
                  <BasketRow
                    key={line.itemId}
                    line={line}
                    onPatch={(next) => patch(line.itemId, next)}
                    onDrop={() => drop(line.itemId)}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* The buyer, the money, and the button. */}
          <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
            <section className="space-y-3 rounded-xl border border-border bg-card p-4">
              <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Buyer
              </h3>

              {/* A walk-in is the ordinary case at a counter, so it is the
                  default. Demanding a photo and both sides of an ID to sell a
                  kettle is the thing this whole module exists to avoid. */}
              <div className="inline-flex w-full items-center gap-1 rounded-lg bg-muted/60 p-1">
                <ToggleHalf
                  active={walkIn}
                  onClick={() => {
                    setWalkIn(true);
                    setCustomer(null);
                  }}
                >
                  Walk-in
                </ToggleHalf>
                <ToggleHalf
                  active={!walkIn}
                  onClick={() => {
                    setWalkIn(false);
                    setBuyerName("");
                  }}
                >
                  Registered
                </ToggleHalf>
              </div>

              {walkIn ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="buyerName" className="text-xs text-muted-foreground">
                      Name<span className="ml-0.5 text-destructive">*</span>
                    </Label>
                    <Input
                      id="buyerName"
                      name="buyerName"
                      value={buyerName}
                      onChange={(e) => setBuyerName(e.target.value.toUpperCase())}
                      placeholder="KOFI MENSAH"
                      maxLength={120}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="buyerPhone" className="text-xs text-muted-foreground">
                      Phone
                    </Label>
                    <Input
                      id="buyerPhone"
                      name="buyerPhone"
                      value={buyerPhone}
                      onChange={(e) => setBuyerPhone(e.target.value)}
                      placeholder="0241234567"
                      inputMode="tel"
                      maxLength={20}
                      autoComplete="off"
                      className="tabular"
                    />
                  </div>
                </div>
              ) : (
                <CustomerPicker value={customer} onChange={setCustomer} />
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-card p-4">
              <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Payment
              </h3>
              <Select
                value={channel}
                onValueChange={(next) => setChannel(next as SaleChannel)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNEL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <dl className="space-y-1.5 border-t border-border pt-3 text-sm">
                <Money label="Subtotal" value={subtotal} muted />
                {discount > 0 && (
                  <Money label="Discount" value={-discount} tone="warning" />
                )}
                <div className="flex items-baseline justify-between border-t border-border pt-2">
                  <dt className="font-medium">Total</dt>
                  <dd className="tabular text-xl font-bold">
                    {formatPesewas(total)}
                  </dd>
                </div>
              </dl>
            </section>

            {(basketIssue || buyerIssue) && lines.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {buyerIssue ?? basketIssue}
              </p>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={blocked}>
              {submitting ? <Loader2Icon className="animate-spin" /> : <ShoppingCartIcon />}
              Take payment · {formatPesewas(total)}
            </Button>
          </aside>
        </div>
      </Form>
    </Page>
  );
}

/* ------------------------------------------------------------------- parts --- */

/**
 * Search the shelf and add a line.
 *
 * The whole shelf is already in hand, so this filters in the browser: at a
 * counter with someone waiting, a list that redraws as you type beats one that
 * waits on a round trip. Built from an input and a list rather than the
 * combobox primitive — the same shape `CustomerPicker` uses, so the two search
 * boxes in this app behave the same way.
 */
function ItemPicker({
  items,
  onPick,
}: {
  items: Sellable[];
  onPick: (item: Sellable) => void;
}) {
  const [query, setQuery] = useState("");

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
        Nothing left on the shelf to add.
      </p>
    );
  }

  const term = query.trim().toLowerCase();
  const matches = term
    ? items.filter((item) => item.name.toLowerCase().includes(term))
    : items;
  // Long enough to choose from, short enough not to push the basket off screen.
  const shown = matches.slice(0, 8);

  return (
    <div className="space-y-2">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search the shelf"
        aria-label="Search the shelf"
        autoComplete="off"
        maxLength={100}
      />

      {term && matches.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">Nothing matches.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {shown.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(item);
                  // Cleared on pick: the box is for adding the *next* thing,
                  // not for showing what was just added — the basket does that.
                  setQuery("");
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <PlusIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{item.name}</span>
                  {item.condition === "used" && (
                    <span className="shrink-0 text-xs text-muted-foreground">Used</span>
                  )}
                </span>
                <span className="tabular shrink-0 text-xs text-muted-foreground">
                  {formatPesewas(item.sellingPrice)} · {item.available} left
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {matches.length > shown.length && (
        <p className="px-1 text-xs text-muted-foreground">
          {matches.length - shown.length} more — keep typing to narrow it.
        </p>
      )}
    </div>
  );
}

function BasketRow({
  line,
  onPatch,
  onDrop,
}: {
  line: BasketLine;
  onPatch: (next: Partial<BasketLine>) => void;
  onDrop: () => void;
}) {
  // The haggled price is held as the typed string so a half-entered "12." does
  // not get parsed to something and snap back under the cursor.
  const [priceText, setPriceText] = useState(
    line.unitPrice == null ? "" : toCedisInput(line.unitPrice),
  );

  const issue = checkLine(line);
  const discounted = line.unitPrice != null && line.unitPrice < line.listPrice;

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{line.name}</p>
          <p className="tabular text-xs text-muted-foreground">
            {formatPesewas(line.listPrice)} each · {line.available} on the shelf
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="tabular font-semibold">{formatPesewas(lineTotal(line))}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onDrop}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2Icon />
            <span className="sr-only">Remove {line.name}</span>
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Quantity</Label>
          <Input
            value={String(line.quantity)}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[^\d]/g, ""));
              onPatch({ quantity: Number.isFinite(n) ? n : 0 });
            }}
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={issue ? true : undefined}
            className={cn("tabular", issue && "border-destructive")}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Price charged · GH₵
          </Label>
          <Input
            value={priceText}
            onChange={(e) => {
              const text = e.target.value;
              setPriceText(text);
              // Empty means "charge the shelf price" — which is not the same as
              // charging a number that happens to equal it, and the receipt
              // says so.
              onPatch({ unitPrice: text.trim() === "" ? null : parseCedis(text) });
            }}
            inputMode="decimal"
            autoComplete="off"
            placeholder={toCedisInput(line.listPrice)}
            className="tabular"
          />
        </div>
      </div>

      {issue ? (
        <p className="mt-2 text-xs text-destructive">{issue}</p>
      ) : discounted ? (
        <p className="mt-2 text-xs text-warning">
          Haggled down from {formatAmount(line.listPrice)} — the receipt shows both.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Leave the price empty to charge the shelf price.
        </p>
      )}
    </li>
  );
}

function ToggleHalf({
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
        "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
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
