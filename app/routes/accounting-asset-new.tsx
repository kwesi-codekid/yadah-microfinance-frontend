import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { listCashAccounts, registerAsset } from "~/api/accounting";
import { ApiError } from "~/api/error";
import { Figure } from "~/components/listing";
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
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_OPTIONS,
  monthlyDepreciation,
  type AssetCategory,
} from "~/lib/accounting";
import { accraDay, formatCount, formatPesewas, parseCedis } from "~/lib/format";
import { requireAdmin, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/accounting-asset-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Register an asset · Yadah Dynamic Enterprise" }];
}

/** The accounts the purchase may have left from. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const { data: accounts, headers } = await withAuth(request, (token) =>
    listCashAccounts(token),
  );
  return data(
    {
      accounts: accounts
        .filter((a) => (a.status ?? "active") === "active")
        .map((a) => ({ id: a.id, name: a.name })),
    },
    { headers },
  );
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The usual lives, so nobody has to remember that a motorbike is 48 months. */
const DEFAULT_LIFE_MONTHS: Record<AssetCategory, number> = {
  "motorbike-vehicle": 48,
  "computer-equipment": 36,
  "furniture-fittings": 60,
  premises: 240,
  other: 36,
};

/**
 * `POST /accounting/fixed-assets` — admin only.
 *
 * Buying an asset converts cash into something of equal value, so the cash
 * position drops by the cost only when an account is named, and profit and
 * loss sees nothing but the monthly depreciation. `422` when salvage is not
 * below cost.
 */
