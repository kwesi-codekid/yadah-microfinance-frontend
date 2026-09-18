import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { listItems, receiveStock } from "~/api/hire-purchase";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { DateField } from "~/components/ui/date-field";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  accraDay,
  formatAmount,
  formatCount,
  parseCedis,
  toCedisInput,
} from "~/lib/format";
import { deliveryEffect } from "~/lib/hire-purchase";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/inventory-receive";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `Receive stock · ${loaderData?.item.name ?? "Item"} · Yadah Dynamic Enterprise`,
    },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);

  const { data: item, headers } = await withAuth(request, async (token) => {
    try {
      const list = await listItems(token, { limit: 100 });
      const found = list.items.find((candidate) => candidate.id === params.id);
      if (!found) throw new Response("No such item.", { status: 404 });
      return found;
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data({ item }, { headers });
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();

  const quantity = Number(form.get("quantity") ?? 0);
  const unitCost = parseCedis(String(form.get("unitCost") ?? ""));
  const sellingRaw = String(form.get("sellingPrice") ?? "").trim();
  const sellingPrice = sellingRaw ? parseCedis(sellingRaw) : null;
  const supplier = String(form.get("supplier") ?? "").trim();
  const invoiceRef = String(form.get("invoiceRef") ?? "").trim();
  const receivedOn = String(form.get("receivedOn") ?? "").trim();
  const note = String(form.get("note") ?? "").trim();

  if (!Number.isInteger(quantity) || quantity < 1) {
    return data({ error: "Say how many units arrived." }, { status: 400 });
  }
  if (unitCost == null || unitCost <= 0) {
    return data(
      { error: "Enter what this delivery cost per unit, from the invoice." },
      { status: 400 },
    );
  }
  if (sellingRaw && (sellingPrice == null || sellingPrice <= 0)) {
    return data({ error: "That selling price is not a number." }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof receiveStock>>;
  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ data: result, headers } = await withAuth(request, (token) =>
      receiveStock(token, params.id, {
        quantity,
        unitCost,
        ...(sellingPrice != null ? { sellingPrice } : {}),
        ...(supplier ? { supplier } : {}),
        ...(invoiceRef ? { invoiceRef } : {}),
        ...(receivedOn ? { receivedOn } : {}),
        ...(note ? { note } : {}),
      }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const moved = result.changes.find((change) => change.kind === "cost");
  await redirectWithToast(
    "/inventory",
    {
      tone: "success",
      message: `${formatCount(quantity)} received into ${result.item.name}.`,
      // The price move is the part worth saying out loud — it is the thing
      // that will change every margin from here on.
      description: moved
        ? `Cost is now GH₵ ${formatAmount(moved.current)}, was GH₵ ${formatAmount(moved.previous)}.`
        : `${formatCount(result.item.quantityInStock)} on the shelf.`,
    },
    headers,
  );
}

export default function InventoryReceive({ loaderData }: Route.ComponentProps) {
  const { item } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [quantity, setQuantity] = useState("1");
  // Pre-filled with what the shelf currently says, because most deliveries
  // arrive at the price the last one did. Changing it is the whole point.
  const [cost, setCost] = useState(() => toCedisInput(item.costPrice));
  const [selling, setSelling] = useState("");

  const units = Number(quantity);
  const validUnits = Number.isInteger(units) && units > 0;
  const unitCost = parseCedis(cost);
  const sellingPesewas = selling.trim() ? parseCedis(selling) : null;

  const effect =
    unitCost != null && unitCost > 0
      ? deliveryEffect(item, unitCost, sellingPesewas ?? undefined)
      : null;
  const belowCost = effect != null && effect.marginAfter < 0;
  const moved = effect != null && effect.costDelta !== 0;
  const dearer = (effect?.costDelta ?? 0) > 0;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet backTo="/inventory" title="Receive stock" description={item.name}>
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {actionData?.error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <p className="font-medium">{actionData.error}</p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label
                htmlFor="quantity"
                className="eyebrow text-muted-foreground"
              >
                Units received<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="quantity"
                name="quantity"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                inputMode="numeric"
                autoFocus
                className="tabular"
              />
              <p className="text-xs text-muted-foreground">
                {formatCount(item.quantityInStock)} on the shelf now
                {validUnits && ` · ${formatCount(item.quantityInStock + units)} after`}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="unitCost" className="eyebrow text-muted-foreground">
                Cost each · GH₵<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="unitCost"
                name="unitCost"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
                inputMode="decimal"
                aria-invalid={belowCost ? true : undefined}
                className={cn("tabular", belowCost && "border-destructive")}
              />
              <p className="text-xs text-muted-foreground">From this invoice.</p>
            </div>
          </div>

          {/* The one thing this screen exists to make visible. A delivery at a
              new price silently re-values every unit already on the shelf, so
              the moment the typed cost leaves the shelf's, it says so — and
              says what the margin becomes. */}
          {effect != null && (
            <div
              className={cn(
                "rounded-lg border px-4 py-3",
                belowCost
                  ? "border-destructive/40 bg-destructive/10"
                  : moved
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-muted/40",
              )}
            >
              {moved ? (
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                  {dearer ? (
                    <ArrowUpRightIcon className="size-4 shrink-0 self-center text-cash-out" />
                  ) : (
                    <ArrowDownRightIcon className="size-4 shrink-0 self-center text-cash-in" />
                  )}
                  <span className="tabular text-muted-foreground line-through">
                    GH₵ {formatAmount(item.costPrice)}
                  </span>
                  <span className="tabular font-semibold">
                    GH₵ {formatAmount(unitCost ?? 0)}
                  </span>
                  <span className="text-muted-foreground">
                    {dearer ? "dearer" : "cheaper"} by GH₵{" "}
                    {formatAmount(Math.abs(effect.costDelta))} a unit
                  </span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Same cost as the shelf. Nothing is repriced.
                </p>
              )}

              <p
                className={cn(
                  "mt-1.5 text-xs",
                  belowCost ? "font-medium text-destructive" : "text-muted-foreground",
                )}
              >
                {belowCost
                  ? `This costs more than the GH₵ ${formatAmount(sellingPesewas ?? item.sellingPrice)} it sells for. Raise the selling price below.`
                  : `Margin: GH₵ ${formatAmount(effect.marginAfter)} a unit (${effect.marginPercent}%).`}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="sellingPrice" className="eyebrow text-muted-foreground">
              New selling price · GH₵
            </Label>
            <Input
              id="sellingPrice"
              name="sellingPrice"
              value={selling}
              onChange={(event) => setSelling(event.target.value)}
              inputMode="decimal"
              placeholder={toCedisInput(item.sellingPrice)}
              className="tabular"
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to keep GH₵ {formatAmount(item.sellingPrice)}. Past
              sales keep the price they were written at either way.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="supplier" className="eyebrow text-muted-foreground">
                Supplier
              </Label>
              <Input
                id="supplier"
                name="supplier"
                maxLength={160}
                autoComplete="off"
                placeholder="Who it came from"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoiceRef" className="eyebrow text-muted-foreground">
                Invoice number
              </Label>
              <Input
                id="invoiceRef"
                name="invoiceRef"
                maxLength={80}
                autoComplete="off"
                placeholder="e.g. INV-4471"
                className="tabular"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="eyebrow text-muted-foreground">Received on</Label>
            <DateField name="receivedOn" defaultValue={accraDay()} endMonth={new Date()} />
            <p className="text-xs text-muted-foreground">
              The day the goods arrived, which need not be today.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note" className="eyebrow text-muted-foreground">
              Note
            </Label>
            <Textarea
              id="note"
              name="note"
              rows={2}
              maxLength={300}
              placeholder="Anything worth remembering about this delivery."
            />
          </div>
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting || !validUnits || belowCost}>
            {submitting && <Loader2Icon className="animate-spin" />}
            Receive {validUnits ? formatCount(units) : ""} into stock
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
