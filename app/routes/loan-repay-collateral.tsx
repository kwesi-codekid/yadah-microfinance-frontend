import { ArrowRightIcon, Loader2Icon, ShieldIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { getLoan, repayFromCollateral } from "~/api/loans";
import { Figure } from "~/components/listing";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatAmount, formatPesewas, parseCedis, toCedisInput } from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import { collateralHeld, isOpen } from "~/lib/loans";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/loan-repay-collateral";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Repay from collateral · Yadah Dynamic Enterprise" }];
}

/**
 * The cash collateral held on the loan, put toward the loan itself (client
 * decision, 22 Nov 2026). Any amount up to what is still held and up to what
 * the loan owes; the rest stays held and goes back once the loan is repaid.
 * No cash changes hands, so it is the office's decision.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOffice(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      return await getLoan(token, params.id);
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  const { loan } = result;
  return data(
    {
      loan: {
        id: loan.id,
        remaining: loan.remaining,
        customerName: loan.customerName ?? "",
        open: isOpen(loan),
        collateralAmount: loan.collateralAmount ?? 0,
        collateralUsed: loan.collateralUsed ?? 0,
        held: collateralHeld(loan),
      },
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const amount = parseCedis(String(form.get("amount") ?? ""));
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");

  if (amount == null || amount <= 0) {
    return data({ error: "Enter how much of the collateral to use." }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof repayFromCollateral>>;
  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ data: result, headers } = await withAuth(request, (token) =>
      repayFromCollateral(token, params.id, { amount, idempotencyKey }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }

  const left = result.loan.collateralHeld ?? 0;
  await redirectWithToast(
    `/loans/${params.id}`,
    {
      tone: "success",
      message: result.replayed
        ? "That repayment was already recorded."
        : `GH₵ ${formatAmount(result.repayment.amount)} applied from the collateral.`,
      description:
        (result.loan.remaining > 0
          ? `GH₵ ${formatAmount(result.loan.remaining)} still owing.`
          : "The loan is fully repaid.") +
        (left > 0 ? ` GH₵ ${formatAmount(left)} of collateral still held.` : ""),
    },
    headers,
  );
}

export default function LoanRepayCollateral({ loaderData }: Route.ComponentProps) {
  const { loan } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const cap = Math.min(loan.held, loan.remaining);
  const [amount, setAmount] = useState(() => (cap > 0 ? toCedisInput(cap) : ""));
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  const pesewas = parseCedis(amount);
  const issue =
    amount === "" || pesewas == null
      ? null
      : pesewas <= 0
        ? "Enter an amount."
        : pesewas > loan.held
          ? "More than the collateral still held."
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
      title="Repay from collateral"
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

          {loan.held <= 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
              <ShieldIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>No collateral is held on this loan.</span>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Collateral held
                </p>
                <p className="tabular mt-0.5 text-2xl font-bold">
                  GH₵ {formatAmount(loan.held)}
                </p>
                {loan.collateralUsed > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Of {formatPesewas(loan.collateralAmount)} taken;{" "}
                    {formatPesewas(loan.collateralUsed)} already paid to the loan.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="amount"
                  className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
                >
                  Taken from the collateral · GH₵<span className="ml-0.5 text-destructive">*</span>
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
                    `Up to GH₵ ${formatAmount(cap)} — what is held, capped at what the loan owes.`}
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
                  label="Collateral still held"
                  value={valid ? formatPesewas(loan.held - pesewas) : "—"}
                  tone="muted"
                  hint="Handed back once the loan is repaid"
                />
              </dl>

              <p className="rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-sm">
                No cash changes hands: the collateral was taken in cash when the loan went
                out. The customer gets an SMS for the repayment, as for any other.
              </p>
            </>
          )}
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting || loan.held <= 0 || !valid || !loan.open}>
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
