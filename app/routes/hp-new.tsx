import {
  CheckIcon,
  Loader2Icon,
  MinusIcon,
  PackageIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  data,
  Form,
  Link,
  useActionData,
  useFetcher,
  useNavigation,
  useSearchParams,
} from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { getConfig, listItems, signAgreement } from "~/api/hire-purchase";
import { CustomerPicker, type PickedCustomer } from "~/components/customer-picker";
import { Figure } from "~/components/listing";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { formatCount, formatPesewas } from "~/lib/format";
import {
  CONDITION_LABELS,
  depositFor,
  financedFor,
  isSellable,
  type HpConfig,
  type HpEligibility,
} from "~/lib/hire-purchase";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/hp-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Sign an agreement · Yadah Dynamic Enterprise" }];
}

/** The durations the branch writes agreements over. */
const DURATIONS = [3, 6, 12] as const;

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const [items, config] = await Promise.all([
      // Only what can actually back an agreement today. Offering an item that
      // is out of stock is offering something the API will refuse.
      listItems(token, { status: "active", inStockOnly: true, limit: 100 }),
      getConfig(token).catch(() => ({ config: {} as HpConfig })),
    ]);
    return { items, config };
  });

  return data(
    {
      items: result.items.items.filter(isSellable).map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description ?? "",
        condition: CONDITION_LABELS[item.condition],
        sellingPrice: item.sellingPrice,
        quantityInStock: item.quantityInStock,
      })),
      interestRatePercent: result.config.config?.interestRatePercent ?? null,
    },
    { headers },
  );
}

export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const customerId = String(form.get("customerId") ?? "").trim();
  const itemId = String(form.get("itemId") ?? "").trim();
  const durationMonths = Number(form.get("durationMonths") ?? 0);

  if (!customerId) return data({ error: "Choose the customer." }, { status: 400 });
  if (!itemId) return data({ error: "Choose what they are buying." }, { status: 400 });
  if (!DURATIONS.includes(durationMonths as (typeof DURATIONS)[number])) {
    return data({ error: "Choose a duration." }, { status: 400 });
  }

  let result: { agreement: { id: string; depositRequired: number } };
  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ data: result, headers } = await withAuth(request, (token) =>
      signAgreement(token, { customerId, itemId, durationMonths }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }

  await redirectWithToast(
    `/hire-purchase/${result.agreement.id}`,
    {
      tone: "success",
      message: "Agreement signed.",
      description: `The item stays in the shop until the ${formatPesewas(result.agreement.depositRequired)} deposit is paid.`,
    },
    headers,
  );
}

