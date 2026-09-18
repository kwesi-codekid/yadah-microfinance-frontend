import { BanknoteArrowUpIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { createRequest, getAccounts } from "~/api/portal";
import { BackLink } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { formatAmount, parseCedis, toCedisInput } from "~/lib/format";
import { checkPhone, PROVIDER_OPTIONS, type MomoProvider } from "~/lib/payments";
import type { PayoutRequestKind } from "~/lib/payout-requests";
import { checkRequestAmount, optionKey, requestOptions } from "~/lib/portal";
import { requireCustomer, withPortalAuth } from "~/lib/portal-session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/portal-request-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Request a withdrawal · Yadah Dynamic Enterprise" }];
}

/**
 * Ask for a withdrawal. This never moves money: the office decides, and the
 * same rules a counter withdrawal has — the savings fee, the minimum balance,
 * one a day, the susu closing commission — are checked here first so a
 * customer is told what they can take now rather than after waiting.
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
  return data({ phone: customer.phone, options: requestOptions(accounts) }, { headers });
}

export async function action({ request }: Route.ActionArgs) {
  const customer = await requireCustomer(request);
  const form = await request.formData();
  const [kind, targetId] = String(form.get("option") ?? "").split(":") as [PayoutRequestKind, string];
  const amount = parseCedis(String(form.get("amount") ?? ""));
  const payoutPhone = String(form.get("payoutPhone") ?? "").trim() || customer.phone;
  const payoutProvider = String(form.get("payoutProvider") ?? "mtn") as MomoProvider;

  if (!kind || !targetId) return data({ error: "Pick what you want to withdraw." }, { status: 400 });
  const closure = kind === "susu-closure";
  if (!closure && (amount == null || amount <= 0)) return data({ error: "Enter how much you want." }, { status: 400 });
  const phoneIssue = checkPhone(payoutPhone);
  if (phoneIssue) return data({ error: phoneIssue }, { status: 400 });

  try {
    const { data: result, headers } = await withPortalAuth(request, (token) =>
      createRequest(token, {
        kind,
        targetId,
        ...(closure ? {} : { amount: amount ?? 0 }),
        payoutPhone,
        payoutProvider,
      }),
    );
    await redirectWithToast(
      "/portal/requests",
      {
        tone: "success",
        message: "Request sent.",
        description: closure
          ? "The office will close the account and send the payout to your wallet."
          : `The office will review it and send GH₵ ${formatAmount(result.request.amount ?? 0)} to your wallet once approved.`,
      },
      headers,
    );
  } catch (error) {
    if (error instanceof ApiError) return data({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

export default function PortalRequestNew({ loaderData }: Route.ComponentProps) {
  const { phone, options } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [option, setOption] = useState(options[0] ? optionKey(options[0]) : "");
  const [amount, setAmount] = useState("");
  const [number, setNumber] = useState(phone);
  const chosen = options.find((o) => optionKey(o) === option);

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  const pesewas = parseCedis(amount);
  const amountIssue = chosen && amount !== "" ? checkRequestAmount(chosen, pesewas) : null;
  const phoneIssue = number === "" ? null : checkPhone(number);
  const closure = chosen?.kind === "susu-closure";
  const canSubmit =
    Boolean(chosen) &&
    !phoneIssue &&
    number !== "" &&
    (closure || (amount !== "" && !amountIssue));

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <BackLink to="/portal/requests">My withdrawals</BackLink>
      <header>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Request a withdrawal</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sent to your mobile-money wallet once the office approves.
        </p>
      </header>

      {options.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          You have no open account to withdraw from.
        </p>
      ) : (
        <Form method="post" className="space-y-6 rounded-xl border border-border bg-card p-5">
          {actionData?.error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              {actionData.error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              What<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Select name="option" value={option} onValueChange={(v) => { setOption(v); setAmount(""); }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick an account" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={optionKey(o)} value={optionKey(o)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {chosen && <p className="text-xs text-muted-foreground">{chosen.hint}</p>}
          </div>

          {chosen && !closure && (
            <div className="space-y-1.5">
              <Label htmlFor="amount" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Amount · GH₵<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="amount"
                name="amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                aria-invalid={amountIssue ? true : undefined}
                className={cn("tabular text-lg", amountIssue && "border-destructive")}
              />
              <p className={cn("text-xs", amountIssue ? "text-destructive" : "text-muted-foreground")}>
                {amountIssue ?? (chosen.max != null ? `Up to GH₵ ${formatAmount(chosen.max)}.` : "")}
              </p>
              {chosen.max != null && chosen.max > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={() => setAmount(toCedisInput(chosen.max ?? 0))}>
                  Everything available · {formatAmount(chosen.max)}
                </Button>
              )}
            </div>
          )}

          {closure && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>Closing ends the cycle. The payout is worked out by the office when they approve, less one day's commission.</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="payoutPhone" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Send to<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="payoutPhone"
              name="payoutPhone"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              inputMode="tel"
              autoComplete="off"
              aria-invalid={phoneIssue ? true : undefined}
              className={cn("tabular", phoneIssue && "border-destructive")}
            />
            <p className={cn("text-xs", phoneIssue ? "text-destructive" : "text-muted-foreground")}>
              {phoneIssue ?? "The mobile-money wallet the payout goes to. Your registered number is filled in."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Network</Label>
            <Select name="payoutProvider" defaultValue="mtn">
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={submitting || !canSubmit}>
            {submitting ? <Loader2Icon className="animate-spin" /> : <BanknoteArrowUpIcon />}
            Send the request
          </Button>
        </Form>
      )}
    </div>
  );
}
