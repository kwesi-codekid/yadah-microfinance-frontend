import { CheckCircle2Icon, Loader2Icon, SmartphoneIcon, XCircleIcon } from "lucide-react";
import { useEffect } from "react";
import { data, Link, useRevalidator } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { getCharge } from "~/api/portal";
import { Figure, StatusPill } from "~/components/listing";
import { BackLink } from "~/components/page";
import { Button } from "~/components/ui/button";
import { formatAccraDateTime, formatPesewas } from "~/lib/format";
import {
  CHARGE_STATUS_LABELS,
  CHARGE_STATUS_TONE,
  EXECUTION_STATUS_LABELS,
  EXECUTION_STATUS_TONE,
  isSettling,
  KIND_LABELS,
  PROVIDER_LABELS,
} from "~/lib/payments";
import { requireCustomer, withPortalAuth } from "~/lib/portal-session.server";
import type { Route } from "./+types/portal-charge";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Your payment · Yadah Dynamic Enterprise" }];
}

/**
 * A payment, followed until it settles. Two statuses, both shown: whether the
 * network took the money, and whether it reached the account. The page
 * re-reads itself while either is still pending — the prompt is on the
 * handset, and nothing in this tab will hear it being approved.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCustomer(request);
  const { data: result, headers } = await withPortalAuth(request, async (token) => {
    try {
      return await getCharge(token, params.reference);
    } catch (error) {
      throwAsRouteError(error);
    }
  });
  return data({ charge: result.charge }, { headers });
}

export default function PortalCharge({ loaderData }: Route.ComponentProps) {
  const { charge } = loaderData;
  const revalidator = useRevalidator();
  const settling = isSettling(charge);
  const done = charge.status === "success" && charge.executionStatus === "applied";
  const failed = charge.status === "failed" || charge.executionStatus === "failed";

  useEffect(() => {
    if (!settling) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 4000);
    return () => clearInterval(timer);
  }, [settling, revalidator]);

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <BackLink to="/portal">My accounts</BackLink>

      <div className="rounded-xl border border-border bg-card p-5 text-center">
        {done ? (
          <CheckCircle2Icon className="mx-auto size-10 text-success" />
        ) : failed ? (
          <XCircleIcon className="mx-auto size-10 text-danger" />
        ) : (
          <Loader2Icon className="mx-auto size-10 animate-spin text-muted-foreground" />
        )}
        <p className="tabular mt-3 font-heading text-3xl font-bold">{formatPesewas(charge.amount)}</p>
        <p className="text-sm text-muted-foreground">
          {KIND_LABELS[charge.kind]} · {PROVIDER_LABELS[charge.provider]} · {charge.phone}
        </p>
        <p className="mt-4 text-sm">
          {done
            ? "Paid and credited to your account."
            : failed
              ? charge.failureReason || "The payment did not go through. Nothing was taken."
              : charge.displayText || "Approve the prompt on your phone. This page updates on its own."}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <Figure
          label="Payment"
          value={<StatusPill label={CHARGE_STATUS_LABELS[charge.status]} tone={CHARGE_STATUS_TONE[charge.status]} />}
          hint="Whether the network took the money"
        />
        <Figure
          label="Your account"
          value={<StatusPill label={EXECUTION_STATUS_LABELS[charge.executionStatus]} tone={EXECUTION_STATUS_TONE[charge.executionStatus]} />}
          hint="Whether it has been credited"
        />
      </dl>

      <p className="text-xs text-muted-foreground">
        Started {formatAccraDateTime(charge.createdAt)} · reference {charge.reference}
      </p>

      {!settling && (
        <div className="flex gap-2">
          <Button asChild>
            <Link to="/portal">Back to my accounts</Link>
          </Button>
          {failed && (
            <Button asChild variant="outline">
              <Link to="/portal/pay">
                <SmartphoneIcon />
                Try again
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
