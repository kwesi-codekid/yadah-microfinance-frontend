import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { allLabels, listItems, updateItem } from "~/api/hire-purchase";
import { ItemLabels, labelIdFrom } from "~/components/item-labels";
import { Figure } from "~/components/listing";
import {
  RouteSheet,
  SheetActions,
  SheetCancel,
} from "~/components/route-sheet";
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
import { Textarea } from "~/components/ui/textarea";
import { formatPesewas, parseCedis, toCedisInput } from "~/lib/format";
import {
  ITEM_STATUS_LABELS,
  depositFor,
  type ItemStatus,
} from "~/lib/hire-purchase";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/inventory-edit";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: `${loaderData?.item.name ?? "Item"} · Yadah Dynamic Enterprise` },
  ];
}

/**
 * There is no `GET /hire-purchase/items/{id}`, so the item is found through the
 * listing. A page of a hundred covers any real shelf, and it is one call either
 * way.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const [list, brands, categories] = await Promise.all([
        listItems(token, { limit: 100 }),
        allLabels(token, "brand"),
        allLabels(token, "category"),
      ]);
      const found = list.items.find((candidate) => candidate.id === params.id);
      if (!found) throw new Response("No such item.", { status: 404 });
      return { item: found, labels: { brands, categories } };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data(result, { headers });
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const brandId = labelIdFrom(form.get("brandId"));
  const categoryId = labelIdFrom(form.get("categoryId"));
  const description = String(form.get("description") ?? "").trim();
  const status = String(form.get("status") ?? "active") as ItemStatus;
  const costPrice = parseCedis(String(form.get("costPrice") ?? "").trim());
  const sellingPrice = parseCedis(
    String(form.get("sellingPrice") ?? "").trim(),
  );

  if (!name) return data({ error: "Give the item a name." }, { status: 400 });
  if (costPrice == null || costPrice < 0) {
    return data({ error: "Enter what Yadah paid for it." }, { status: 400 });
  }
  if (sellingPrice == null || sellingPrice <= 0) {
    return data({ error: "Enter what the customer pays." }, { status: 400 });
  }

  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ headers } = await withAuth(request, (token) =>
      updateItem(token, params.id, {
        name,
        // "None" is null; the API takes the item off the label.
        brandId: brandId ?? null,
        categoryId: categoryId ?? null,
        description,
        costPrice,
        sellingPrice,
        status,
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
    { tone: "success", message: `${name} updated.` },
    headers,
  );
}

export default function InventoryEdit({ loaderData }: Route.ComponentProps) {
  const { item, labels } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [selling, setSelling] = useState(toCedisInput(item.sellingPrice));
  const sellingPesewas = parseCedis(selling);
  const changed =
    sellingPesewas != null && sellingPesewas !== item.sellingPrice;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet backTo="/inventory" title={item.name} description="Edit item">
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
              defaultValue={item.name}
              autoComplete="off"
              maxLength={120}
            />
          </div>

          <ItemLabels
            brands={labels.brands}
            categories={labels.categories}
            defaults={{ brandId: item.brand?.id ?? "", categoryId: item.category?.id ?? "" }}
          />

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
              defaultValue={item.description ?? ""}
              rows={2}
              maxLength={500}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label
                htmlFor="costPrice"
                className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                Cost price · GH₵
              </Label>
              <Input
                id="costPrice"
                name="costPrice"
                defaultValue={toCedisInput(item.costPrice)}
                inputMode="decimal"
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
              </Label>
              <Input
                id="sellingPrice"
                name="sellingPrice"
                value={selling}
                onChange={(event) => setSelling(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                className="tabular"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Status
            </Label>
            <Select name="status" defaultValue={item.status}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["active", "discontinued"] as const).map((value) => (
                  <SelectItem key={value} value={value}>
                    {ITEM_STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {changed && sellingPesewas != null && (
            <dl className="grid grid-cols-2 gap-3">
              <Figure
                label="Deposit was"
                value={formatPesewas(depositFor(item.sellingPrice))}
                tone="muted"
              />
              <Figure
                label="Deposit becomes"
                value={formatPesewas(depositFor(sellingPesewas))}
              />
            </dl>
          )}

          <p className="tabular text-xs text-muted-foreground">
            {item.quantityInStock} in stock.
          </p>
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2Icon className="animate-spin" />}
            Save changes
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
