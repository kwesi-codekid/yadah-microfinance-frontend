import {
  CheckIcon,
  Loader2Icon,
  RefreshCwIcon,
  SendIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, Link, useActionData, useNavigation, useRevalidator } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import {
  approvePayoutRequest,
  getPayoutRequest,
  rejectPayoutRequest,
  verifyPayoutTransfer,
} from "~/api/payout-requests";
import { Figure, StatusPill } from "~/components/listing";
import { BackLink, Page } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { formatAccraDateTime, formatPesewas } from "~/lib/format";
import {
  KIND_BLURBS,
  KIND_LABELS,
  STATUS_BLURBS,
  STATUS_LABELS,
  STATUS_TONE,
  canVerify,
  checkRejectionReason,
  isPending,
  isStranded,
  outcomeFor,
  providerLabel,
  targetPath,
} from "~/lib/payout-requests";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/payout-request-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  const who = loaderData?.row.customerName ?? "Payout request";
  return [{ title: `${who} · Payout request · Yadah Dynamic Enterprise` }];
}

/**
 * One request, and the decision on it.
 *
 * A page rather than a drawer because the decision deserves room: who is
 * asking, what they hold, where the money is going, and — after approval —
 * whether it got there. While the transfer is in flight the page re-reads
 * itself on a timer, as the charge page does, because Paystack's answer
 * arrives by webhook and nothing in this tab will hear it.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOffice(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      return await getPayoutRequest(token, params.id);
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data({ row: result.request }, { headers });
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const reason = String(form.get("reason") ?? "").trim();

  if (intent === "reject") {
    const issue = checkRejectionReason(reason);
    if (issue) return data({ error: issue }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) => {
      if (intent === "approve") return approvePayoutRequest(token, params.id);
      if (intent === "reject") return rejectPayoutRequest(token, params.id, reason);
      if (intent === "verify") return verifyPayoutTransfer(token, params.id);
      throw new ApiError(400, { code: "BAD_REQUEST", message: "Unknown action." });
    });

    const outcome = outcomeFor(intent, result.request);
    await redirectWithToast(
      `/payout-requests/${params.id}`,
      {
        tone: outcome.ok ? "success" : "warning",
        message: outcome.message,
        description: outcome.description,
      },
      headers,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

export default function PayoutRequestDetail({ loaderData }: Route.ComponentProps) {
  const { row } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const submitting = navigation.state === "submitting";
  const intent = navigation.formData?.get("intent");

  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  const pending = isPending(row);
  const stranded = isStranded(row);
  const inFlight = row.status === "approved";

  // The money is between the books and the wallet. Ask again every few seconds
  // until Paystack has said one way or the other, then stop.
  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [inFlight, revalidator]);

  const issue = reason === "" ? null : checkRejectionReason(reason);
  const wallet = `${providerLabel(row.payoutProvider)} · ${row.payoutPhone}`;

  return (
    <Page>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <BackLink to="/payout-requests">All requests</BackLink>

        <div className="min-w-0 text-right">
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            <h2 className="font-heading truncate text-2xl font-bold tracking-tight">
              {row.customerName ?? "Customer"}
            </h2>
            <StatusPill
              label={STATUS_LABELS[row.status]}
              blurb={STATUS_BLURBS[row.status]}
              tone={STATUS_TONE[row.status]}
            />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {KIND_LABELS[row.kind]} · asked {formatAccraDateTime(row.createdAt)}
          </p>
        </div>
      </header>

      {/* The three figures: what was asked, what left the account, where it
          went. Asked and sent are never the same question — a fee or a
          commission sits between them — so they are two tiles, not one. */}
      <dl className="mb-6 grid gap-3 sm:grid-cols-3">
        <Figure
          label="Asked for"
          value={row.amount == null ? "Whole balance" : formatPesewas(row.amount)}
          hint={KIND_BLURBS[row.kind]}
        />
        <Figure
          label="Left the account"
          value={row.netAmount == null ? "—" : formatPesewas(row.netAmount)}
          tone={row.netAmount == null ? "muted" : stranded ? "danger" : undefined}
          hint={
            row.reviewedAt
              ? `Approved ${formatAccraDateTime(row.reviewedAt)}`
              : "Nothing yet — set on approval"
          }
        />
        <Figure
          label="Wallet"
          value={providerLabel(row.payoutProvider)}
          hint={row.payoutPhone}
        />
      </dl>

      <p className="mb-6 text-sm text-muted-foreground">
        Drawn on{" "}
        <Link to={targetPath(row)} prefetch="intent" className="font-medium text-foreground underline-offset-4 hover:underline">
          the {row.kind === "savings-withdrawal" ? "savings" : "susu"} account
        </Link>
        . Open it to see what is held before deciding.
      </p>

      {/* Stranded: the one state that needs a person, said plainly. */}
      {stranded && (
        <section className="mb-6 rounded-xl border border-danger/40 bg-danger/10 p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <TriangleAlertIcon className="size-4 text-danger" />
            The account is debited and the money did not arrive
          </h3>
          <p className="text-sm text-muted-foreground">
            {row.failureReason || "Paystack could not complete the transfer."} The debit
            stays: ask Paystack again, or pay the customer in cash.
          </p>
          {row.paystackStatus && (
            <p className="mt-2 text-xs text-muted-foreground">
              Paystack says: <span className="font-medium text-foreground">{row.paystackStatus}</span>
            </p>
          )}
        </section>
      )}

      {/* Settled one way or the other. */}
      {row.status === "rejected" && (
        <section className="mb-6 rounded-xl border border-border bg-card p-4">
          <h3 className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Declined
          </h3>
          <p className="text-sm">{row.rejectionReason || "No reason recorded."}</p>
          {row.reviewedAt && (
            <p className="mt-1 text-xs text-muted-foreground">{formatAccraDateTime(row.reviewedAt)}</p>
          )}
        </section>
      )}
      {row.status === "paid" && (
        <p className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <CheckIcon className="size-4 text-success" />
          Paystack confirmed the money reached {wallet}
          {row.paidAt ? ` on ${formatAccraDateTime(row.paidAt)}` : ""}.
        </p>
      )}
      {inFlight && (
        <p className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Sending to {wallet}. This page checks back every few seconds.
        </p>
      )}

      {/* The decision. Both buttons are here because both are the office's;
          the refusal opens a reason underneath rather than a second page. */}
      {pending && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Decide
          </h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Approving debits the account first and then sends the money to {wallet}. If
            the transfer fails the debit stays and the request comes back here as failed.
          </p>

          {actionData?.error && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <p className="font-medium">{actionData.error}</p>
            </div>
          )}

          {!declining ? (
            <div className="flex flex-wrap gap-2">
              <Form method="post">
                <input type="hidden" name="intent" value="approve" />
                <Button type="submit" disabled={submitting}>
                  {submitting && intent === "approve" ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <SendIcon />
                  )}
                  Approve and send
                </Button>
              </Form>
              <Button type="button" variant="outline" disabled={submitting} onClick={() => setDeclining(true)}>
                <XIcon />
                Decline
              </Button>
            </div>
          ) : (
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="reject" />
              <div className="space-y-1.5">
                <Label htmlFor="reason" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Why<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Textarea
                  id="reason"
                  name="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  autoFocus
                  aria-invalid={issue ? true : undefined}
                  placeholder="Come to the office with your ID"
                  className={cn(issue && "border-destructive")}
                />
                <p className={cn("text-xs", issue ? "text-destructive" : "text-muted-foreground")}>
                  {issue ?? "The customer reads this on the portal, so write it for them."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="destructive" disabled={submitting || Boolean(checkRejectionReason(reason))}>
                  {submitting && intent === "reject" ? <Loader2Icon className="animate-spin" /> : <XIcon />}
                  Decline the request
                </Button>
                <Button type="button" variant="ghost" disabled={submitting} onClick={() => setDeclining(false)}>
                  Keep deciding
                </Button>
              </div>
            </Form>
          )}
        </section>
      )}

      {/* The missed-webhook fallback. Safe to press twice. */}
      {canVerify(row) && (
        <Form method="post" className="mt-6">
          <input type="hidden" name="intent" value="verify" />
          <Button type="submit" variant="outline" disabled={submitting}>
            {submitting && intent === "verify" ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
            Verify with Paystack
          </Button>
        </Form>
      )}
    </Page>
  );
}
