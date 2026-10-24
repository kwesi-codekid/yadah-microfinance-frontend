import { BanknoteArrowDownIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { data, Form, useActionData, useNavigation, useRouteLoaderData } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { recordDeposit } from "~/api/susu-loans";
import { RouteSheet, SheetCancel } from "~/components/route-sheet";
import { Figure } from "~/components/savings-bits";
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
import { CHANNEL_OPTIONS, type SavingsChannel } from "~/lib/savings";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { loader as detailLoader } from "./susu-loan-detail";
import type { Route } from "./+types/susu-loan-deposit";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Record a deposit · Yadah Dynamic Enterprise" }];
}

/**
 * Money paid into the susu loan account — any amount, at the office only
 * (client decision, 23 Oct 2026). No loader, like the savings deposit drawer:
 * the account page underneath has already checked who is asking, and the
 * action checks again.
 *
 * A loan that is behind takes the money at once, so the balance after can be
 * less than before plus the deposit; the toast says what went to the loan.
 */
export async function action({ request, params }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const amount = parseCedis(String(form.get("amount") ?? ""));
  const before = Number(form.get("balanceBefore") ?? 0);
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");
  const channel = String(form.get("channel") ?? "cash") as SavingsChannel;

  if (amount == null || amount <= 0) {
    return data({ error: "Enter the amount received." }, { status: 400 });
  }
  if (idempotencyKey.length < 8) {
    return data({ error: "Reload the page and try again." }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      recordDeposit(token, params.id, { amount, idempotencyKey, channel }),
    );
    if (result.replayed) {
      return data(
        { error: "That deposit was already recorded. Nothing was taken twice." },
        { status: 200 },
      );
    }
    const toLoan = before + amount - result.account.balance;
    await redirectWithToast(
      `/susu-loans/${params.id}`,
      {
        tone: "success",
        message: `GH₵ ${formatAmount(amount)} received.`,
        description:
          toLoan > 0
            ? `GH₵ ${formatAmount(toLoan)} went straight to the loan. Balance is GH₵ ${formatAmount(result.account.balance)}.`
            : `Balance is now GH₵ ${formatAmount(result.account.balance)}.`,
      },
      headers,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export default function SusuLoanDeposit() {
  const detail = useRouteLoaderData<typeof detailLoader>("routes/susu-loan-detail");
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState<SavingsChannel>("cash");
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  if (!detail) return null;
  const { account } = detail;

  const pesewas = parseCedis(amount);
  const issue = amount === "" ? null : pesewas == null || pesewas <= 0 ? "Enter an amount." : null;
  const after = pesewas != null && !issue ? account.balance + pesewas : null;
  const closed = account.status !== "active";

  return (
    <RouteSheet
      backTo={`/susu-loans/${account.id}`}
      title="Record a deposit"
      description={`#${account.accountNumber} · ${account.customerName ?? "Customer"}`}
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="balanceBefore" value={account.balance} />

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

          {closed && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
              <p>This account is closed. Nothing more can be paid into it.</p>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-3">
            <Figure label="Balance now" value={formatAmount(account.balance)} />
            <Figure
              label="After this"
              value={after != null ? formatAmount(after) : "—"}
              tone={after != null ? "success" : "muted"}
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
              {issue ?? "Any amount. If the loan is behind, it takes this straight away."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {[1000, 2000, 5000, 10000].map((n) => (
              <Button
                key={n}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount(toCedisInput(n))}
              >
                {formatAmount(n)}
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
              onValueChange={(v) => setChannel(v as SavingsChannel)}
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
          <Button type="submit" disabled={submitting || closed || Boolean(issue) || !amount}>
            {submitting ? <Loader2Icon className="animate-spin" /> : <BanknoteArrowDownIcon />}
            Record deposit
          </Button>
        </div>
      </Form>
    </RouteSheet>
  );
}
