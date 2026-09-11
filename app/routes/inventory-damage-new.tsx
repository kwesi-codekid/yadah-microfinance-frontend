import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { listItems, reportDamage } from "~/api/hire-purchase";
import { IDLE, ScanDrop, type Slot } from "~/components/scan-drop";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { DateField } from "~/components/ui/date-field";
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
import { accraDay, formatCount, formatPesewas } from "~/lib/format";
import {
  DAMAGE_CAUSES,
  DAMAGE_CAUSE_LABELS,
  type DamageCause,
  type HpItem,
} from "~/lib/hire-purchase";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/inventory-damage-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Report damage · Yadah Dynamic Enterprise" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireCounter(request);

  const { data: items, headers } = await withAuth(request, async (token) => {
    try {
      // Only what is actually on the shelf: nothing can be broken that is not
      // there, and a list of zero-stock items is a list nobody can use. 100 is
      // the API's page cap; a shop with more than that in stock at once picks
      // the item by searching the shelf instead.
      const list = await listItems(token, { limit: 100, inStockOnly: true });
      return list.items;
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data({ items }, { headers });
}

export async function action({ request }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();

  const itemId = String(form.get("itemId") ?? "").trim();
  const quantity = Number(form.get("quantity") ?? 0);
  const cause = String(form.get("cause") ?? "") as DamageCause;
  const description = String(form.get("description") ?? "").trim();
  const occurredOn = String(form.get("occurredOn") ?? "").trim();
  const photoUrls = form
    .getAll("photoUrls")
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (!itemId) {
    return data({ error: "Choose which item was damaged." }, { status: 400 });
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return data({ error: "Say how many units." }, { status: 400 });
  }
  if (!DAMAGE_CAUSES.includes(cause)) {
    return data({ error: "Choose what happened." }, { status: 400 });
  }
  if (description.length < 2) {
    return data(
      { error: "Describe what happened — this is what the office reads." },
      { status: 400 },
    );
  }

  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ headers } = await withAuth(request, (token) =>
      reportDamage(token, {
        itemId,
        quantity,
        cause,
        description,
        ...(occurredOn ? { occurredOn } : {}),
        ...(photoUrls.length > 0 ? { photoUrls } : {}),
      }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  await redirectWithToast(
    "/inventory/damages",
    {
      tone: "success",
      message: "Damage reported.",
      description: "The shelf is unchanged until the office approves it.",
    },
    headers,
  );
}

export default function InventoryDamageNew({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [cause, setCause] = useState<DamageCause | "">("");
  const [photo, setPhoto] = useState<Slot>(IDLE);

  const item: HpItem | undefined = items.find((candidate) => candidate.id === itemId);
  const units = Number(quantity);
  const validUnits = Number.isInteger(units) && units > 0;
  const tooMany = item != null && validUnits && units > item.quantityInStock;
  const loss = item != null && validUnits && !tooMany ? item.costPrice * units : null;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo="/inventory/damages"
      title="Report damage"
      description="Nothing leaves the shelf until the office approves it"
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="photoUrls" value={photo.url ?? ""} />

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
            <Label htmlFor="item" className="eyebrow text-muted-foreground">
              Item<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger id="item" className="w-full">
                <SelectValue placeholder="Which item was damaged" />
              </SelectTrigger>
              <SelectContent>
                {items.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name} · {formatCount(candidate.quantityInStock)} on the shelf
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {items.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nothing is in stock, so there is nothing to write off.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="quantity" className="eyebrow text-muted-foreground">
                Units<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="quantity"
                name="quantity"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                inputMode="numeric"
                aria-invalid={tooMany ? true : undefined}
                className={cn("tabular", tooMany && "border-destructive")}
              />
              {tooMany && item ? (
                <p className="text-xs text-destructive">
                  Only {formatCount(item.quantityInStock)} on the shelf.
                </p>
              ) : loss != null ? (
                // What the shop stands to lose, said before anyone commits to
                // it — the same figure the office will see when deciding.
                <p className="text-xs text-muted-foreground">
                  {formatPesewas(loss)} at cost.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cause" className="eyebrow text-muted-foreground">
                What happened<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Select
                name="cause"
                value={cause}
                onValueChange={(value) => setCause(value as DamageCause)}
              >
                <SelectTrigger id="cause" className="w-full">
                  <SelectValue placeholder="Pick one" />
                </SelectTrigger>
                <SelectContent>
                  {DAMAGE_CAUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {DAMAGE_CAUSE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description" className="eyebrow text-muted-foreground">
              Describe it<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Textarea
              id="description"
              name="description"
              rows={3}
              maxLength={300}
              placeholder="Knocked off the shelf while restocking. Screen cracked."
            />
            <p className="text-xs text-muted-foreground">
              This is what the office reads when deciding. Be specific.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="eyebrow text-muted-foreground">Happened on</Label>
            <DateField name="occurredOn" defaultValue={accraDay()} endMonth={new Date()} />
          </div>

          {/* Evidence. Optional, because a report held up waiting for a camera
              is a report that never gets written — but a photograph is what
              settles an argument about a write-off weeks later. */}
          <ScanDrop
            label="Photograph (optional)"
            kind="photo"
            slot={photo}
            onChange={setPhoto}
            captureTitle="Photograph the damage"
            frame="aspect-[4/3] w-full"
          />
        </div>

        <SheetActions>
          <SheetCancel />
          <Button
            type="submit"
            disabled={submitting || !itemId || !validUnits || tooMany || !cause}
          >
            {submitting && <Loader2Icon className="animate-spin" />}
            Report damage
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
