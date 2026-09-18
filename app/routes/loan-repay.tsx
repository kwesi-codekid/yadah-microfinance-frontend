import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { getLoan, recordRepayment } from "~/api/loans";
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
import { newIdempotencyKey } from "~/lib/idempotency";
import {
  CHANNEL_OPTIONS,
  checkRepaymentAmount,
  isOpen,
  type RepaymentChannel,
} from "~/lib/loans";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/loan-repay";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Record a repayment · Yadah Dynamic Enterprise" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      return await getLoan(token, params.id);
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data(
    {
      loan: {
        id: result.loan.id,
        remaining: result.loan.remaining,
        totalDue: result.loan.totalDue,
        totalRepaid: result.loan.totalRepaid,
        customerName: result.loan.customerName ?? "",
        open: isOpen(result.loan),
      },
      /** The oldest instalment still owing — what a payment lands on first. */
      nextInstallment:
        result.schedule.find((row) => row.amountPaid < row.amountDue) ?? null,
    },
    { headers },
  );
}

interface ActionResult {
  error: string;
  code?: string;
  /** The exact balance an `EXCEEDS_BALANCE` reports, for the retry button. */
  remaining?: number;
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const amount = parseCedis(String(form.get("amount") ?? "").trim());
  const channel = String(form.get("channel") ?? "cash") as RepaymentChannel;
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");

  if (amount == null || amount <= 0) {
    return data<ActionResult>({ error: "Enter the cash received." }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof recordRepayment>>;
  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ data: result, headers } = await withAuth(request, (token) =>
      recordRepayment(token, params.id, { amount, idempotencyKey, channel }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data<ActionResult>(
        {
          error: error.message,
          code: error.code,
          // `EXCEEDS_BALANCE` carries the exact balance. Handing it back lets
          // the form offer the right figure instead of asking again blind.
          remaining: remainingFrom(error),
        },
        { status: error.status },
      );
    }
    throw error;
  }

  const settled = result.loan.status === "repaid";
  await redirectWithToast(
    `/loans/${params.id}`,
    {
      tone: "success",
      message: result.replayed
        ? "That repayment was already recorded."
        : `GH₵ ${formatAmount(amount)} recorded.`,
      description: settled
        ? result.loan.repaidOnTime
          ? "Settled in full, on time. The big tier is now unlocked."
          : "Settled in full."
        : `GH₵ ${formatAmount(result.loan.remaining)} still owing.`,
    },
    headers,
  );
}

/** The `remaining` an `EXCEEDS_BALANCE` reports, when it reports one. */
function remainingFrom(error: ApiError): number | undefined {
  // `EXCEEDS_BALANCE` is what the API sends; the older `EXCEEDS_REMAINING` is
  // still accepted so a lagging deployment keeps the retry button.
  if (error.code !== "EXCEEDS_BALANCE" && error.code !== "EXCEEDS_REMAINING") {
    return undefined;
  }
  const details = error.details;
  if (details && typeof details === "object" && "remaining" in details) {
    const value = (details as { remaining: unknown }).remaining;
    if (typeof value === "number") return value;
  }
  return undefined;
}

export default function LoanRepay({ loaderData }: Route.ComponentProps) {
  const { loan, nextInstallment } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [amount, setAmount] = useState("");

  // Minted once per open. A double click or a retry after a dropped connection
  // has to carry the same key, or the customer pays twice.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  const pesewas = parseCedis(amount);
  const fault = amount === "" ? null : checkRepaymentAmount(loan, pesewas);
  const settles = pesewas != null && !fault && pesewas === loan.remaining;
  const after = pesewas != null && !fault ? loan.remaining - pesewas : loan.remaining;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo={`/loans/${loan.id}`}
      title="Record a repayment"
      description={loan.customerName || undefined}
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

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
              {/* The API answers an overpayment with the exact balance. Offering
                  it as a button is the difference between one more attempt and
                  three. */}
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
            <Figure label="Still owing" value={formatPesewas(loan.remaining)} tone="warning" />
            <Figure
              label="Repaid so far"
              value={formatPesewas(loan.totalRepaid)}
              hint={`of ${formatPesewas(loan.totalDue)}`}
            />
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
              autoFocus
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
                  (settles
                    ? "This settles the loan in full."
                    : `Leaves GH₵ ${formatAmount(after)} owing.`)}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAmount(toCedisInput(loan.remaining))}
              >
                Settle in full
              </Button>
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

        </div>

        <SheetActions>
          <SheetCancel />
          <Button
            type="submit"
            disabled={submitting || !amount || Boolean(fault) || !loan.open}
          >
            {submitting && <Loader2Icon className="animate-spin" />}
            Record repayment
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
