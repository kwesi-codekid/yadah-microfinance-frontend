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
import { recordWithdrawal } from "~/api/savings";
import { RouteSheet, SheetCancel } from "~/components/route-sheet";
import { BalanceMeter, Figure } from "~/components/savings-bits";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatAmount, parseCedis, toCedisInput } from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import {
  MIN_BALANCE,
  WITHDRAWAL_FEE,
  balanceAfterWithdrawal,
  checkWithdrawalAmount,
} from "~/lib/savings";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { loader as detailLoader } from "./savings-detail";
import type { Route } from "./+types/savings-withdraw";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Withdraw · Yadah Dynamic Enterprise" }];
}

/**
 * Handing money back is office-only, enforced here and again by the API.
 *
 * The gate, and nothing else. The account and whether today's one withdrawal
 * has already gone are both worked out by the page underneath this drawer, so
 * asking the API again would only put a loading bar over figures already on
 * screen. It reads the parent's data instead, and opens on the click.
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
      recordWithdrawal(token, params.id, { amount, idempotencyKey }),
    );
    if (result.replayed) {
      return data(
        { error: "That withdrawal was already processed. Nothing was paid twice." },
        { status: 200 },
      );
    }
    await redirectWithToast(
      `/savings/${params.id}`,
      {
        tone: "success",
        message: `GH₵ ${formatAmount(amount)} handed over.`,
        description: `GH₵ ${formatAmount(result.txn.fee ?? WITHDRAWAL_FEE)} fee · balance now GH₵ ${formatAmount(result.account.balance)}.`,
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

export default function SavingsWithdraw() {
  const detail = useRouteLoaderData<typeof detailLoader>("routes/savings-detail");
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
  const { account, usedTodaysWithdrawal: alreadyToday } = detail;

  const pesewas = parseCedis(amount);
  const issue = amount === "" ? null : checkWithdrawalAmount(account, pesewas);
  const after =
    pesewas != null && !issue ? balanceAfterWithdrawal(account, pesewas) : null;

  const closed = account.status !== "active";
  const nothingAvailable = account.availableToWithdraw <= 0;
  const blocked = closed || alreadyToday || nothingAvailable;

  return (
    <RouteSheet
      backTo={`/savings/${account.id}`}
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

          {/* The three states that make this drawer a dead end, said before the
              cash is counted rather than after the API refuses it. */}
          {blocked && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
              <p>
                {closed
                  ? "This account is closed. Nothing more can be taken out of it."
                  : alreadyToday
                    ? "A withdrawal has already gone out today. The next one can be tomorrow."
                    : `The balance is at or under the GH₵ ${formatAmount(MIN_BALANCE)} minimum plus the fee, so there is nothing to give up. Closing the account is the only way to release it.`}
              </p>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Balance
            </p>
            <p className="tabular mt-0.5 text-2xl font-bold">
              GH₵ {formatAmount(account.balance)}
            </p>
            <BalanceMeter
              className="mt-3"
              balance={account.balance}
              available={account.availableToWithdraw}
            />
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
            <p className={cn("text-xs", issue ? "text-destructive" : "text-muted-foreground")}>
              {issue ??
                `Up to GH₵ ${formatAmount(account.availableToWithdraw)}. The fee comes off on top.`}
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

          {/* What the drawer and the account each end up with. The fee is the
              part customers dispute, so it is a line of its own, not a footnote. */}
          <dl className="grid grid-cols-3 gap-3">
            <Figure
              label="Customer gets"
              value={pesewas != null && !issue ? formatAmount(pesewas) : "—"}
              tone={pesewas != null && !issue ? "success" : "muted"}
            />
            <Figure
              label="Fee"
              value={formatAmount(WITHDRAWAL_FEE)}
              tone="warning"
              hint="Flat"
            />
            <Figure
              label="Balance after"
              value={after != null ? formatAmount(after) : "—"}
              tone={after != null ? undefined : "muted"}
              hint={after != null ? `GH₵ ${formatAmount(MIN_BALANCE)} held` : undefined}
            />
          </dl>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
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
        </div>
      </Form>
    </RouteSheet>
  );
}
