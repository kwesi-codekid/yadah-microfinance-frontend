import { ArrowRightLeftIcon, Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { data, Form, useActionData, useNavigation, useRouteLoaderData } from "react-router";
import { toast } from "sonner";

import { listCashAccounts } from "~/api/accounting";
import { moveCommission } from "~/api/commissions";
import { ApiError } from "~/api/error";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { DateField } from "~/components/ui/date-field";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { accraDay, formatAmount, formatPesewas, parseCedis, toCedisInput } from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { loader as pageLoader } from "./commissions";
import type { Route } from "./+types/commission-move";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Move commission · Yadah Dynamic Enterprise" }];
}

/** The cash accounts it can go to — the page underneath already holds the balance. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const { data: accounts, headers } = await withAuth(request, (token) => listCashAccounts(token));
  return data(
    {
      accounts: accounts
        .filter((a) => (a.status ?? "active") === "active")
        .map((a) => ({ id: a.id, name: a.name })),
    },
    { headers },
  );
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Commission into one of the company's cash accounts: the commission account
 * goes down, that account goes up, the company's cash total stays where it
 * was (client decision, 7 Oct 2026).
 */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const amount = parseCedis(String(form.get("amount") ?? ""));
  const cashAccountId = String(form.get("cashAccountId") ?? "").trim();
  const occurredOn = String(form.get("occurredOn") ?? "").trim();
  const note = String(form.get("note") ?? "").trim();
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");

  if (amount == null || amount < 1) {
    return data({ error: "Enter how much to move." }, { status: 400 });
  }
  if (!cashAccountId) {
    return data({ error: "Pick the cash account it goes to." }, { status: 400 });
  }
  if (occurredOn && (!DAY_RE.test(occurredOn) || occurredOn > accraDay())) {
    return data({ error: "Pick a day up to today." }, { status: 400 });
  }
  if (idempotencyKey.length < 8) {
    return data({ error: "Reload the page and try again." }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      moveCommission(token, {
        amount,
        cashAccountId,
        idempotencyKey,
        ...(occurredOn ? { occurredOn } : {}),
        ...(note ? { note } : {}),
      }),
    );
    const back = new URL(request.url).search;
    return redirectWithToast(
      `/commissions?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(back)), view: "moves" }).toString()}`,
      {
        tone: "success",
        message: result.replayed
          ? "That move was already recorded."
          : `${formatPesewas(result.move.amount)} moved to ${result.move.cashAccountName ?? "the cash account"}.`,
        description: `${formatPesewas(result.balance)} left in the commission account.`,
      },
      headers,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export default function CommissionMoveDrawer({ loaderData }: Route.ComponentProps) {
  const { accounts } = loaderData;
  const page = useRouteLoaderData<typeof pageLoader>("routes/commissions");
  const balance = page?.summary.balance ?? 0;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [amount, setAmount] = useState("");
  const [to, setTo] = useState(accounts[0]?.id ?? "");
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  useEffect(() => {
    if (accounts.length === 0) {
      toast.warning("There is no cash account to move it to.", {
        description: "Open one under Accounting first.",
      });
    }
  }, [accounts.length]);

  const pesewas = parseCedis(amount);
  const tooMuch = pesewas != null && pesewas > balance;
  const blocked = balance <= 0 || accounts.length === 0;

  return (
    <RouteSheet backTo="/commissions" title="Move to a cash account">
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="cashAccountId" value={to} />

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              In the commission account
            </p>
            <p className="tabular mt-0.5 text-2xl font-bold">GH₵ {formatAmount(balance)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The commission account goes down and the cash account goes up by the same amount.
              The company's cash total does not change.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="amount"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Amount · GH₵<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="amount"
              name="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onBlur={() => {
                if (tooMuch) toast.error(`At most GH₵ ${formatAmount(balance)} can be moved.`);
              }}
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              disabled={blocked}
              aria-invalid={tooMuch ? true : undefined}
              className={cn("tabular text-lg", tooMuch && "border-destructive")}
            />
            {!blocked && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={() => setAmount(toCedisInput(balance))}
              >
                All of it · GH₵ {formatAmount(balance)}
              </Button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="to"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              To<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select value={to} onValueChange={setTo} disabled={blocked}>
              <SelectTrigger id="to" className="w-full">
                <SelectValue placeholder="Pick a cash account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="occurredOn"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Moved on
            </Label>
            <DateField
              id="occurredOn"
              name="occurredOn"
              defaultValue={accraDay()}
              endMonth={new Date()}
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="note"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Note
            </Label>
            <Input id="note" name="note" maxLength={300} autoComplete="off" disabled={blocked} />
          </div>
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting || blocked || tooMuch || !amount || !to}>
            {submitting ? <Loader2Icon className="animate-spin" /> : <ArrowRightLeftIcon />}
            Move it
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
