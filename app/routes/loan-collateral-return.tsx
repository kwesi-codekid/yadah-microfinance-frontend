import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { getLoan, returnCollateral } from "~/api/loans";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { DateField } from "~/components/ui/date-field";
import { Label } from "~/components/ui/label";
import { formatAmount } from "~/lib/format";
import { canReturnCollateral } from "~/lib/loans";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/loan-collateral-return";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Return collateral · Yadah Dynamic Enterprise" }];
}

/**
 * The cash collateral goes back to the customer once the loan is repaid. It is
 * cash leaving the drawer, so the office records it, on the day it happened.
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
        customerName: loan.customerName ?? "",
        collateralAmount: loan.collateralAmount ?? 0,
        closedOn: loan.closedAt?.slice(0, 10) ?? null,
        returnable: canReturnCollateral(loan),
      },
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const raw = String(form.get("returnedOn") ?? "").trim();
  const returnedOn = raw && raw !== new Date().toISOString().slice(0, 10) ? raw : undefined;

  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ headers } = await withAuth(request, (token) =>
      returnCollateral(token, params.id, returnedOn ? { returnedOn } : {}),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  await redirectWithToast(
    `/loans/${params.id}`,
    { tone: "success", message: "Collateral handed back." },
    headers,
  );
}

export default function LoanCollateralReturn({ loaderData }: Route.ComponentProps) {
  const { loan } = loaderData;
  const actionData = useActionData<typeof action>();
  const submitting = useNavigation().state === "submitting";
  const today = new Date();

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo={`/loans/${loan.id}`}
      title="Return collateral"
      description={loan.customerName || undefined}
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
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

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Cash collateral held
            </p>
            <p className="tabular mt-0.5 text-2xl font-bold">
              GH₵ {formatAmount(loan.collateralAmount)}
            </p>
          </div>

          {!loan.returnable ? (
            <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
              The collateral is handed back once the loan is fully repaid.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label
                htmlFor="returnedOn"
                className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                Date handed back
              </Label>
              <DateField
                id="returnedOn"
                name="returnedOn"
                placeholder="Today"
                matcher={{ after: today }}
                startMonth={new Date(today.getFullYear() - 2, today.getMonth())}
                endMonth={today}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty for today. It shows as cash out on that day.
              </p>
            </div>
          )}
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting || !loan.returnable}>
            {submitting && <Loader2Icon className="animate-spin" />}
            Hand back GH₵ {formatAmount(loan.collateralAmount)}
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
