import {
  BanknoteArrowDownIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { getCustomer } from "~/api/customers";
import { getAccount, recordDeposit } from "~/api/susu";
import { OccurredOnField } from "~/components/occurred-on-field";
import { PlanPicker } from "~/components/plan-picker";
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
import { backdatingEnabled, occurredOnFromForm } from "~/lib/backdating.server";
import { newIdempotencyKey } from "~/lib/idempotency";
import { requireUser, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import {
  CHANNEL_OPTIONS,
  activePlans,
  checkDeposit,
  coveredAmount,
  planLabel,
  type DepositChannel,
  type DepositSplit,
  type SusuPlan,
} from "~/lib/susu";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/susu-deposit";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Record a deposit · Yadah Dynamic Enterprise" }];
}

/**
 * Recording the cash. Open to collectors as well as the office — this is the
 * round, and it is the one susu action the API lets the field do.
 *
 * Its own loader, because the field app opens this drawer straight from the
 * round sheet without the account page underneath it.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request);
  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const { account } = await getAccount(token, params.id);
      // The detail endpoint omits the name; the drawer's subtitle wants it.
      const customer = await getCustomer(token, account.customerId)
        .then((r) => r.customer)
        .catch(() => null);
      return { account: { ...account, customerName: customer?.fullName ?? account.customerName } };
    } catch (error) {
      throwAsRouteError(error);
    }
  });
  return data({ account: result.account, backdating: backdatingEnabled() }, { headers });
}

/** The split travels as `payments:<planId>=<n>` fields, one, since the form takes one plan at a time. */
function splitFromForm(form: FormData): DepositSplit[] {
  const out: DepositSplit[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("payments:")) continue;
    const payments = Number(value);
    if (Number.isInteger(payments) && payments >= 0) {
      out.push({ planId: key.slice("payments:".length), payments });
    }
  }
  return out;
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireUser(request);
  const form = await request.formData();
  const amount = parseCedis(String(form.get("amount") ?? ""));
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");
  const channel = String(form.get("channel") ?? "cash") as DepositChannel;
  const occurredOn = occurredOnFromForm(form);
  const split = splitFromForm(form);

  if (amount == null || amount <= 0) {
    return data({ error: "Enter the cash received." }, { status: 400 });
  }
  if (idempotencyKey.length < 8) {
    return data({ error: "Reload the page and try again." }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      recordDeposit(token, params.id, {
        amount,
        split,
        idempotencyKey,
        channel,
        ...(occurredOn ? { occurredOn } : {}),
      }),
    );
    if (result.replayed) {
      return data(
        { error: "That deposit was already recorded. Nothing was taken twice." },
        { status: 200 },
      );
    }
    const completed = result.deposit.lines.filter((l) => l.completesCycle).length;
    const progress = result.account.plans
      .filter((p) => p.status === "active")
      .map((p) => `${formatAmount(p.dailyAmount)}: ${p.paidInCycle} of ${p.cycleTarget}`)
      .join(" · ");
    await redirectWithToast(
      `/susu/${params.id}`,
      {
        tone: "success",
        message:
          completed > 0
            ? `GH₵ ${formatAmount(amount)} received — ${completed === 1 ? "a cycle" : `${completed} cycles`} completed.`
            : `GH₵ ${formatAmount(amount)} received.`,
        description:
          (completed > 0
            ? `GH₵ ${formatAmount(result.deposit.commissionAmount)} commission taken. `
            : "") + progress,
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
  const { account, backdating } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  // One plan at a time: the collector picks which plan this cash is for and
  // the cash itself says how many payments it buys there — whole payments at
  // the plan's daily amount, the remainder staying in the balance. A customer
  // paying on two plans is two deposits, each with its own receipt.
  const plans = activePlans(account);
  const [planId, setPlanId] = useState<string | null>(() => plans[0]?.id ?? null);
  const plan = plans.find((p) => p.id === planId) ?? null;

  // The form opens at one payment on the plan. Changing the plan moves the
  // figure with it until somebody types a figure of their own.
  const [amount, setAmount] = useState(() => (plan ? toCedisInput(plan.dailyAmount) : ""));
  const [amountTouched, setAmountTouched] = useState(false);
  const [channel, setChannel] = useState<DepositChannel>("cash");

  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  const pesewas = parseCedis(amount);
  const payments =
    plan && pesewas != null && pesewas > 0 ? Math.floor(pesewas / plan.dailyAmount) : 0;
  const split: DepositSplit[] = plan ? [{ planId: plan.id, payments }] : [];
  const covered = coveredAmount(account, split);
  const issue =
    plan && pesewas != null && pesewas > 0 && payments === 0
      ? `At least GH₵ ${formatAmount(plan.dailyAmount)} — one payment on this plan.`
      : checkDeposit(account, split, pesewas);
  const leftover = pesewas != null && !issue ? pesewas - covered : 0;
  const closed = account.status !== "active";
  const noPlans = plans.length === 0;

  const choosePlan = (nextPlanId: string) => {
    setPlanId(nextPlanId);
    const next = plans.find((p) => p.id === nextPlanId);
    if (!amountTouched && next) setAmount(toCedisInput(next.dailyAmount));
  };

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo={`/susu/${account.id}`}
      title="Record a deposit"
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        {plan && <input type="hidden" name={`payments:${plan.id}`} value={payments} />}

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

          {(closed || noPlans) && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
              <p>
                {closed
                  ? "This account is closed. Nothing more can be paid into it."
                  : "No plan is running on this account. Add one before taking a deposit."}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label
              htmlFor="plan"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Plan<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <PlanPicker
              id="plan"
              plans={plans}
              value={planId}
              onChange={choosePlan}
              disabled={closed || noPlans}
            />
          </div>

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
              onChange={(e) => {
                setAmountTouched(true);
                setAmount(e.target.value);
              }}
              inputMode="decimal"
              autoComplete="off"
              disabled={closed || noPlans}
              aria-invalid={issue ? true : undefined}
              className={cn("tabular text-lg", issue && "border-destructive")}
            />
            {/* Only a fault is said here. What the cash does is the receipt's job. */}
            {issue && <p className="text-xs text-destructive">{issue}</p>}
            {amountTouched && leftover > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAmountTouched(false);
                  setAmount(toCedisInput(covered));
                }}
              >
                Round down to {payments} payment{payments === 1 ? "" : "s"} · {formatAmount(covered)}
              </Button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Channel
            </Label>
            <Select name="channel" value={channel} onValueChange={(v) => setChannel(v as DepositChannel)}>
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

          <OccurredOnField enabled={backdating} noun="deposit" />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
          <SheetCancel />
          <Button
            type="submit"
            disabled={submitting || closed || noPlans || !plan || Boolean(issue) || !amount}
          >
            {submitting ? <Loader2Icon className="animate-spin" /> : <BanknoteArrowDownIcon />}
            Record deposit
          </Button>
        </div>
      </Form>
    </RouteSheet>
  );
}

