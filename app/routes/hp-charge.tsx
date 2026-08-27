import { Loader2Icon } from "lucide-react";
import { useEffect } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { getCustomer } from "~/api/customers";
import { getAgreement } from "~/api/hire-purchase";
import { ChargeFault, MomoFields } from "~/components/momo-charge";
import {
  RouteSheet,
  SheetActions,
  SheetBody,
  SheetCancel,
} from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { startCharge } from "~/lib/charge.server";
import { awaitingDeposit, isRedeemable, isRunning } from "~/lib/hire-purchase";
import type { HpAgreement } from "~/lib/hire-purchase";
import type { ChargeKind } from "~/lib/payments";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/hp-charge";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Charge a wallet · Yadah Dynamic Enterprise" }];
}

/**
 * Three of the six charge kinds land on this one agreement, and which one it is
 * is not the office's choice — it is wherever the agreement has got to. The
 * deposit is owed before the item leaves the shop, instalments once it has, and
 * a redemption only inside the window after a repossession. Picking the kind
 * from the state is what stops someone charging for the wrong thing.
 */
function kindFor(agreement: HpAgreement): ChargeKind | null {
  if (awaitingDeposit(agreement)) return "hp-deposit";
  if (isRunning(agreement)) return "hp-installment";
  if (isRedeemable(agreement)) return "hp-redemption";
  return null;
}

const COPY: Record<ChargeKind, { title: string; label: string; note: string }> = {
  "hp-deposit": {
    title: "Deposit by mobile money",
    label: "Deposit",
    note: "The deposit is exactly half the selling price and must be paid to the pesewa. The item does not leave the shop until it lands.",
  },
  "hp-installment": {
    title: "Pay an instalment by mobile money",
    label: "Instalment",
    note: "Payments fill the oldest instalment first. More than the balance is refused before the prompt goes out. Clearing every month-overdue instalment lifts the arrears flag.",
  },
  "hp-redemption": {
    title: "Redeem by mobile money",
    label: "Redemption",
    note: "Redeeming buys the item back for the full remaining balance, worked out by the API. It is only possible while the redemption window is open.",
  },
  // The three that never reach this screen, kept so the map is total.
  "susu-deposit": { title: "", label: "", note: "" },
  "savings-deposit": { title: "", label: "", note: "" },
  "loan-repayment": { title: "", label: "", note: "" },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOffice(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const { agreement } = await getAgreement(token, params.id);
      const { customer } = await getCustomer(token, agreement.customerId);
      return {
        agreement,
        kind: kindFor(agreement),
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

  // Read the state again rather than trusting a kind posted from the browser:
  // the agreement could have moved on since the drawer was opened.
  const { data: kind } = await withAuth(request, async (token) => {
    const { agreement } = await getAgreement(token, params.id);
    return kindFor(agreement);
  });

  if (!kind) {
    return data(
      { error: "This agreement cannot take a payment as it stands." },
      { status: 400 },
    );
  }

  return startCharge(request, kind, params.id);
}

export default function HpCharge({ loaderData }: Route.ComponentProps) {
  const { agreement, kind, phone, name } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  const copy = kind ? COPY[kind] : null;

  return (
    <RouteSheet
      backTo={`/hire-purchase/${agreement.id}`}
      title={copy?.title ?? "Charge a wallet"}
      description={`${name} · ${agreement.item.name}`}
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <SheetBody>
          {actionData?.error && <ChargeFault message={actionData.error} />}

          {kind && copy ? (
            <MomoFields
              kind={kind}
              phone={phone}
              amountLabel={copy.label}
              // The deposit is a fixed figure; an instalment caps at what is
              // left; a redemption takes no amount at all.
              suggested={
                kind === "hp-deposit"
                  ? agreement.depositRequired
                  : kind === "hp-installment"
                    ? agreement.remaining
                    : undefined
              }
              cap={kind === "hp-installment" ? agreement.remaining : undefined}
              capLabel="Still owing"
              note={copy.note}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              This agreement cannot take a payment as it stands. A deposit is
              only owed while it is pending, instalments only while it is
              running, and a redemption only inside the window that follows a
              repossession.
            </p>
          )}
        </SheetBody>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting || !kind}>
            {submitting && <Loader2Icon className="animate-spin" />}
            Send the prompt
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
