import { EyeOffIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { ItemLabels, labelIdFrom } from "~/components/item-labels";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { allLabels, createItem } from "~/api/hire-purchase";
import { Figure } from "~/components/listing";
import {
  RouteSheet,
  SheetActions,
  SheetCancel,
} from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { formatPesewas, parseCedis } from "~/lib/format";
import { depositFor, financedFor, marginPercent } from "~/lib/hire-purchase";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/inventory-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Add an item · Yadah Dynamic Enterprise" }];
}

/** The managed brands and categories, for the two pickers. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireCounter(request);
  const { data: labels, headers } = await withAuth(request, async (token) => {
    const [brands, categories] = await Promise.all([
      allLabels(token, "brand"),
      allLabels(token, "category"),
    ]);
    return { brands, categories };
  });
  return data({ labels }, { headers });
}

export async function action({ request }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const brandId = labelIdFrom(form.get("brandId"));
  const categoryId = labelIdFrom(form.get("categoryId"));
  const description = String(form.get("description") ?? "").trim();
  const quantityInStock = Number(form.get("quantityInStock") ?? 0);
  const costPrice = parseCedis(String(form.get("costPrice") ?? "").trim());
  const sellingPrice = parseCedis(
    String(form.get("sellingPrice") ?? "").trim(),
  );

  if (!name) return data({ error: "Give the item a name." }, { status: 400 });
  if (!Number.isInteger(quantityInStock) || quantityInStock < 0) {
    return data({ error: "Stock has to be a whole number." }, { status: 400 });
  }
  if (costPrice == null || costPrice < 0) {
    return data({ error: "Enter what Yadah paid for it." }, { status: 400 });
  }
  if (sellingPrice == null || sellingPrice <= 0) {
    return data({ error: "Enter what the customer pays." }, { status: 400 });
  }

  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ headers } = await withAuth(request, (token) =>
      createItem(token, {
        name,
        ...(brandId ? { brandId } : {}),
        ...(categoryId ? { categoryId } : {}),
        description: description || undefined,
        quantityInStock,
        costPrice,
        sellingPrice,
      }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  await redirectWithToast(
    "/inventory",
    { tone: "success", message: `${name} added to the shelf.` },
    headers,
  );
}

export default function InventoryNew({ loaderData }: Route.ComponentProps) {
  const { labels } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [cost, setCost] = useState("");
  const [selling, setSelling] = useState("");

  const costPesewas = parseCedis(cost);
  const sellingPesewas = parseCedis(selling);
  const priced = sellingPesewas != null && sellingPesewas > 0;
  const belowCost =
    priced && costPesewas != null && sellingPesewas < costPesewas;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo="/inventory"
      title="Add an item"
    >
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

          <div className="space-y-1.5">
            <Label
              htmlFor="name"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Name<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              autoFocus
              autoComplete="off"
              maxLength={120}
            />
          </div>

          <ItemLabels brands={labels.brands} categories={labels.categories} />

          <div className="space-y-1.5">
            <Label
              htmlFor="description"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Description
            </Label>
            <Textarea
              id="description"
              name="description"
              rows={2}
              maxLength={500}
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="quantityInStock"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Units in stock<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="quantityInStock"
              name="quantityInStock"
              type="number"
              min={0}
              step={1}
              defaultValue={1}
              className="tabular"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label
                htmlFor="costPrice"
                className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                Cost price · GH₵
                <span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="costPrice"
                name="costPrice"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                className="tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="sellingPrice"
                className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                Selling price · GH₵
                <span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="sellingPrice"
                name="sellingPrice"
                value={selling}
                onChange={(event) => setSelling(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                aria-invalid={belowCost ? true : undefined}
                className={cn("tabular", belowCost && "border-destructive")}
              />
            </div>
          </div>

          {belowCost && (
            <p className="flex items-start gap-2 text-xs text-destructive">
              <EyeOffIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>The selling price is below cost.</span>
            </p>
          )}

          {/* What signing against this item will actually ask of a customer.
              Both figures are fixed by the selling price, so they are worth
              seeing while the price is still being decided. */}
          {priced && (
            <dl className="grid grid-cols-2 gap-3">
              <Figure
                label="Deposit"
                value={formatPesewas(depositFor(sellingPesewas))}
                hint="Half the price"
              />
              <Figure
                label="Financed"
                value={formatPesewas(financedFor(sellingPesewas))}
                hint="The rest"
              />
              {costPesewas != null && costPesewas > 0 && (
                <Figure
                  label="Margin"
                  value={formatPesewas(sellingPesewas - costPesewas)}
                  hint={`${marginPercent({ costPrice: costPesewas, sellingPrice: sellingPesewas })}% of cost`}
                  tone="revenue"
                  className="col-span-2"
                />
              )}
            </dl>
          )}
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2Icon className="animate-spin" />}
            Add item
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
