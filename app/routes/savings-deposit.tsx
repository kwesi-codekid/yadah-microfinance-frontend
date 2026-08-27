import { BanknoteArrowDownIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
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
import { recordDeposit } from "~/api/savings";
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
import {
  CHANNEL_OPTIONS,
  MIN_BALANCE,
  MIN_DEPOSIT,
  checkDepositAmount,
  type SavingsChannel,
} from "~/lib/savings";
import { requireUser, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { loader as detailLoader } from "./savings-detail";
import type { Route } from "./+types/savings-deposit";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Record a deposit · Yadah Dynamic Enterprise" }];
}

/**
 * Taking money in. Open to collectors as well as the office — this is the one
 * savings action the API lets the field do.
 *
 * No loader on purpose, and it is the loader's *absence* that makes the drawer
 * open on the click rather than after a wait. A route that exports one is a
 * route the router has to ask the server about before it can render, so every
 * click put a request on the wire and the progress bar across the top — for a
 * page that was not going anywhere. Without one the router skips this route in
 * the data request entirely and the drawer is pure client-side render.
 *
 * Nothing is given away by dropping it. The account page underneath has already
 * run `requireUser`, so a signed-out deep link is redirected before this can
 * render, and this drawer is open to every role that may see that page. The
 * `action` below re-checks anyway — that is where the gate has to hold.
 */

export async function action({ request, params }: Route.ActionArgs) {
  await requireUser(request);
  const form = await request.formData();
  const amount = parseCedis(String(form.get("amount") ?? ""));
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");
  const channel = String(form.get("channel") ?? "cash") as SavingsChannel;

  const issue = checkDepositAmount(amount);
  if (issue) return data({ error: issue }, { status: 400 });
  if (idempotencyKey.length < 8) {
    return data({ error: "Reload the page and try again." }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      recordDeposit(token, params.id, { amount: amount!, idempotencyKey, channel }),
    );
    // A replay is not a failure, but it is not a second deposit either — the
    // person at the counter has to know which of the two just happened.
    if (result.replayed) {
      return data(
        { error: "That deposit was already recorded. Nothing was taken twice." },
        { status: 200 },
      );
    }
    await redirectWithToast(
      `/savings/${params.id}`,
      {
        tone: "success",
        message: `GH₵ ${formatAmount(amount!)} received.`,
        description: `Balance is now GH₵ ${formatAmount(result.account.balance)}.`,
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

export default function SavingsDeposit() {
  const detail = useRouteLoaderData<typeof detailLoader>("routes/savings-detail");
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState<SavingsChannel>("cash");

  // Minted once per open, so a double click or a retry after a dropped
  // connection carries the same key and the API returns the first deposit
  // instead of crediting the account twice.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  // Only ever rendered inside the account page, which is what holds the
  // account. Nothing to draw without it.
  if (!detail) return null;
  const { account } = detail;

  const pesewas = parseCedis(amount);
  const issue = amount === "" ? null : checkDepositAmount(pesewas);
  const after = pesewas != null && !issue ? account.balance + pesewas : null;
  const closed = account.status !== "active";

  return (
    <RouteSheet
      backTo={`/savings/${account.id}`}
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
              {issue ?? `Anything from GH₵ ${formatAmount(MIN_DEPOSIT)} up.`}
            </p>
          </div>

          {/* The amounts a branch actually hears across the counter. The first
              is the floor, the last is what clears the minimum in one go. */}
          <div className="flex flex-wrap gap-2">
            {[MIN_DEPOSIT, 2000, 5000, 10000].map((n) => (
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

          {/* Below the minimum the balance is real but untouchable, which is
              worth saying before the customer asks for it back tomorrow. */}
          {after != null && after < MIN_BALANCE && (
            <p className="text-xs text-muted-foreground">
              At GH₵ {formatAmount(after)} the account is still under the GH₵{" "}
              {formatAmount(MIN_BALANCE)} minimum, so none of it can be
              withdrawn yet.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
          <SheetCancel />
          <Button
            type="submit"
            disabled={submitting || closed || Boolean(issue) || !amount}
          >
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
