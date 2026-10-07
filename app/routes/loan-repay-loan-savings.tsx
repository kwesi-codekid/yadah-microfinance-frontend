import { ArrowRightIcon, Loader2Icon, PiggyBankIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { getLoan, repayFromLoanSavings } from "~/api/loans";
import { listAccounts as listSavings } from "~/api/savings";
import { Figure } from "~/components/listing";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatAmount, formatPesewas, parseCedis, toCedisInput } from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import { isOpen } from "~/lib/loans";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/loan-repay-loan-savings";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pay from loan savings · Yadah Dynamic Enterprise" }];
}

/**
 * The customer's loan savings account is for the loan and nothing else (client
 * decision, 6 Oct 2026). The month-end deduction empties it into the loan on
 * its own; this is the same move made by hand, whenever the office or the
 * counter wants it — no fee, no daily limit, at most what is in the account
 * and at most what the loan owes.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const { loan } = await getLoan(token, params.id);
      const accounts = await listSavings(token, {
        customerId: loan.customerId,
        accountType: "loan",
        status: "active",
        limit: 1,
      });
      return { loan, accounts };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  const { loan } = result;
  const account = result.accounts.items[0] ?? null;

  return data(
    {
      loan: {
        id: loan.id,
        remaining: loan.remaining,
        customerName: loan.customerName ?? "",
        open: isOpen(loan),
      },
      account: account
        ? { id: account.id, accountNumber: account.accountNumber, balance: account.balance }
        : null,
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const amount = parseCedis(String(form.get("amount") ?? ""));
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");

  if (amount == null || amount <= 0) {
    return data({ error: "Enter how much to take from loan savings." }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof repayFromLoanSavings>>;
  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ data: result, headers } = await withAuth(request, (token) =>
      repayFromLoanSavings(token, params.id, { amount, idempotencyKey }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }

  await redirectWithToast(
    `/loans/${params.id}`,
    {
      tone: "success",
      message: result.replayed
        ? "That repayment was already recorded."
        : `GH₵ ${formatAmount(result.repayment.amount)} applied from loan savings.`,
      description:
        result.loan.remaining > 0
          ? `GH₵ ${formatAmount(result.loan.remaining)} still owing.`
          : "The loan is fully repaid.",
    },
    headers,
  );
}

export default function LoanRepayLoanSavings({ loaderData }: Route.ComponentProps) {
  const { loan, account } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const cap = account ? Math.min(account.balance, loan.remaining) : 0;
  const [amount, setAmount] = useState(() => (cap > 0 ? toCedisInput(cap) : ""));
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  const pesewas = parseCedis(amount);
  const issue =
    amount === "" || pesewas == null
      ? null
      : pesewas <= 0
        ? "Enter an amount."
        : account && pesewas > account.balance
          ? "More than is in the loan savings account."
          : pesewas > loan.remaining
            ? "More than the loan still owes."
            : null;
  const valid = pesewas != null && pesewas > 0 && !issue;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo={`/loans/${loan.id}`}
      title="Pay from loan savings"
      description={loan.customerName || undefined}
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

          {!account ? (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
              <PiggyBankIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                This customer has no loan savings account. Open one from Savings, as a
                &ldquo;Loan savings&rdquo; account.
              </span>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Loan savings #{account.accountNumber}
                </p>
                <p className="tabular mt-0.5 text-2xl font-bold">
                  GH₵ {formatAmount(account.balance)}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="amount"
                  className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
                >
                  Taken from loan savings · GH₵<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Input
                  id="amount"
                  name="amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  autoFocus
                  disabled={cap <= 0}
                  aria-invalid={issue ? true : undefined}
                  className={cn("tabular text-lg", issue && "border-destructive")}
                />
                <p className={cn("text-xs", issue ? "text-destructive" : "text-muted-foreground")}>
                  {issue ??
                    (cap <= 0
                      ? "There is nothing in the loan savings account."
                      : `Up to GH₵ ${formatAmount(cap)} — what is in the account, capped at what the loan owes.`)}
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-3">
                <Figure
                  label="Applied to the loan"
                  value={valid ? formatPesewas(pesewas) : "—"}
                  tone={valid ? "success" : "muted"}
                  hint={valid ? `Leaves ${formatPesewas(loan.remaining - pesewas)} owing` : undefined}
                />
                <Figure
                  label="Left in loan savings"
                  value={valid ? formatPesewas(account.balance - pesewas) : "—"}
                  tone="muted"
                  hint="No fee"
                />
              </dl>
            </>
          )}
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting || !account || !valid || !loan.open}>
            {submitting && <Loader2Icon className="animate-spin" />}
            {valid ? (
              <>
                Apply {formatPesewas(pesewas)}
                <ArrowRightIcon />
              </>
            ) : (
              "Apply to the loan"
            )}
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
