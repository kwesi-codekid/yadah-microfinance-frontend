import { BanknoteArrowDownIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { getAccount, recordDeposit } from "~/api/susu";
import { RouteSheet, SheetCancel } from "~/components/route-sheet";
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
import { formatAmount, parseCedis, toCedisInput } from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import { requireUser, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import {
  CHANNEL_OPTIONS,
  CYCLE_TARGET,
  checkDepositAmount,
  daysCovered,
  type DepositChannel,
} from "~/lib/susu";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/susu-deposit";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Record a deposit · Yadah Dynamic Enterprise" }];
}

/**
 * Recording the cash. Open to collectors as well as the office — this is the
 * round, and it is the one susu action the API lets the field do.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request);
  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      return await getAccount(token, params.id);
    } catch (error) {
      throwAsRouteError(error);
    }
  });
  return data({ account: result.account }, { headers });
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireUser(request);
  const form = await request.formData();
  const amount = parseCedis(String(form.get("amount") ?? ""));
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");
  const channel = String(form.get("channel") ?? "cash") as DepositChannel;

  if (amount == null || amount <= 0) {
    return data({ error: "Enter the cash received." }, { status: 400 });
  }
  if (idempotencyKey.length < 8) {
    return data({ error: "Reload the page and try again." }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      recordDeposit(token, params.id, { amount, idempotencyKey, channel }),
    );
    // A replay is not a failure, but it is not a second deposit either — the
    // collector has to know which of the two just happened.
    if (result.replayed) {
      return data(
        { error: "That deposit was already recorded. Nothing was taken twice." },
        { status: 200 },
      );
    }
    const days = result.deposit.daysCovered;
    await redirectWithToast(
      `/susu/${params.id}`,
      {
        tone: "success",
        message: `GH₵ ${formatAmount(amount)} received.`,
        description: `${days} day${days === 1 ? "" : "s"} · ${result.account.depositsCount} of ${result.account.cycleTarget} in the cycle.`,
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

export default function SusuDeposit({ loaderData }: Route.ComponentProps) {
  const { account } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [amount, setAmount] = useState(() => toCedisInput(account.dailyAmount));
  const [channel, setChannel] = useState<DepositChannel>("cash");

  // Minted once per open, so a double click or a retry after a dropped
  // connection carries the same key and the API returns the first deposit
  // instead of recording a second one.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  const pesewas = parseCedis(amount);
  const issue = pesewas == null ? null : checkDepositAmount(account, pesewas);
  const days = pesewas != null && !issue ? daysCovered(account, pesewas) : 0;
  const target = account.cycleTarget || CYCLE_TARGET;
  const left = target - account.depositsCount;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo={`/susu/${account.id}`}
      title="Record a deposit"
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

          <dl className="grid grid-cols-2 gap-3">
            <Figure label="Daily amount" value={formatAmount(account.dailyAmount)} />
            <Figure
              label="Days left"
              value={`${left} of ${target}`}
              tone={left <= 3 ? "info" : undefined}
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
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              aria-invalid={issue ? true : undefined}
              className={cn("tabular text-lg", issue && "border-destructive")}
            />
            <p className={cn("text-xs", issue ? "text-destructive" : "text-muted-foreground")}>
              {issue ??
                (days > 0
                  ? `Covers ${days} day${days === 1 ? "" : "s"}.`
                  : "A whole number of days.")}
            </p>
          </div>

          {/* Catching up costs more than one day, so the quick buttons say how
              many days each is rather than making anyone do the multiplication. */}
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 7].filter((n) => n <= left).map((n) => (
              <Button
                key={n}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount(toCedisInput(account.dailyAmount * n))}
              >
                {n} day{n === 1 ? "" : "s"} · {formatAmount(account.dailyAmount * n)}
              </Button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Channel
            </Label>
            <Select
              name="channel"
              value={channel}
              onValueChange={(v) => setChannel(v as DepositChannel)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNEL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
          <SheetCancel />
          <Button type="submit" disabled={submitting || Boolean(issue) || !amount}>
            {submitting ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <BanknoteArrowDownIcon />
            )}
            Record deposit
          </Button>
        </div>
      </Form>
    </RouteSheet>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "info";
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className={cn("tabular mt-0.5 font-medium", tone === "info" && "text-info")}>
        {value}
      </dd>
    </div>
  );
}
