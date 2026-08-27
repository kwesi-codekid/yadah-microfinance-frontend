import { InfoIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { getAgreement, recordDeposit, recordPayment } from "~/api/hire-purchase";
import { Figure } from "~/components/listing";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
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
import {
  CHANNEL_OPTIONS,
  awaitingDeposit,
  checkDeposit,
  checkPayment,
  isRunning,
  type PaymentChannel,
} from "~/lib/hire-purchase";
import { newIdempotencyKey } from "~/lib/idempotency";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/hp-pay";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `${loaderData?.deposit ? "Record the deposit" : "Record a payment"} · Yadah Dynamic Enterprise`,
    },
  ];
}

/**
 * One drawer for both kinds of money on an agreement, because from the
 * counter's side they are the same errand — cash comes in against a contract.
 * What differs is the rule, and the rules are opposites: a deposit has to match
 * exactly, and an instalment may be anything up to the balance.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOffice(request);

  const { data: agreement, headers } = await withAuth(request, async (token) => {
    try {
      const result = await getAgreement(token, params.id);
      return result.agreement;
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data(
    {
      id: agreement.id,
      itemName: agreement.item.name,
      customerName: agreement.customerName ?? "",
      /** True while the 50% is still outstanding. */
      deposit: awaitingDeposit(agreement),
      running: isRunning(agreement),
      depositRequired: agreement.depositRequired,
      remaining: agreement.remaining,
      totalPaid: agreement.totalPaid,
      totalPayable: agreement.totalPayable ?? 0,
    },
    { headers },
  );
}

interface ActionResult {
  error: string;
  code?: string;
  /** The exact balance an `EXCEEDS_REMAINING` reports, for the retry button. */
  remaining?: number;
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const kind = String(form.get("kind") ?? "payment");
  const amount = parseCedis(String(form.get("amount") ?? "").trim());
  const channel = String(form.get("channel") ?? "cash") as PaymentChannel;
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");

  if (amount == null || amount <= 0) {
    return data<ActionResult>({ error: "Enter the cash received." }, { status: 400 });
  }

  let result: { agreement: { remaining: number; status: string }; replayed: boolean };
  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ data: result, headers } = await withAuth(request, (token) =>
      kind === "deposit"
        ? recordDeposit(token, params.id, { amount, idempotencyKey, channel })
        : recordPayment(token, params.id, { amount, idempotencyKey, channel }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data(
        { error: error.message, code: error.code, remaining: remainingFrom(error) },
        { status: error.status },
      );
    }
    throw error;
  }

  await redirectWithToast(
    `/hire-purchase/${params.id}`,
    {
      tone: "success",
      message: result.replayed
        ? "That payment was already recorded."
        : kind === "deposit"
          ? `Deposit of GH₵ ${formatAmount(amount)} recorded.`
          : `GH₵ ${formatAmount(amount)} recorded.`,
      description:
        kind === "deposit"
          ? "The item can go out with the customer now."
          : result.agreement.remaining === 0
            ? "Settled in full. The item is the customer's."
            : `GH₵ ${formatAmount(result.agreement.remaining)} still owing.`,
    },
    headers,
  );
}

/** The `remaining` an `EXCEEDS_REMAINING` reports, when it reports one. */
function remainingFrom(error: ApiError): number | undefined {
  if (error.code !== "EXCEEDS_REMAINING") return undefined;
  const details = error.details;
  if (details && typeof details === "object" && "remaining" in details) {
    const value = (details as { remaining: unknown }).remaining;
    if (typeof value === "number") return value;
  }
  return undefined;
}

export default function HpPay({ loaderData }: Route.ComponentProps) {
  const agreement = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const isDeposit = agreement.deposit;

  // The deposit has exactly one right answer, so the box starts on it. An
  // instalment does not, so it starts empty.
  const [amount, setAmount] = useState(
    isDeposit ? toCedisInput(agreement.depositRequired) : "",
  );

  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  const pesewas = parseCedis(amount);
  const fault =
    amount === ""
      ? null
      : isDeposit
        ? checkDeposit(agreement, pesewas)
        : checkPayment(agreement, pesewas);

  const settles =
    !isDeposit && pesewas != null && !fault && pesewas === agreement.remaining;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo={`/hire-purchase/${agreement.id}`}
      title={isDeposit ? "Record the deposit" : "Record a payment"}
      description={
        agreement.customerName
          ? `${agreement.customerName} · ${agreement.itemName}`
          : agreement.itemName
      }
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="kind" value={isDeposit ? "deposit" : "payment"} />

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {actionData?.error && (
            <div
              role="alert"
              className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <p className="flex items-start gap-2 font-medium">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                {actionData.error}
              </p>
              {actionData.remaining !== undefined && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setAmount(toCedisInput(actionData.remaining!))}
                >
                  Use GH₵ {formatAmount(actionData.remaining)}
                </Button>
              )}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-3">
            {isDeposit ? (
              <Figure
                label="Deposit required"
                value={formatPesewas(agreement.depositRequired)}
                hint="Exactly half the selling price"
                tone="warning"
                className="col-span-2"
              />
            ) : (
              <>
                <Figure
                  label="Still owing"
                  value={formatPesewas(agreement.remaining)}
                  tone="warning"
                />
                <Figure
                  label="Paid so far"
                  value={formatPesewas(agreement.totalPaid)}
                  hint={
                    agreement.totalPayable
                      ? `of ${formatPesewas(agreement.totalPayable)}`
                      : undefined
                  }
                />
              </>
            )}
          </dl>

          <div className="space-y-1.5">
            <Label
              htmlFor="amount"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Cash received · GH₵<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="amount"
              name="amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
              autoFocus={!isDeposit}
              aria-invalid={fault ? true : undefined}
              className={cn("tabular", fault && "border-destructive")}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p
                className={cn(
                  "text-xs",
                  fault ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {fault ??
                  (isDeposit
                    ? "This releases the item. It has to match to the pesewa."
                    : settles
                      ? "This settles the agreement. The item becomes the customer's."
                      : pesewas != null
                        ? `Leaves GH₵ ${formatAmount(agreement.remaining - pesewas)} owing.`
                        : "Anything up to the balance. Oldest instalment first.")}
              </p>
              {!isDeposit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAmount(toCedisInput(agreement.remaining))}
                >
                  Settle in full
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Channel
            </Label>
            <Select name="channel" defaultValue="cash">
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {isDeposit
                ? "The customer is sent an SMS receipt and the item is released. Anything other than the exact deposit is refused."
                : "Interest is flat and was applied once at activation, so paying early costs the same as paying to term. Clearing every month-overdue instalment lifts an arrears flag on its own."}
            </span>
          </div>
        </div>

        <SheetActions>
          <SheetCancel />
          <Button
            type="submit"
            disabled={
              submitting ||
              !amount ||
              Boolean(fault) ||
              (!isDeposit && !agreement.running)
            }
          >
            {submitting && <Loader2Icon className="animate-spin" />}
            {isDeposit ? "Record deposit and release item" : "Record payment"}
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
