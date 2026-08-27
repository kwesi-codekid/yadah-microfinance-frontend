import { BanknoteArrowUpIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  data,
  Form,
  useActionData,
  useNavigation,
  useRouteLoaderData,
} from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { withdraw } from "~/api/susu";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatAmount, parseCedis, toCedisInput } from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import { balanceAfterWithdrawal, checkWithdrawalAmount } from "~/lib/susu";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { loader as detailLoader } from "./susu-detail";
import type { Route } from "./+types/susu-withdraw";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Withdraw · Yadah Dynamic Enterprise" }];
}

/**
 * Handing part of a susu balance back without stopping the cycle.
 *
 * The rule this drawer exists for changed on the API in August 2026: a
 * withdrawal used to close the account, and now it does not. Everything that
 * follows from that is worth saying on screen rather than leaving people to
 * infer it — the days already paid stay paid, no commission is taken here, and
 * one day's amount has to stay behind so the closing commission is still
 * collectible when the cycle does end.
 *
 * Office-only, enforced here and again by the API. The gate is all this loader
 * does: the account is already on the page underneath, so asking for it again
 * would put a loading bar over figures that are on screen.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  return null;
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const amount = parseCedis(String(form.get("amount") ?? ""));
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");

  if (amount == null || amount <= 0) {
    return data({ error: "Enter what the customer is taking." }, { status: 400 });
  }
  if (idempotencyKey.length < 8) {
    return data({ error: "Reload the page and try again." }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      withdraw(token, params.id, { amount, idempotencyKey }),
    );
    if (result.replayed) {
      return data(
        { error: "That withdrawal was already processed. Nothing was paid twice." },
        { status: 200 },
      );
    }
    await redirectWithToast(
      `/susu/${params.id}`,
      {
        tone: "success",
        message: `GH₵ ${formatAmount(result.amount)} handed over.`,
        description: `The account stays open · GH₵ ${formatAmount(result.account.balance)} still held.`,
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

export default function SusuWithdraw() {
  const detail = useRouteLoaderData<typeof detailLoader>("routes/susu-detail");
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [amount, setAmount] = useState("");

  // One intent, one key: a retry after a dropped connection must not pay the
  // customer twice.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  // Only ever rendered inside the account page, which is what holds the
  // account. Nothing to draw without it.
  if (!detail) return null;
  const { account } = detail;

  const pesewas = parseCedis(amount);
  const issue = amount === "" ? null : checkWithdrawalAmount(account, pesewas);
  const after =
    pesewas != null && !issue ? balanceAfterWithdrawal(account, pesewas) : null;

  const stopped = account.status === "closed" || account.status === "terminated";
  const nothingAvailable = account.availableToWithdraw <= 0;
  const blocked = stopped || nothingAvailable;

  return (
    <RouteSheet
      backTo={`/susu/${account.id}`}
      title="Withdraw"
      description={`#${account.accountNumber} · ${account.customerName ?? "Customer"}`}
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

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

          {/* The two states that make this drawer a dead end, said before the
              cash is counted rather than after the API refuses it. */}
          {blocked && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
              <p>
                {stopped
                  ? "This account has stopped. Nothing more can be taken out of it."
                  : `Only GH₵ ${formatAmount(account.dailyAmount)} is in, and one day's amount has to stay behind to cover the closing commission. Closing or terminating the account is the way to release it.`}
              </p>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Held in the account
            </p>
            <p className="tabular mt-0.5 text-2xl font-bold">
              GH₵ {formatAmount(account.balance)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              GH₵ {formatAmount(account.totalDeposited)} paid in over{" "}
              {account.depositsCount} day{account.depositsCount === 1 ? "" : "s"}
              {account.withdrawnAmount > 0
                ? `, GH₵ ${formatAmount(account.withdrawnAmount)} already taken out.`
                : "."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="amount"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Cash to hand over · GH₵<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="amount"
              name="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              disabled={blocked}
              aria-invalid={issue ? true : undefined}
              className={cn("tabular text-lg", issue && "border-destructive")}
            />
            <p
              className={cn(
                "text-xs",
                issue ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {issue ??
                `Up to GH₵ ${formatAmount(account.availableToWithdraw)}. No fee, and no commission is taken here.`}
            </p>
          </div>

          {!blocked && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAmount(toCedisInput(account.availableToWithdraw))}
            >
              Everything available · {formatAmount(account.availableToWithdraw)}
            </Button>
          )}

          <dl className="grid grid-cols-3 gap-3">
            <Figure
              label="Customer gets"
              value={pesewas != null && !issue ? formatAmount(pesewas) : "—"}
              tone={pesewas != null && !issue ? "success" : "muted"}
            />
            <Figure
              label="Still held"
              value={after != null ? formatAmount(after) : "—"}
              tone={after != null ? undefined : "muted"}
              hint={
                after != null
                  ? `GH₵ ${formatAmount(account.dailyAmount)} reserved`
                  : undefined
              }
            />
            <Figure
              label="Cycle"
              value={`Day ${account.depositsCount} of ${account.cycleTarget}`}
              tone="muted"
              hint="Unchanged"
            />
          </dl>

          {/* The part people get wrong, because the old rule was the opposite:
              this does not end the cycle and does not take the commission. */}
          <p className="rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-sm">
            The account stays open and the cycle is untouched — days already paid
            stay paid. The commission is one day's amount and is charged once, at
            closing, which is why that much has to stay in.
          </p>
        </div>

        <SheetActions>
          <SheetCancel />
          <Button
            type="submit"
            disabled={submitting || blocked || Boolean(issue) || !amount}
          >
            {submitting ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <BanknoteArrowUpIcon />
            )}
            Hand over cash
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}

/** A labelled figure in the summary row. Local: the susu shape, not savings'. */
function Figure({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "success" | "muted";
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <dt className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "tabular mt-0.5 font-semibold",
          tone === "success" && "text-primary",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </dd>
      {hint && <p className="mt-0.5 text-[0.65rem] text-muted-foreground">{hint}</p>}
    </div>
  );
}
