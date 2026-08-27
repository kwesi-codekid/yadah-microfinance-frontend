import { Loader2Icon } from "lucide-react";
import { useEffect } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { getCustomer } from "~/api/customers";
import { getAccount } from "~/api/savings";
import { ChargeFault, MomoFields } from "~/components/momo-charge";
import {
  RouteSheet,
  SheetActions,
  SheetBody,
  SheetCancel,
} from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { startCharge } from "~/lib/charge.server";
import { formatAmount } from "~/lib/format";
import { MIN_DEPOSIT } from "~/lib/savings";
import { requireUser, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/savings-charge";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Charge a wallet · Yadah Dynamic Enterprise" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const { account } = await getAccount(token, params.id);
      // The customer's own number is where nearly every prompt goes, so it is
      // pre-filled rather than typed out at a counter from memory.
      const { customer } = await getCustomer(token, account.customerId);
      return { account, phone: customer.phone, name: customer.fullName };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data(result, { headers });
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireUser(request);
  return startCharge(request, "savings-deposit", params.id);
}

export default function SavingsCharge({ loaderData }: Route.ComponentProps) {
  const { account, phone, name } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo={`/savings/${account.id}`}
      title="Deposit by mobile money"
      description={name}
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <SheetBody>
          {actionData?.error && <ChargeFault message={actionData.error} />}
          <MomoFields
            kind="savings-deposit"
            phone={phone}
            amountLabel="Deposit"
            note={`Deposits start at GH₵ ${formatAmount(MIN_DEPOSIT)}. Nothing is credited until Paystack confirms the customer approved it.`}
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

