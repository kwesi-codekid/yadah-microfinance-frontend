import { Loader2Icon, SaveIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation, useRouteLoaderData } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { editAccount } from "~/api/susu-loans";
import { CustomerPicker, type PickedCustomer } from "~/components/customer-picker";
import { RouteSheet, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { loader as detailLoader } from "./susu-loan-detail";
import type { Route } from "./+types/susu-loan-edit";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Edit susu loan account · Yadah Dynamic Enterprise" }];
}

const FIELD_LABEL = "text-xs font-medium tracking-wide text-muted-foreground uppercase";

/**
 * Moving an account opened against the wrong customer — the one thing about the
 * account itself that is not worked out from its deposits, which are edited on
 * their own rows. Office only. The API refuses once money has gone to a loan.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  return null;
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const customerId = String(form.get("customerId") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim();
  if (!customerId) return data({ error: "Choose the customer." }, { status: 400 });
  if (reason.length < 3) return data({ error: "Say why, in a few words." }, { status: 400 });

  try {
    const { headers } = await withAuth(request, (token) =>
      editAccount(token, params.id, { customerId, reason }),
    );
    return await redirectWithToast(
      `/susu-loans/${params.id}`,
      { tone: "success", message: "Account updated." },
      headers,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export default function SusuLoanEdit() {
  const detail = useRouteLoaderData<typeof detailLoader>("routes/susu-loan-detail");
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [customer, setCustomer] = useState<PickedCustomer | null>(
    detail
      ? {
          id: detail.account.customerId,
          fullName: detail.account.customerName ?? "Customer",
          phone: "",
        }
      : null,
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
      title="Edit account"
      description={`#${account.accountNumber}`}
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

          <div className="space-y-1.5">
            <Label className={FIELD_LABEL}>Customer</Label>
            <CustomerPicker value={customer} onChange={setCustomer} />
            <p className="text-xs text-muted-foreground">
              Only while the account holds nothing but deposits. To change a deposit, use the
              edit button on its row.
            </p>
          </div>

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

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
          <SheetCancel />
          <Button
            type="submit"
            disabled={
              submitting ||
              !customer ||
              customer.id === account.customerId ||
              reason.trim().length < 3
            }
          >
            {submitting ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            Save changes
          </Button>
        </div>
      </Form>
    </RouteSheet>
  );
}
