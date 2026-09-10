import {
  CheckCircle2Icon,
  Loader2Icon,
  RefreshCwIcon,
  SmartphoneIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";
import { useEffect } from "react";
import { data, Form, useNavigation, useRevalidator } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { getCharge, verifyCharge } from "~/api/payments";
import { Figure, StatusPill } from "~/components/listing";
import { BackLink, Page, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { formatAccraDateTime, formatPesewas } from "~/lib/format";
import {
  CHARGE_STATUS_LABELS,
  CHARGE_STATUS_TONE,
  EXECUTION_STATUS_LABELS,
  EXECUTION_STATUS_TONE,
  isSettling,
  KIND_LABELS,
  needsReconciliation,
  PROVIDER_LABELS,
} from "~/lib/payments";
import { isOffice } from "~/lib/auth";
import { requireUser, withAuth } from "~/lib/session.server";
import { withToast } from "~/lib/toast.server";
import type { Route } from "./+types/payment-charge";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Mobile money charge · Yadah Dynamic Enterprise" }];
}

/**
 * Where a charge is followed until it settles.
 *
 * The whole screen exists because **a charge has two statuses and they answer
 * different questions**: `status` is whether Paystack took the money, and
 * `executionStatus` is whether it reached the record it was meant for. They can
 * disagree, and the disagreement is the case that needs a person — the customer
 * has paid and nothing was credited. So both are drawn, always, side by side
 * and equally weighted; neither is ever summarised into a single word.
 *
 * While either is still `pending` the page re-reads itself on a timer, because
 * the customer is approving a prompt on their handset and nothing in this tab
 * will tell us when they have.
 */

export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireUser(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      return await getCharge(token, params.reference);
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data({ charge: result.charge, office: isOffice(viewer) }, { headers });
}

interface ActionResult {
  error?: string;
}

/**
 * The missed-webhook fallback. Paystack normally calls the API server-to-server;
 * when that call goes astray the charge sits on `success` with nothing applied,
 * and this asks Paystack directly and applies the answer. Safe to press twice —
 * application is idempotent on the API's side.
 */
export async function action({ request, params }: Route.ActionArgs) {
  await requireUser(request);

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      verifyCharge(token, params.reference),
    );

    const applied = result.charge.executionStatus === "applied";
    return data<ActionResult>(
      {},
      {
        headers: await withToast(
          {
            tone: applied ? "success" : "info",
            message: applied
              ? "Verified and applied."
              : "Checked with Paystack.",
            description: applied
              ? "The money has reached the record it was meant for."
              : `Paystack still reports this charge as ${CHARGE_STATUS_LABELS[result.charge.status].toLowerCase()}.`,
          },
          headers,
        ),
      },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data<ActionResult>({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export default function PaymentCharge({ loaderData }: Route.ComponentProps) {
  const { charge, office } = loaderData;
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const verifying = navigation.state === "submitting";

  const settling = isSettling(charge);
  const stranded = needsReconciliation(charge);

  // The customer is approving a prompt on a handset somewhere. Nothing in this
  // tab will hear about it, so the page asks again every few seconds until both
  // statuses have settled — and then stops, rather than polling a dead charge
  // for as long as it is left open.
  useEffect(() => {
    if (!settling) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 4000);
    return () => clearInterval(timer);
  }, [settling, revalidator]);

  return (
    <Page>
      {/* The ledger is the office's; anyone else came here from a customer's
          account and goes back to the dashboard rather than to a door that
          would refuse them. */}
      {office ? (
        <BackLink to="/transactions" className="mb-4">
          All transactions
        </BackLink>
      ) : (
        <BackLink to="/dashboard" className="mb-4">
          Dashboard
        </BackLink>
      )}

      <PageHeader
        title={KIND_LABELS[charge.kind]}
        description={`${PROVIDER_LABELS[charge.provider]} · ${charge.phone}`}
        actions={
          <Form method="post">
            <Button type="submit" variant="outline" disabled={verifying}>
              {verifying ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <RefreshCwIcon />
              )}
              Verify with Paystack
            </Button>
          </Form>
        }
      />

      {/* The case that needs a person, said plainly and first. Neither status
          alone says it, which is exactly why both are always on screen. */}
      {stranded && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3.5 text-sm text-destructive"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">
              Paid, but not credited to anything.
            </p>
            <p className="text-destructive/90">
              Paystack took {formatPesewas(charge.amount)} and the API could not
              put it anywhere — the record it was meant for most likely changed
              underneath the charge. Verify first; if that does not clear it,
              this needs to be resolved by hand.
              {charge.failureReason ? ` ${charge.failureReason}` : ""}
            </p>
          </div>
        </div>
      )}

      {/* Paystack's own instruction to the customer, shown word for word.
          Rewording it means telling someone the wrong thing to press. */}
      {charge.displayText && settling && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 px-4 py-3.5">
          <SmartphoneIcon className="mt-0.5 size-4 shrink-0 text-info" />
          <div className="space-y-1">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Tell the customer
            </p>
            <p className="text-sm font-medium">{charge.displayText}</p>
          </div>
        </div>
      )}

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <StatusBlock
            heading="Did Paystack take the money?"
            label={CHARGE_STATUS_LABELS[charge.status]}
            tone={CHARGE_STATUS_TONE[charge.status]}
            state={charge.status}
          />
          <StatusBlock
            heading="Did it reach the record?"
            label={EXECUTION_STATUS_LABELS[charge.executionStatus]}
            tone={EXECUTION_STATUS_TONE[charge.executionStatus]}
            state={charge.executionStatus}
          />
        </div>

        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Amount" value={formatPesewas(charge.amount)} />
          <Figure label="Network" value={PROVIDER_LABELS[charge.provider]} />
          <Figure label="Started" value={formatAccraDateTime(charge.createdAt)} />
          <Figure
            label="Applied"
            value={
              charge.executedAt ? formatAccraDateTime(charge.executedAt) : "—"
            }
            tone={charge.executedAt ? undefined : "muted"}
          />
        </dl>

        {charge.failureReason && !stranded && (
          <p className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {charge.failureReason}
          </p>
        )}

        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          {settling && <Loader2Icon className="size-3.5 animate-spin" />}
          {settling
            ? "Watching for the customer to approve it on their handset."
            : "This charge has settled. Verifying again is safe, and changes nothing."}
          <span className="tabular ml-auto">{charge.reference}</span>
        </p>
      </section>
    </Page>
  );
}

/**
 * One of the two statuses, under the question it answers. The question is the
 * heading rather than the field name: `status` and `executionStatus` mean
 * nothing at a counter, and telling them apart is the whole point of the page.
 */
function StatusBlock({
  heading,
  label,
  tone,
  state,
}: {
  heading: string;
  label: string;
  tone: "success" | "warning" | "danger";
  state: string;
}) {
  const Icon =
    state === "pending"
      ? Loader2Icon
      : tone === "success"
        ? CheckCircle2Icon
        : XCircleIcon;

  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {heading}
      </p>
      <p className="mt-1.5 flex items-center gap-2">
        <Icon
          className={
            state === "pending"
              ? "size-4 shrink-0 animate-spin text-warning"
              : tone === "success"
                ? "size-4 shrink-0 text-success"
                : "size-4 shrink-0 text-danger"
          }
        />
        <StatusPill label={label} tone={tone} className="text-base font-semibold" />
      </p>
    </div>
  );
}
