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
import { CollectedByFields } from "~/components/collected-by-fields";
import { OccurredOnField } from "~/components/occurred-on-field";
import { RouteSheet, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { readCollectedBy } from "~/lib/collected-by";
import { formatAmount, parseCedis, toCedisInput } from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import { MIN_BALANCE, WITHDRAWAL_FEE, checkWithdrawalAmount } from "~/lib/savings";
import { requireCounter, withAuth } from "~/lib/session.server";
import { occurredOnFromForm } from "~/lib/backdating.server";
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
  await requireCounter(request);
  return null;
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const amount = parseCedis(String(form.get("amount") ?? ""));
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");
  const occurredOn = occurredOnFromForm(form);
  const { collectedBy, error: collectorError } = readCollectedBy(form);

  if (amount == null || amount <= 0) {
    return data({ error: "Enter what the customer is taking." }, { status: 400 });
  }
  if (collectorError) {
    return data({ error: collectorError }, { status: 400 });
  }
  if (idempotencyKey.length < 8) {
    return data({ error: "Reload the page and try again." }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      recordWithdrawal(token, params.id, {
        amount,
        idempotencyKey,
        ...(occurredOn ? { occurredOn } : {}),
        ...(collectedBy ? { collectedBy } : {}),
      }),
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
        message: collectedBy
          ? `GH₵ ${formatAmount(amount)} handed to ${collectedBy.name}.`
          : `GH₵ ${formatAmount(amount)} handed over.`,
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
  const [collectorReady, setCollectorReady] = useState(true);

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

  // A fixed deposit is paid only ever to the parent who stands as its guardian.
  const fixed = account.accountType === "fixed";
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

        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
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

          {fixed && account.guardianName && (
            <p className="rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-sm">
              Pay to the guardian:{" "}
              <span className="font-semibold">{account.guardianName}</span>
            </p>
          )}

          <div className="space-y-2">
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
              className={cn("tabular h-11 text-lg", issue && "border-destructive")}
            />
            {issue && <p className="text-xs text-destructive">{issue}</p>}
            {!blocked && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={() => setAmount(toCedisInput(account.availableToWithdraw))}
              >
                Everything available · {formatAmount(account.availableToWithdraw)}
              </Button>
            )}
          </div>

          {/* A fixed deposit is only ever paid to its guardian, named above. */}
          {!fixed && (
            <CollectedByFields disabled={blocked} onReadyChange={setCollectorReady} />
          )}

          <OccurredOnField enabled={detail.backdating} noun="withdrawal" />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-6 py-4">
          <SheetCancel />
          <Button
            type="submit"
            disabled={submitting || blocked || Boolean(issue) || !amount || !collectorReady}
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
