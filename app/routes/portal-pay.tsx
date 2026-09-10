import { Loader2Icon, SmartphoneIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { getAccounts, startCharge } from "~/api/portal";
import { ChargeFault, MomoFields } from "~/components/momo-charge";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { parseCedis } from "~/lib/format";
import { checkPhone, type MomoProvider } from "~/lib/payments";
import { payTargets, type PortalChargeKind } from "~/lib/portal";
import { requireCustomer, withPortalAuth } from "~/lib/portal-session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/portal-pay";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pay in · Yadah Dynamic Enterprise" }];
}

/**
 * Pay into one of your own accounts by mobile money. Nothing is credited here:
 * the prompt lands on the handset, and the account is credited when Paystack
 * confirms. Loans and hire purchase are not offered — they are paid at the
 * office, and the API refuses them anyway.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const customer = await requireCustomer(request);
  const { data: accounts, headers } = await withPortalAuth(request, async (token) => {
    try {
      return await getAccounts(token);
    } catch (error) {
      throwAsRouteError(error);
    }
  });
  return data({ phone: customer.phone, targets: payTargets(accounts) }, { headers });
}

export async function action({ request }: Route.ActionArgs) {
  await requireCustomer(request);
  const form = await request.formData();
  const [kind, targetId] = String(form.get("target") ?? "").split(":") as [PortalChargeKind, string];
  const amount = parseCedis(String(form.get("amount") ?? ""));
  const phone = String(form.get("phone") ?? "").trim();
  const provider = String(form.get("provider") ?? "mtn") as MomoProvider;

  if (!kind || !targetId) return data({ error: "Pick the account to pay into." }, { status: 400 });
  if (amount == null || amount <= 0) return data({ error: "Enter an amount." }, { status: 400 });
  const phoneIssue = checkPhone(phone);
  if (phoneIssue) return data({ error: phoneIssue }, { status: 400 });

  try {
    const { data: result, headers } = await withPortalAuth(request, (token) =>
      startCharge(token, { kind, targetId, amount, phone, provider }),
    );
    await redirectWithToast(
      `/portal/pay/${encodeURIComponent(result.charge.reference)}`,
      {
        tone: "info",
        message: "Check your phone.",
        description: result.charge.displayText || "Approve the prompt on your handset to complete the payment.",
      },
      headers,
    );
  } catch (error) {
    if (error instanceof ApiError) return data({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

export default function PortalPay({ loaderData }: Route.ComponentProps) {
  const { phone, targets } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [target, setTarget] = useState(targets[0] ? `${targets[0].kind}:${targets[0].id}` : "");
  const chosen = targets.find((t) => `${t.kind}:${t.id}` === target);

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <header>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Pay in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          By mobile money, into one of your own accounts. You approve the prompt on your phone.
        </p>
      </header>

      {targets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          You have no open susu or savings account to pay into. Loans and hire purchase are
          paid at the office.
        </p>
      ) : (
        <Form method="post" className="space-y-6 rounded-xl border border-border bg-card p-5">
          {actionData?.error && <ChargeFault message={actionData.error} />}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Into<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select name="target" value={target} onValueChange={setTarget}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick an account" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={`${t.kind}:${t.id}`} value={`${t.kind}:${t.id}`}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {chosen && <p className="text-xs text-muted-foreground">{chosen.hint}</p>}
          </div>

          <MomoFields
            key={target}
            kind={chosen?.kind ?? "savings-deposit"}
            phone={phone}
            amountLabel="Amount"
            note="Nothing is credited yet. Approve the prompt on your handset, and the money reaches your account when the network confirms it."
          />

          <Button type="submit" size="lg" className="w-full" disabled={submitting || !chosen}>
            {submitting ? <Loader2Icon className="animate-spin" /> : <SmartphoneIcon />}
            Send the prompt
          </Button>
        </Form>
      )}
    </div>
  );
}
