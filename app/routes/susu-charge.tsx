import { Loader2Icon } from "lucide-react";
import { useEffect } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { getCustomer } from "~/api/customers";
import { getAccount } from "~/api/susu";
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
import { requireUser, withAuth } from "~/lib/session.server";
import { CYCLE_TARGET } from "~/lib/susu";
import type { Route } from "./+types/susu-charge";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Charge a wallet · Yadah Dynamic Enterprise" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const { account } = await getAccount(token, params.id);
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
  return startCharge(request, "susu-deposit", params.id);
}

export default function SusuCharge({ loaderData }: Route.ComponentProps) {
  const { account, phone, name } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const daysLeft = (account.cycleTarget || CYCLE_TARGET) - account.depositsCount;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo={`/susu/${account.id}`}
      title="Collect by mobile money"
      description={name}
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <SheetBody>
          {actionData?.error && <ChargeFault message={actionData.error} />}
          <MomoFields
            kind="susu-deposit"
            phone={phone}
            amountLabel="Collection"
            // A susu deposit buys whole days, so the daily amount is the figure
            // that is almost always right and the one to start from.
            suggested={account.dailyAmount}
            note={`The amount has to be a whole number of days at GH₵ ${formatAmount(account.dailyAmount)} — ${daysLeft} ${daysLeft === 1 ? "day is" : "days are"} left in this cycle. Nothing is credited until Paystack confirms it.`}
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
