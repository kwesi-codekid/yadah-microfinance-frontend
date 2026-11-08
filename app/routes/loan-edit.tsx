import { Loader2Icon, SaveIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useLocation, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { editLoan, getLoan } from "~/api/loans";
import { CustomerPicker, type PickedCustomer } from "~/components/customer-picker";
import { GuarantorFields } from "~/components/guarantor-fields";
import { LoanChargeFields } from "~/components/loan-charge-fields";
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
import { Textarea } from "~/components/ui/textarea";
import { accraDay, formatAmount, parseCedis, toCedisInput } from "~/lib/format";
import { readGuarantors } from "~/lib/guarantors";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/loan-edit";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Edit loan · Yadah Dynamic Enterprise" }];
}

const FIELD_LABEL = "text-xs font-medium tracking-wide text-muted-foreground uppercase";
const DURATIONS = [3, 6, 12] as const;
const RATES = [10, 20, 30] as const;

/**
 * Changing any term of a loan (client decision, 4 Nov 2026). Office only: on a
 * loan that has gone out, this reworks its totals, schedule, fee and status.
 * Opens over the list and over the loan's own page, as the repayment drawer does.
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
  return data(
    { loan: result.loan, repaymentCount: result.repayments.length },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const url = new URL(request.url);
  const backTo = url.pathname.startsWith("/loans/edit/")
    ? `/loans${url.search}`
    : `/loans/${params.id}`;

  const principal = parseCedis(String(form.get("principal") ?? "").trim());
  if (principal == null || principal <= 0) {
    return data({ error: "Enter the principal." }, { status: 400 });
  }
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 3) return data({ error: "Say why, in a few words." }, { status: 400 });
  const named = readGuarantors(form);
  if ("error" in named) return data({ error: named.error }, { status: 400 });

  // An empty box means none: unlike a new loan, here that can be a change.
  const money = (key: string): number | null => {
    const raw = String(form.get(key) ?? "").trim();
    return raw === "" ? 0 : parseCedis(raw);
  };
  const processingFee = money("processingFee");
  const collateralAmount = money("collateralAmount");
  if (processingFee == null || collateralAmount == null) {
    return data({ error: "Enter the fee and collateral as amounts, like 50." }, { status: 400 });
  }

  const customerId = String(form.get("customerId") ?? "").trim();
  const ratePercent = Number(form.get("ratePercent") ?? 0);
  const disbursedOn = String(form.get("disbursedOn") ?? "").trim();
  const paperRef = String(form.get("paperRef") ?? "").trim();

  try {
    const { headers } = await withAuth(request, (token) =>
      editLoan(token, params.id, {
        principal,
        durationMonths: Number(form.get("durationMonths")),
        processingFee,
        collateralAmount,
        guarantors: named.guarantors,
        reason,
        ...(customerId ? { customerId } : {}),
        ...(ratePercent ? { ratePercent } : {}),
        ...(disbursedOn ? { disbursedOn } : {}),
        ...(paperRef ? { paperRef } : {}),
      }),
    );
    return await redirectWithToast(
      backTo,
      { tone: "success", message: "Loan updated." },
      headers,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export default function LoanEdit({ loaderData }: Route.ComponentProps) {
  const { loan, repaymentCount } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { pathname } = useLocation();
  const submitting = navigation.state === "submitting";
  const today = new Date();

  const disbursed = Boolean(loan.disbursedAt);
  const canMoveCustomer = repaymentCount === 0 && loan.totalRepaid === 0;
  const rejected = loan.status === "rejected";

  const [customer, setCustomer] = useState<PickedCustomer | null>({
    id: loan.customerId,
    fullName: loan.customerName ?? "Customer",
    phone: "",
  });
  const [principal, setPrincipal] = useState(toCedisInput(loan.principal));
  const [duration, setDuration] = useState(String(loan.durationMonths));
  const [rate, setRate] = useState(String(loan.ratePercent));
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  const pesewas = parseCedis(principal);
  // Only a disbursed loan has a rate of its own to preview: a pending one takes
  // whatever rate is in force when it is approved.
  const totalDue =
    disbursed && pesewas != null && pesewas > 0
      ? pesewas + Math.round((pesewas * Number(rate)) / 100)
      : null;
  const belowRepaid = totalDue != null && totalDue < loan.totalRepaid;

  return (
    <RouteSheet
      backTo={pathname.startsWith("/loans/edit/") ? "/loans" : `/loans/${loan.id}`}
      title="Edit loan"
      description={loan.accountNumber ? `#${loan.accountNumber}` : undefined}
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {(actionData?.error || rejected) && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <p className="font-medium">
                {actionData?.error ?? "A rejected application cannot be changed."}
              </p>
            </div>
          )}

          {disbursed && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              This loan has gone out. Saving reworks its schedule, fee and status from the new
              terms, and past figures in reports change with it. Repayments stay as they are.
            </p>
          )}

          <div className="space-y-1.5">
            <Label className={FIELD_LABEL}>Customer</Label>
            {canMoveCustomer ? (
              <CustomerPicker value={customer} onChange={setCustomer} />
            ) : (
              <>
                <p className="text-sm font-medium">{loan.customerName ?? "Customer"}</p>
                <p className="text-xs text-muted-foreground">
                  Repayments have been made, so this loan stays with this customer.
                </p>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="principal" className={FIELD_LABEL}>
                Principal · GH₵
              </Label>
              <Input
                id="principal"
                name="principal"
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                className="tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label className={FIELD_LABEL}>Duration</Label>
              <Select name="durationMonths" value={duration} onValueChange={setDuration}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d} months
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {disbursed && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className={FIELD_LABEL}>Interest rate</Label>
                <Select name="ratePercent" value={rate} onValueChange={setRate}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RATES.map((r) => (
                      <SelectItem key={r} value={String(r)}>
                        {r}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="disbursedOn" className={FIELD_LABEL}>
                  Date given out
                </Label>
                <DateField
                  id="disbursedOn"
                  name="disbursedOn"
                  defaultValue={accraDay(new Date(loan.disbursedAt as string))}
                  matcher={{ after: today }}
                  startMonth={new Date(today.getFullYear() - 15, 0)}
                  endMonth={today}
                />
              </div>
            </div>
          )}

          {totalDue != null && (
            <p className={belowRepaid ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
              {belowRepaid
                ? `GH₵ ${formatAmount(loan.totalRepaid)} has already been repaid, more than this would make the loan.`
                : `Total to repay: GH₵ ${formatAmount(totalDue)}, of which GH₵ ${formatAmount(loan.totalRepaid)} is paid.`}
            </p>
          )}

          <LoanChargeFields
            labelClassName={FIELD_LABEL}
            defaults={{
              processingFee: loan.processingFee ? toCedisInput(loan.processingFee) : "",
              collateralAmount: loan.collateralAmount ? toCedisInput(loan.collateralAmount) : "",
            }}
          />
          {loan.collateralReturnedAt && (
            <p className="text-xs text-muted-foreground">
              The collateral has been handed back, so its amount can no longer change.
            </p>
          )}

          <GuarantorFields
            legendClassName={FIELD_LABEL}
            defaults={[
              ...(loan.guarantor ? [loan.guarantor] : []),
              ...(loan.moreGuarantors ?? []),
            ]}
          />

          {loan.origin === "paper" && (
            <div className="space-y-1.5">
              <Label htmlFor="paperRef" className={FIELD_LABEL}>
                Paper form number
              </Label>
              <Input
                id="paperRef"
                name="paperRef"
                defaultValue={loan.paperRef ?? ""}
                maxLength={40}
                autoComplete="off"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="reason" className={FIELD_LABEL}>
              Why is this changing?<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Textarea
              id="reason"
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Kept in the audit log."
            />
          </div>
        </div>

        <SheetActions>
          <SheetCancel />
          <Button
            type="submit"
            disabled={
              submitting || rejected || belowRepaid || reason.trim().length < 3 || !customer
            }
          >
            {submitting ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            Save changes
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
