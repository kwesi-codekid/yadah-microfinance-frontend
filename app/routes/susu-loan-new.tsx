import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { openAccount } from "~/api/susu-loans";
import { CustomerPicker, type PickedCustomer } from "~/components/customer-picker";
import { RouteSheet, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatAmount, parseCedis } from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/susu-loan-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Open a susu loan account · Yadah Dynamic Enterprise" }];
}

/** Office work — enforced here, not just by hiding the button. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireCounter(request);
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const customerId = String(form.get("customerId") ?? "").trim();
  const raw = String(form.get("initialDeposit") ?? "").trim();
  const initialDeposit = raw === "" ? undefined : parseCedis(raw);
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");

  if (!customerId) {
    return data({ error: "Choose the customer this account belongs to." }, { status: 400 });
  }
  if (initialDeposit === null || (initialDeposit !== undefined && initialDeposit <= 0)) {
    return data({ error: "Enter the first deposit, or leave it empty." }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof openAccount>>;
  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ data: result, headers } = await withAuth(request, (token) =>
      openAccount(token, {
        customerId,
        ...(initialDeposit !== undefined ? { initialDeposit, idempotencyKey } : {}),
      }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      // They already have one: the answer is that account, not an error page.
      const existing =
        error.code === "SUSU_LOAN_EXISTS" &&
        typeof error.details === "object" &&
        error.details &&
        typeof (error.details as { accountId?: unknown }).accountId === "string"
          ? (error.details as { accountId: string }).accountId
          : null;
      if (existing) {
        return redirectWithToast(`/susu-loans/${existing}`, {
          tone: "info",
          message: "This customer already has a susu loan account.",
          description: "One per customer — it is used for every loan they take.",
        });
      }
      return data({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }

  await redirectWithToast(
    `/susu-loans/${result.account.id}`,
    {
      tone: "success",
      message: `Susu loan account ${result.account.accountNumber} opened.`,
      description:
        initialDeposit !== undefined
          ? `GH₵ ${formatAmount(initialDeposit)} paid in.`
          : "Deposits are taken at the office.",
    },
    headers,
  );
}

export default function SusuLoanNew() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [deposit, setDeposit] = useState("");
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);
  const pesewas = parseCedis(deposit);
  const bad = deposit !== "" && (pesewas == null || pesewas <= 0);

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo="/susu-loans"
      title="Open a susu loan account"
      className="bg-[#faf9f6] dark:bg-popover"
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

          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Customer<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <CustomerPicker value={customer} onChange={setCustomer} autoFocus glass />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="initialDeposit"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              First deposit · GH₵
            </Label>
            <Input
              id="initialDeposit"
              name="initialDeposit"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              inputMode="decimal"
              placeholder="Optional"
              autoComplete="off"
              aria-invalid={bad ? true : undefined}
              className="tabular"
            />
            {bad && (
              <p className="text-xs text-destructive">Enter an amount, or leave it empty.</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
          <SheetCancel />
          <Button type="submit" disabled={submitting || !customer || bad}>
            {submitting && <Loader2Icon className="animate-spin" />}
            Open account
          </Button>
        </div>
      </Form>
    </RouteSheet>
  );
}
