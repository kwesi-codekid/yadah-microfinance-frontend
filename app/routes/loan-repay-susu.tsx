import {
  ArrowRightIcon,
  CoinsIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { getLoan, repayBySusuClosure } from "~/api/loans";
import { listAccounts as listSavings } from "~/api/savings";
import { listAccounts as listSusu } from "~/api/susu";
import { Figure } from "~/components/listing";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { formatAmount, formatPesewas } from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import { isOpen, type ExcessDestination } from "~/lib/loans";
import { commissionOf, payoutIfClosedNow } from "~/lib/susu";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/loan-repay-susu";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Repay by closing a susu account · Yadah Dynamic Enterprise" }];
}

/**
 * One transaction across two modules: the susu account stops with the usual
 * one-day commission and its payout lands on the loan, capped at what the loan
 * still owes.
 *
 * Both books are read here so the drawer can show the numbers before anyone
 * commits — this move closes an account and cannot be undone, and the excess
 * has to go somewhere the office chose on purpose.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const { loan } = await getLoan(token, params.id);
      const [susu, savings] = await Promise.all([
        listSusu(token, { customerId: loan.customerId, limit: 50 }),
        listSavings(token, {
          customerId: loan.customerId,
          status: "active",
          limit: 1,
        }),
      ]);
      return { loan, susu, savings };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  const { loan } = result;

  // Only the accounts this endpoint can actually draw from: one that can be
  // closed, or one already stopped with value still owed.
  const sources = result.susu.items
    .filter(
      (account) =>
        account.status === "active" ||
        account.status === "completed" ||
        account.status === "pending-payout",
    )
    .map((account) => {
      const pending = account.status === "pending-payout";
      const commission = pending ? 0 : commissionOf(account);
      const payout = pending ? account.payoutRemaining : payoutIfClosedNow(account);
      return {
        id: account.id,
        accountNumber: account.accountNumber,
        status: account.status,
        pending,
        depositsCount: account.depositsCount,
        cycleTarget: account.cycleTarget,
        totalDeposited: account.totalDeposited,
        commission,
        /** What this account would hand over. Never below zero. */
        payout: Math.max(0, payout),
        /** A close below one day's deposit is refused — terminate instead. */
        uncovered: !pending && account.totalDeposited < commission,
      };
    })
    .filter((source) => source.payout > 0 && !source.uncovered);

  return data(
    {
      loan: {
        id: loan.id,
        remaining: loan.remaining,
        customerName: loan.customerName ?? "",
        open: isOpen(loan),
      },
      sources,
      /** Whether "credit their savings" is a choice that can be carried out. */
      hasSavings: result.savings.items.length > 0,
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const susuAccountId = String(form.get("susuAccountId") ?? "").trim();
  const excessTo = String(form.get("excessTo") ?? "pending-withdrawal") as ExcessDestination;
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");

  if (!susuAccountId) {
    return data({ error: "Choose which susu account pays this." }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof repayBySusuClosure>>;
  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ data: result, headers } = await withAuth(request, (token) =>
      repayBySusuClosure(token, params.id, {
        susuAccountId,
        idempotencyKey,
        excessTo,
      }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }

  const excess = (result.susuClosure?.payout ?? 0) - result.repayment.amount;
  await redirectWithToast(
    `/loans/${params.id}`,
    {
      tone: "success",
      message: result.replayed
        ? "That closure was already recorded."
        : `GH₵ ${formatAmount(result.repayment.amount)} applied from the susu account.`,
      description:
        excess > 0
          ? excessTo === "savings"
            ? `GH₵ ${formatAmount(excess)} went to their savings.`
            : `GH₵ ${formatAmount(excess)} stays in the susu account, pending withdrawal.`
          : `GH₵ ${formatAmount(result.loan.remaining)} still owing.`,
    },
    headers,
  );
}

export default function LoanRepaySusu({ loaderData }: Route.ComponentProps) {
  const { loan, sources, hasSavings } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [chosen, setChosen] = useState<string>(sources[0]?.id ?? "");
  const [excessTo, setExcessTo] = useState<ExcessDestination>("pending-withdrawal");

  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  const source = sources.find((s) => s.id === chosen) ?? null;
  const applied = source ? Math.min(source.payout, loan.remaining) : 0;
  const excess = source ? source.payout - applied : 0;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo={`/loans/${loan.id}`}
      title="Repay by closing a susu account"
      description={loan.customerName || undefined}
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="excessTo" value={excessTo} />

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

          {sources.length === 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
              <CoinsIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                This customer has no susu account that could pay towards the
                loan. An account has to hold more than one day&rsquo;s
                commission before it can be closed — below that it can only be
                terminated, which refunds the customer in full.
              </span>
            </div>
          ) : (
            <>
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Which account pays
                  <span className="ml-0.5 text-destructive">*</span>
                </legend>
                <div className="space-y-2">
                  {sources.map((s) => (
                    <label
                      key={s.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                        "focus-within:ring-2 focus-within:ring-ring",
                        chosen === s.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-input hover:bg-accent",
                      )}
                    >
                      <input
                        type="radio"
                        name="susuAccountId"
                        value={s.id}
                        checked={chosen === s.id}
                        onChange={() => setChosen(s.id)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1 size-3.5 shrink-0 rounded-full border-2",
                          chosen === s.id
                            ? "border-primary bg-primary"
                            : "border-input",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="tabular block text-sm font-medium">
                          #{s.accountNumber}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {s.pending
                            ? "Stopped, awaiting payout"
                            : `${s.depositsCount} of ${s.cycleTarget} deposits · ${formatPesewas(s.totalDeposited)} in`}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-sm font-semibold">
                        {formatPesewas(s.payout)}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* The whole point of this screen: what the move actually does,
                  in figures, before it is made. Closing a susu account cannot
                  be undone. */}
              {source && (
                <section className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
                  <h3 className="eyebrow text-muted-foreground">What will happen</h3>
                  <dl className="grid grid-cols-2 gap-3">
                    <Figure
                      label={source.pending ? "Pending balance" : "Paid into susu"}
                      value={formatPesewas(
                        source.pending ? source.payout : source.totalDeposited,
                      )}
                    />
                    <Figure
                      label="Commission"
                      value={
                        source.pending ? "—" : `− ${formatPesewas(source.commission)}`
                      }
                      hint={source.pending ? "Already taken" : "Exactly one day"}
                      tone="muted"
                    />
                    <Figure
                      label="Applied to the loan"
                      value={formatPesewas(applied)}
                      tone="success"
                      hint={`Leaves ${formatPesewas(loan.remaining - applied)} owing`}
                    />
                    <Figure
                      label="Left over"
                      value={formatPesewas(excess)}
                      tone={excess > 0 ? "warning" : "muted"}
                      hint={excess > 0 ? "Goes where you choose below" : "Nothing over"}
                    />
                  </dl>
                </section>
              )}

              {/* Only asked when there is something to ask about. An excess of
                  zero makes the choice noise. */}
              {excess > 0 && (
                <fieldset className="space-y-2">
                  <legend className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Where the {formatPesewas(excess)} goes
                  </legend>
                  <div className="space-y-2">
                    <ExcessOption
                      chosen={excessTo === "pending-withdrawal"}
                      onChoose={() => setExcessTo("pending-withdrawal")}
                      title="Stays in the susu account"
                      detail="Held as a pending payout for the customer to collect in cash."
                    />
                    <ExcessOption
                      chosen={excessTo === "savings"}
                      onChoose={() => setExcessTo("savings")}
                      disabled={!hasSavings}
                      title="Credits their savings"
                      detail={
                        hasSavings
                          ? "Applied in the same transaction. The GH₵ 10 minimum deposit does not apply to an internal credit."
                          : "They have no active savings account to credit."
                      }
                    />
                  </div>
                </fieldset>
              )}

              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
                <span>
                  The susu account closes as part of this. It cannot be reopened,
                  and one SMS tells the customer what moved.
                </span>
              </div>
            </>
          )}
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting || !source || !loan.open}>
            {submitting && <Loader2Icon className="animate-spin" />}
            {source ? (
              <>
                Close and apply {formatPesewas(applied)}
                <ArrowRightIcon />
              </>
            ) : (
              "Close and apply"
            )}
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}

function ExcessOption({
  chosen,
  onChoose,
  disabled,
  title,
  detail,
}: {
  chosen: boolean;
  onChoose: () => void;
  disabled?: boolean;
  title: string;
  detail: string;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        "focus-within:ring-2 focus-within:ring-ring",
        disabled
          ? "cursor-not-allowed border-border opacity-60"
          : chosen
            ? "cursor-pointer border-primary bg-primary/5"
            : "cursor-pointer border-border hover:border-input hover:bg-accent",
      )}
    >
      <input
        type="radio"
        checked={chosen}
        disabled={disabled}
        onChange={onChoose}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "mt-1 size-3.5 shrink-0 rounded-full border-2",
          chosen && !disabled ? "border-primary bg-primary" : "border-input",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}
