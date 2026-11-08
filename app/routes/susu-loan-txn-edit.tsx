import { Loader2Icon, SaveIcon, SendIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  data,
  Form,
  useActionData,
  useNavigation,
  useParams,
  useRouteLoaderData,
} from "react-router";
import { toast } from "sonner";

import { proposeCorrection } from "~/api/corrections";
import { ApiError } from "~/api/error";
import { editDeposit } from "~/api/susu-loans";
import { CollectorField } from "~/components/collector-field";
import { RouteSheet, SheetCancel } from "~/components/route-sheet";
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
import { isOffice } from "~/lib/auth";
import { readCollectorId } from "~/lib/collector-entry";
import { NO_COLLECTOR } from "~/lib/customer-form";
import { parseCedis, toCedisInput } from "~/lib/format";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { loader as detailLoader } from "./susu-loan-detail";
import type { Route } from "./+types/susu-loan-txn-edit";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Edit deposit · Yadah Dynamic Enterprise" }];
}

const FIELD_LABEL = "text-xs font-medium tracking-wide text-muted-foreground uppercase";
const CHANNELS = [
  { value: "cash", label: "Cash" },
  { value: "momo", label: "MoMo" },
];

/**
 * One deposit on a susu loan account. The office changes it outright: amount,
 * channel, day and collector. The counter may only ask for the amount to be
 * corrected, and the office decides — the same line every other figure on the
 * ledger keeps. The row comes from the account page underneath, so there is
 * nothing to load.
 */
export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireCounter(request);
  const form = await request.formData();
  const amount = parseCedis(String(form.get("amount") ?? "").trim());
  const reason = String(form.get("reason") ?? "").trim();
  if (amount == null || amount <= 0) return data({ error: "Enter the amount." }, { status: 400 });
  if (reason.length < 3) return data({ error: "Say why, in a few words." }, { status: 400 });

  try {
    if (!isOffice(user)) {
      const { headers } = await withAuth(request, (token) =>
        proposeCorrection(token, "susu-loan-deposit", params.id, params.txnId, { amount, reason }),
      );
      return await redirectWithToast(
        `/susu-loans/${params.id}`,
        { tone: "success", message: "Sent to the office. Nothing changes until they answer." },
        headers,
      );
    }
    const occurredOn = String(form.get("occurredOn") ?? "").trim();
    const channel = String(form.get("channel") ?? "cash") as "cash" | "momo";
    const { headers } = await withAuth(request, (token) =>
      editDeposit(token, params.id, params.txnId, {
        amount,
        channel,
        collectorId: readCollectorId(form) ?? null,
        reason,
        ...(occurredOn ? { occurredOn } : {}),
      }),
    );
    return await redirectWithToast(
      `/susu-loans/${params.id}`,
      { tone: "success", message: "Deposit updated." },
      headers,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export default function SusuLoanTxnEdit() {
  const detail = useRouteLoaderData<typeof detailLoader>("routes/susu-loan-detail");
  const { txnId } = useParams();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const today = new Date();

  const txn = detail?.txns.items.find((t) => t.id === txnId);
  const office = detail?.office ?? false;

  const [amount, setAmount] = useState(txn ? toCedisInput(txn.amount) : "");
  // A deposit somebody typed for a collector is filed under that collector. One
  // nobody did is filed under whoever typed it, who is not on the roster.
  const [collectorId, setCollectorId] = useState(
    txn?.enteredById || detail?.collectors?.some((c) => c.id === txn?.recordedById)
      ? (txn?.recordedById ?? NO_COLLECTOR)
      : NO_COLLECTOR,
  );
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  if (!detail) return null;
  const { account } = detail;

  return (
    <RouteSheet
      backTo={`/susu-loans/${account.id}`}
      title={office ? "Edit deposit" : "Ask to correct this deposit"}
      description={`#${account.accountNumber} · ${account.customerName ?? "Customer"}`}
    >
      {!txn ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          That deposit is not on this page of the account. Go back and open it from its row.
        </p>
      ) : (
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
              <Label htmlFor="amount" className={FIELD_LABEL}>
                Amount · GH₵
              </Label>
              <Input
                id="amount"
                name="amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                className="tabular"
              />
              <p className="text-xs text-muted-foreground">
                It cannot go below what has already gone to the loan.
              </p>
            </div>

            {office && (
              <>
                <div className="space-y-1.5">
                  <Label className={FIELD_LABEL}>Channel</Label>
                  <Select name="channel" defaultValue={txn.channel}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="occurredOn" className={FIELD_LABEL}>
                    Day it happened
                  </Label>
                  <DateField
                    id="occurredOn"
                    name="occurredOn"
                    defaultValue={txn.accraDay}
                    matcher={{ after: today }}
                    startMonth={new Date(today.getFullYear() - 2, today.getMonth())}
                    endMonth={today}
                  />
                </div>

                {detail.collectors && (
                  <CollectorField
                    collectors={detail.collectors}
                    value={collectorId}
                    onChange={setCollectorId}
                  />
                )}
              </>
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
                placeholder={office ? "Kept in the audit log." : "The office decides on this line."}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
            <SheetCancel />
            <Button type="submit" disabled={submitting || reason.trim().length < 3 || !amount}>
              {submitting ? (
                <Loader2Icon className="animate-spin" />
              ) : office ? (
                <SaveIcon />
              ) : (
                <SendIcon />
              )}
              {office ? "Save changes" : "Send to the office"}
            </Button>
          </div>
        </Form>
      )}
    </RouteSheet>
  );
}
