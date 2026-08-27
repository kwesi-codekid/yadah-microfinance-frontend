import { Loader2Icon } from "lucide-react";
import { useEffect } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { getCustomer } from "~/api/customers";
import { getLoan } from "~/api/loans";
import { ChargeFault, MomoFields } from "~/components/momo-charge";
import {
  RouteSheet,
  SheetActions,
  SheetBody,
  SheetCancel,
} from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { startCharge } from "~/lib/charge.server";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/loan-charge";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Charge a wallet · Yadah Dynamic Enterprise" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  // Loan and hire-purchase charges are office-only, unlike the deposit ones.
  await requireOffice(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const { loan } = await getLoan(token, params.id);
      const { customer } = await getCustomer(token, loan.customerId);
      return {
        loan: { id: loan.id, remaining: loan.remaining },
        phone: customer.phone,
        name: customer.fullName,
      };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data(result, { headers });
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOffice(request);
  return startCharge(request, "loan-repayment", params.id);
}

export default function LoanCharge({ loaderData }: Route.ComponentProps) {
  const { loan, phone, name } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo={`/loans/${loan.id}`}
      title="Repay by mobile money"
      description={name}
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <SheetBody>
          {actionData?.error && <ChargeFault message={actionData.error} />}
          <MomoFields
            kind="loan-repayment"
            phone={phone}
            amountLabel="Repayment"
            // The API validates the target before it opens the charge, so an
            // overpayment is refused rather than taken and refunded. Showing
            // the ceiling here saves the customer a prompt they cannot pay.
            cap={loan.remaining}
            capLabel="Still owing"
            suggested={loan.remaining}
            note="Payments fill the oldest instalment first. More than the balance is refused before the prompt goes out, not after the money is taken."
          />
        </SheetBody>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2Icon className="animate-spin" />}
            Send the prompt
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