export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const category = String(form.get("category") ?? "") as AssetCategory;
  const cost = parseCedis(String(form.get("cost") ?? "").trim());
  const acquiredOn = String(form.get("acquiredOn") ?? "").trim();
  const usefulLifeMonths = Number(form.get("usefulLifeMonths") ?? 0);
  const salvageRaw = String(form.get("salvageValue") ?? "").trim();
  const salvageValue = salvageRaw ? parseCedis(salvageRaw) : 0;
  const cashAccountId = String(form.get("cashAccountId") ?? "").trim();
  const serialNumber = String(form.get("serialNumber") ?? "").trim();

  if (!name) return data({ error: "Give the asset a name." }, { status: 400 });
  if (!ASSET_CATEGORIES.includes(category)) {
    return data({ error: "Pick a category." }, { status: 400 });
  }
  if (cost == null || cost < 1) {
    return data({ error: "Enter what it cost." }, { status: 400 });
  }
  if (!DAY_RE.test(acquiredOn)) {
    return data({ error: "Pick the day it was acquired." }, { status: 400 });
  }
  if (acquiredOn > accraDay()) {
    return data({ error: "It cannot be acquired in the future." }, { status: 400 });
  }
  if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths < 1 || usefulLifeMonths > 600) {
    return data(
      { error: "Useful life is a whole number of months, up to 600." },
      { status: 400 },
    );
  }
  if (salvageValue == null || salvageValue < 0) {
    return data({ error: "Salvage value has to be a cedi amount, or blank." }, { status: 400 });
  }
  if (salvageValue >= cost) {
    return data({ error: "Salvage value has to be below the cost." }, { status: 400 });
  }

  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ headers } = await withAuth(request, (token) =>
      registerAsset(token, {
        name,
        category,
        cost,
        acquiredOn,
        usefulLifeMonths,
        salvageValue,
        cashAccountId: cashAccountId || undefined,
        serialNumber: serialNumber || undefined,
      }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const monthly = monthlyDepreciation({ cost, salvageValue, usefulLifeMonths });
  await redirectWithToast(
    "/accounting/assets",
    {
      tone: "success",
      message: `${name} registered.`,
      description: `${formatPesewas(monthly)} a month comes off profit and loss for ${formatCount(usefulLifeMonths)} months.`,
    },
    headers,
  );
}

export default function AccountingAssetNew({ loaderData }: Route.ComponentProps) {
  const { accounts } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [category, setCategory] = useState<AssetCategory>("motorbike-vehicle");
  const [life, setLife] = useState(String(DEFAULT_LIFE_MONTHS["motorbike-vehicle"]));
  const [cost, setCost] = useState("");
  const [salvage, setSalvage] = useState("");
  const [paidFrom, setPaidFrom] = useState("");

  const costPesewas = parseCedis(cost);
  const salvagePesewas = salvage ? parseCedis(salvage) : 0;
  const lifeMonths = Number(life);
  const priced = costPesewas != null && costPesewas > 0;
  const salvageTooHigh =
    priced && salvagePesewas != null && salvagePesewas >= costPesewas;
  const preview =
    priced && salvagePesewas != null && !salvageTooHigh && lifeMonths >= 1
      ? monthlyDepreciation({ cost: costPesewas, salvageValue: salvagePesewas, usefulLifeMonths: lifeMonths })
      : null;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo="/accounting/assets"
      title="Register an asset"
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
            <Label htmlFor="name" className="eyebrow text-muted-foreground">
              Name<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              autoFocus
              autoComplete="off"
              maxLength={120}
              placeholder="Haojue 125, red"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="category" className="eyebrow text-muted-foreground">
                Category<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Select
                name="category"
                value={category}
                onValueChange={(v) => {
                  const next = v as AssetCategory;
                  setCategory(next);
                  setLife(String(DEFAULT_LIFE_MONTHS[next]));
                }}
              >
                <SelectTrigger id="category" className="w-full">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_CATEGORY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="serialNumber" className="eyebrow text-muted-foreground">
                Serial or plate
              </Label>
              <Input
                id="serialNumber"
                name="serialNumber"
                autoComplete="off"
                maxLength={80}
                className="tabular"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cost" className="eyebrow text-muted-foreground">
                Cost · GH₵<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="cost"
                name="cost"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                className="tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acquiredOn" className="eyebrow text-muted-foreground">
                Acquired on<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <DateField
                id="acquiredOn"
                name="acquiredOn"
                defaultValue={accraDay()}
                endMonth={new Date()}
                required
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="usefulLifeMonths" className="eyebrow text-muted-foreground">
                Useful life · months<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="usefulLifeMonths"
                name="usefulLifeMonths"
                type="number"
                min={1}
                max={600}
                step={1}
                value={life}
                onChange={(event) => setLife(event.target.value)}
                className="tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="salvageValue" className="eyebrow text-muted-foreground">
                Salvage value · GH₵
              </Label>
              <Input
                id="salvageValue"
                name="salvageValue"
                value={salvage}
                onChange={(event) => setSalvage(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                aria-invalid={salvageTooHigh ? true : undefined}
                className={cn("tabular", salvageTooHigh && "border-destructive")}
              />
            </div>
          </div>
          <p
            className={cn(
              "-mt-3 text-xs",
              salvageTooHigh ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {salvageTooHigh
              ? "Salvage has to be below the cost — otherwise there is nothing to depreciate."
              : "What it will still be worth at the end of its life. Leave blank for nothing."}
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="cashAccountId" className="eyebrow text-muted-foreground">
              Paid from
            </Label>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No company account to name; the cash position will not move.
              </p>
            ) : (
              <Select name="cashAccountId" value={paidFrom} onValueChange={setPaidFrom}>
                <SelectTrigger id="cashAccountId" className="w-full">
                  <SelectValue placeholder="Not from a company account" />
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

          {/* What registering it will do to the books, while the figures are
              still being decided. */}
          {preview != null && costPesewas != null && (
            <dl className="grid grid-cols-2 gap-3">
              <Figure
                label="Depreciation"
                value={formatPesewas(preview)}
                hint="per month, straight-line"
                tone="warning"
              />
              <Figure
                label="Over its life"
                value={formatPesewas(costPesewas - (salvagePesewas ?? 0))}
                hint={`${formatCount(lifeMonths)} month${lifeMonths === 1 ? "" : "s"}, down to salvage`}
              />
            </dl>
          )}
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting || salvageTooHigh}>
            {submitting && <Loader2Icon className="animate-spin" />}
            Register asset
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
