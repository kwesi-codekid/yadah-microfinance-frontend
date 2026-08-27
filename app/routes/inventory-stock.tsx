import { Loader2Icon, MinusIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { adjustStock, listItems } from "~/api/hire-purchase";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { formatCount } from "~/lib/format";
import { stockAfter } from "~/lib/hire-purchase";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/inventory-stock";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: `Adjust stock · ${loaderData?.item.name ?? "Item"} · Yadah Dynamic Enterprise` },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOffice(request);

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
  await requireOffice(request);
  const form = await request.formData();
  const delta = Number(form.get("delta") ?? 0);
  const reason = String(form.get("reason") ?? "").trim();

  if (!Number.isInteger(delta) || delta === 0) {
    return data({ error: "Say how many units to add or remove." }, { status: 400 });
  }
  if (!reason) {
    return data({ error: "Every adjustment needs a reason." }, { status: 400 });
  }

  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ headers } = await withAuth(request, (token) =>
      adjustStock(token, params.id, { delta, reason }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  await redirectWithToast(
    "/inventory",
    {
      tone: "success",
      message:
        delta > 0
          ? `${formatCount(delta)} added to stock.`
          : `${formatCount(Math.abs(delta))} removed from stock.`,
      description: reason,
    },
    headers,
  );
}

export default function InventoryStock({ loaderData }: Route.ComponentProps) {
  const { item } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [direction, setDirection] = useState<1 | -1>(1);
  const [count, setCount] = useState("1");

  const units = Number(count);
  const valid = Number.isInteger(units) && units > 0;
  const delta = valid ? units * direction : 0;
  const after = stockAfter(item, delta);
  const underflow = valid && after < 0;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo="/inventory"
      title="Adjust stock"
      description={item.name}
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="delta" value={delta} />

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

          {/* The count is drawn as an arithmetic line rather than a form field
              with a signed number in it: `-3` typed into a box is easy to get
              backwards, and stock going the wrong way is a real loss. */}
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <div className="flex items-center justify-center gap-3">
              <span className="tabular text-2xl font-bold">
                {formatCount(item.quantityInStock)}
              </span>
              <div className="inline-flex overflow-hidden rounded-lg border border-input">
                <button
                  type="button"
                  onClick={() => setDirection(-1)}
                  aria-pressed={direction === -1}
                  aria-label="Remove units"
                  className={cn(
                    "px-3 py-2 transition-colors",
                    direction === -1
                      ? "bg-destructive text-destructive-foreground"
                      : "hover:bg-accent",
                  )}
                >
                  <MinusIcon className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setDirection(1)}
                  aria-pressed={direction === 1}
                  aria-label="Add units"
                  className={cn(
                    "px-3 py-2 transition-colors",
                    direction === 1 ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                  )}
                >
                  <PlusIcon className="size-4" />
                </button>
              </div>
              <Input
                value={count}
                onChange={(event) => setCount(event.target.value)}
                inputMode="numeric"
                aria-label="How many units"
                className="tabular w-20 text-center"
              />
              <span aria-hidden className="text-muted-foreground">
                =
              </span>
              <span
                className={cn(
                  "tabular text-2xl font-bold",
                  underflow ? "text-destructive" : "text-primary",
                )}
              >
                {formatCount(Math.max(after, 0))}
              </span>
            </div>
            <p
              className={cn(
                "mt-2 text-center text-xs",
                underflow ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {underflow
                ? `Only ${formatCount(item.quantityInStock)} on the shelf. Stock cannot go below zero.`
                : "Units on the shelf, before and after."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="reason"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Reason<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Textarea
              id="reason"
              name="reason"
              rows={3}
              autoFocus
              maxLength={300}
              placeholder={
                direction > 0 ? "Delivery from supplier." : "Damaged in storage."
              }
            />
            <p className="text-xs text-muted-foreground">
              Recorded against the item and kept. A stock count that can be
              changed silently is not a stock count.
            </p>
          </div>
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting || !valid || underflow}>
            {submitting && <Loader2Icon className="animate-spin" />}
            {direction > 0 ? "Add to stock" : "Remove from stock"}
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
