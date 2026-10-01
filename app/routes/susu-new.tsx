import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { openAccount } from "~/api/susu";
import { CustomerPicker, type PickedCustomer } from "~/components/customer-picker";
import { RouteSheet, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatAmount, parseCedis } from "~/lib/format";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { CYCLE_TARGET, MIN_DAILY_AMOUNT } from "~/lib/susu";
import type { Route } from "./+types/susu-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Open a susu account · Yadah Dynamic Enterprise" }];
}

/** Opening an account is counter work — enforced here, not just by hiding it. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireCounter(request);
  return null;
}

export async function action({ request, params: _ }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const customerId = String(form.get("customerId") ?? "").trim();
  const dailyAmount = parseCedis(String(form.get("dailyAmount") ?? ""));

  if (!customerId) {
    return data({ error: "Choose the customer this account belongs to." }, { status: 400 });
  }
  if (dailyAmount == null || dailyAmount < MIN_DAILY_AMOUNT) {
    return data(
      { error: `The daily amount is at least GH₵ ${formatAmount(MIN_DAILY_AMOUNT)}.` },
      { status: 400 },
    );
  }

  let result: Awaited<ReturnType<typeof openAccount>>;
  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ data: result, headers } = await withAuth(request, (token) =>
      openAccount(token, { customerId, dailyAmount }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      // They already have one: the answer is that account, not an error page.
      const existing =
        error.code === "ALREADY_OPEN" &&
        typeof error.details === "object" &&
        error.details &&
        typeof (error.details as { accountId?: unknown }).accountId === "string"
          ? (error.details as { accountId: string }).accountId
          : null;
      if (existing) {
        return redirectWithToast(`/susu/${existing}`, {
          tone: "info",
          message: "This customer already has a susu account.",
          description: "Add a plan to it if they want another daily amount.",
        });
      }
      return data(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status },
      );
    }
    throw error;
  }

  // Straight to the account, where the first deposit is recorded.
  await redirectWithToast(
    `/susu/${result.account.id}`,
    {
      tone: "success",
      message: result.reopened
        ? `Account reopened at GH₵ ${formatAmount(dailyAmount)} a day.`
        : `Account opened at GH₵ ${formatAmount(dailyAmount)} a day.`,
      description: `${result.account.accountNumber} · ${CYCLE_TARGET} payments to a full cycle.`,
    },
    headers,
  );
}

export default function SusuNew() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [daily, setDaily] = useState("");

  const pesewas = parseCedis(daily);
  const tooSmall = daily !== "" && (pesewas == null || pesewas < MIN_DAILY_AMOUNT);
  const cycleTotal = pesewas != null && !tooSmall ? pesewas * CYCLE_TARGET : null;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet backTo="/susu" title="Open a susu account">
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

          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Customer<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <CustomerPicker value={customer} onChange={setCustomer} autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="dailyAmount"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              First plan · GH₵ a day<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="dailyAmount"
              name="dailyAmount"
              value={daily}
              onChange={(e) => setDaily(e.target.value)}
              inputMode="decimal"
              placeholder="10.00"
              autoComplete="off"
              aria-invalid={tooSmall ? true : undefined}
              className="tabular"
            />
            {tooSmall ? (
              <p className="text-xs text-destructive">
                The daily amount is at least GH₵ {formatAmount(MIN_DAILY_AMOUNT)}.
              </p>
            ) : cycleTotal != null ? (
              <p className="text-xs text-muted-foreground">
                <span className="tabular">GH₵ {formatAmount(cycleTotal)}</span> over a full
                cycle of {CYCLE_TARGET} payments, one of them kept as commission.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                More plans can be added later, each on its own cycle.
              </p>
            )}
          </div>

          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            One account per customer, for life. If they had one before, it is
            reopened under the same number.
          </p>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
          <SheetCancel />
          <Button type="submit" disabled={submitting || !customer || tooSmall || !daily}>
            {submitting && <Loader2Icon className="animate-spin" />}
            Open account
          </Button>
        </div>
      </Form>
    </RouteSheet>
  );
}