export default function HpNew({ loaderData }: Route.ComponentProps) {
  const { items, interestRatePercent } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [searchParams] = useSearchParams();

  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  // Arrives prefilled when this was opened from a row on the shelf.
  const [itemId, setItemId] = useState(searchParams.get("itemId") ?? "");
  const [months, setMonths] = useState<number>(6);

  const conditions = useFetcher<{
    eligibility: HpEligibility | null;
    error: string | null;
  }>();
  useEffect(() => {
    if (customer) conditions.load(`/hire-purchase/eligibility/${customer.id}`);
    // `conditions` is a stable fetcher; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id]);

  const eligibility = customer ? conditions.data?.eligibility ?? null : null;
  const checking = customer != null && conditions.state !== "idle";
  // Only an explicit `false` blocks. The endpoint's shape is not pinned down,
  // and treating a missing field as a refusal would block every signing.
  const refused = eligibility?.eligible === false;

  const item = items.find((candidate) => candidate.id === itemId) ?? null;
  const deposit = item ? depositFor(item.sellingPrice) : 0;
  const financed = item ? financedFor(item.sellingPrice) : 0;
  const interest =
    interestRatePercent != null
      ? Math.round((financed * interestRatePercent) / 100)
      : null;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo="/hire-purchase"
      title="Sign an agreement"
      description="A unit comes off the shelf now. It leaves the shop when the deposit is paid."
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
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Customer<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <CustomerPicker value={customer} onChange={setCustomer} autoFocus />
          </div>

          {customer && (
            <ConditionsPanel
              checking={checking}
              eligibility={eligibility}
              error={conditions.data?.error ?? null}
            />
          )}

          {items.length === 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
              <PackageIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                Nothing on the shelf can back an agreement — every item is out of
                stock or discontinued.{" "}
                <Link to="/inventory" className="underline underline-offset-4">
                  Check the inventory
                </Link>
                .
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Item<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Select name="itemId" value={itemId} onValueChange={setItemId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose what they are buying" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name} · {formatPesewas(candidate.sellingPrice)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {item && (
                <p className="text-xs text-muted-foreground">
                  {item.condition}
                  {item.description ? ` · ${item.description}` : ""} ·{" "}
                  {formatCount(item.quantityInStock)} in stock
                </p>
              )}
            </div>
          )}

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Duration
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {DURATIONS.map((d) => (
                <label
                  key={d}
                  className={cn(
                    "flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors",
                    "focus-within:ring-2 focus-within:ring-ring",
                    months === d
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-input hover:bg-accent",
                  )}
                >
                  <input
                    type="radio"
                    name="durationMonths"
                    value={d}
                    checked={months === d}
                    onChange={() => setMonths(d)}
                    className="sr-only"
                  />
                  {d} months
                </label>
              ))}
            </div>
          </fieldset>

          {/* The two halves, worked out before anyone signs. The deposit is the
              figure the counter is asked for first and it has to match to the
              pesewa, so it is the one drawn largest. */}
          {item && (
            <dl className="grid grid-cols-2 gap-3">
              <Figure
                label="Deposit due"
                value={formatPesewas(deposit)}
                hint="Exactly half. The item is released on it."
                className="col-span-2"
              />
              <Figure label="Financed" value={formatPesewas(financed)} />
              <Figure
                label="Interest"
                value={interest == null ? "Set at activation" : formatPesewas(interest)}
                hint={
                  interestRatePercent == null
                    ? "The rate is applied when the deposit lands"
                    : `${interestRatePercent}% flat, once`
                }
              />
              {interest != null && (
                <Figure
                  label="Payable after the deposit"
                  value={formatPesewas(financed + interest)}
                  hint="Flat interest — settling early costs the same"
                  className="col-span-2"
                />
              )}
            </dl>
          )}

          <p className="text-xs text-muted-foreground">
            Prices are snapshotted at signing. Editing the item afterwards never
            changes this agreement.
          </p>
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting || !customer || !item || refused}>
            {submitting && <Loader2Icon className="animate-spin" />}
            Sign agreement
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}

/**
 * The five conditions, as the API reports them. Where it says nothing, this
 * says nothing — the endpoint's shape is not settled, and inventing a refusal
 * out of a missing field would block signings that are perfectly good.
 */
function ConditionsPanel({
  checking,
  eligibility,
  error,
}: {
  checking: boolean;
  eligibility: HpEligibility | null;
  error: string | null;
}) {
  if (checking) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        Checking the conditions…
      </div>
    );
  }

  if (error || !eligibility) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
        <span>
          {error ?? "Could not check the conditions."} The API checks them again
          when the agreement is signed.
        </span>
      </div>
    );
  }

  const reasons = eligibility.reasons ?? [];
  const refused = eligibility.eligible === false;

  return (
    <section
      className={cn(
        "space-y-2 rounded-lg border p-4 text-sm",
        refused ? "border-danger/40 bg-danger/10" : "border-border bg-muted/40",
      )}
    >
      <h3 className="eyebrow text-muted-foreground">Conditions</h3>

      {refused ? (
        <ul className="space-y-1.5">
          {reasons.length > 0 ? (
            reasons.map((reason) => (
              <li key={reason} className="flex items-start gap-2 text-danger">
                <MinusIcon className="mt-0.5 size-4 shrink-0" />
                <span>{reason}</span>
              </li>
            ))
          ) : (
            <li className="flex items-start gap-2 text-danger">
              <MinusIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                This customer cannot sign an agreement yet. Both sides of the
                ID document on the profile, three months of saving history, an
                active susu or savings account, no active loan, and no agreement
                already open.
              </span>
            </li>
          )}
        </ul>
      ) : (
        <p className="flex items-start gap-2 text-muted-foreground">
          <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
          <span>
            Nothing blocks this customer
            {eligibility.monthsOfHistory != null
              ? ` — ${eligibility.monthsOfHistory} month${eligibility.monthsOfHistory === 1 ? "" : "s"} of saving history.`
              : "."}
          </span>
        </p>
      )}
    </section>
  );
}
