import { BanknoteArrowUpIcon, Loader2Icon } from "lucide-react";
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
import { withdraw, withdrawAll } from "~/api/susu";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { LockMeter } from "~/components/susu-bits";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatAmount, parseCedis } from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import { checkWithdrawalAmount, planLabel, withdrawAllPreview } from "~/lib/susu";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { loader as detailLoader } from "./susu-detail";
import type { Route } from "./+types/susu-withdraw";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Withdraw · Yadah Dynamic Enterprise" }];
}

/**
 * Money out, account open — the same errand as a savings withdrawal. Part of
 * the balance: anything that leaves the commission due behind, which is what
 * `availableToWithdraw` already is. Everything: the cycles in progress end,
 * their commission moves to Yadah, and the customer takes the rest (client
 * decision, 7 Oct 2026).
 *
 * Counter work. The gate is all this loader does: the account is already on
 * the page underneath.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireCounter(request);
  return null;
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const everything = form.get("intent") === "all";
  const amount = parseCedis(String(form.get("amount") ?? ""));
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");

  if (idempotencyKey.length < 8) {
    return data({ error: "Reload the page and try again." }, { status: 400 });
  }
  if (!everything && (amount == null || amount <= 0)) {
    return data({ error: "Enter what the customer is taking." }, { status: 400 });
  }

  if (everything) {
    try {
      const { data: result, headers } = await withAuth(request, (token) =>
        withdrawAll(token, params.id, { idempotencyKey }),
      );
      if (result.replayed || !result.account || result.amount == null) {
        return redirectWithToast(
          `/susu/${params.id}`,
          {
            tone: "success",
            message: "That withdrawal was already processed.",
            description: "Nothing was paid twice.",
          },
          headers,
        );
      }
      await redirectWithToast(
        `/susu/${params.id}`,
        {
          tone: "success",
          message: `GH₵ ${formatAmount(result.amount)} handed over — everything.`,
          description:
            (result.commission ?? 0) > 0
              ? `GH₵ ${formatAmount(result.commission ?? 0)} commission moved to Yadah. The cycles in progress have ended; the next deposit starts new ones.`
              : "No cycle was in progress, so no commission was due.",
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

  if (amount == null) {
    return data({ error: "Enter what the customer is taking." }, { status: 400 });
  }
  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      withdraw(token, params.id, { amount, idempotencyKey }),
    );
    if (result.replayed || !result.account || result.amount == null) {
      return redirectWithToast(
        `/susu/${params.id}`,
        {
          tone: "success",
          message: "That withdrawal was already processed.",
          description: "Nothing was paid twice.",
        },
        headers,
      );
    }
    await redirectWithToast(
      `/susu/${params.id}`,
      {
        tone: "success",
        message: `GH₵ ${formatAmount(result.amount)} handed over.`,
        // Which plans gave what, and the days it cost each — the money walked
        // them, so the counter is told where it came from.
        description: [
          ...(result.lines ?? []).map(
            (l) =>
              `GH₵ ${formatAmount(l.amount)} off ${planLabel(l)}${
                l.paymentsRemoved > 0
                  ? ` (${l.paymentsRemoved} payment${l.paymentsRemoved === 1 ? "" : "s"})`
                  : ""
              }`,
          ),
          ...(result.loose ? [`GH₵ ${formatAmount(result.loose)} from the loose balance`] : []),
          `GH₵ ${formatAmount(result.account.balance)} still in the account`,
        ].join(" · "),
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
  const [everything, setEverything] = useState(false);
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  const account = detail?.account ?? null;
  const closed = account ? account.status !== "active" : false;
  const nothingAvailable = account ? account.availableToWithdraw <= 0 : false;
  const blocked = closed || nothingAvailable;
  const balance = account?.balance ?? 0;

  // What stands in the way is said once, as a toast, when the drawer opens.
  // The form itself is the one field.
  useEffect(() => {
    if (closed) {
      toast.warning("This account is closed. Nothing more can be taken out of it.");
    } else if (nothingAvailable) {
      toast.warning(
        balance > 0
          ? `What is in the account — GH₵ ${formatAmount(balance)} — is the commission due on the cycles in progress.`
          : "There is nothing in the account to withdraw.",
      );
    }
  }, [closed, nothingAvailable, balance]);

  if (!account) return null;

  const pesewas = parseCedis(amount);
  const issue = everything || amount === "" ? null : checkWithdrawalAmount(account, pesewas);
  const all = withdrawAllPreview(account);

  return (
    <RouteSheet backTo={`/susu/${account.id}`} title="Withdraw">
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        {everything && <input type="hidden" name="intent" value="all" />}

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {!blocked && (
            <LockMeter
              balance={account.balance}
              available={account.availableToWithdraw}
              locked={account.locked}
            />
          )}

          {everything ? (
            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Withdraw everything
              </p>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt>Cash to the customer</dt>
                  <dd className="tabular font-semibold">GH₵ {formatAmount(all.cash)}</dd>
                </div>
                <div className="flex justify-between gap-4 text-muted-foreground">
                  <dt>Commission to Yadah</dt>
                  <dd className="tabular">GH₵ {formatAmount(all.commission)}</dd>
                </div>
              </dl>
              {all.commission > 0 && (
                <p className="text-xs text-muted-foreground">
                  The cycles in progress end here, one day of each plan's amount going to Yadah.
                  The plans keep running — the next deposit starts their new cycles.
                </p>
              )}
              <Button type="button" variant="link" className="h-auto p-0" onClick={() => setEverything(false)}>
                Withdraw part instead
              </Button>
            </div>
          ) : (
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
                // A wrong figure is said when they leave the field, not on
                // every keystroke on the way to a right one.
                onBlur={() => {
                  if (issue) toast.error(issue);
                }}
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                disabled={blocked}
                aria-invalid={issue ? true : undefined}
                className={cn("tabular text-lg", issue && "border-destructive")}
              />
              {!blocked && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  onClick={() => setEverything(true)}
                >
                  Withdraw everything · GH₵ {formatAmount(all.cash)}
                </Button>
              )}
            </div>
          )}
        </div>

        <SheetActions>
          <SheetCancel />
          <Button
            type="submit"
            disabled={submitting || blocked || Boolean(issue) || (!everything && !amount)}
          >
            {submitting ? <Loader2Icon className="animate-spin" /> : <BanknoteArrowUpIcon />}
            {everything ? `Hand over GH₵ ${formatAmount(all.cash)}` : "Hand over cash"}
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
