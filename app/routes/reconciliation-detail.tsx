import { HandCoinsIcon, Loader2Icon, ScaleIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { confirm, getReconciliation } from "~/api/reconciliation";
import { Figure, StatusPill } from "~/components/listing";
import { BackLink, Page } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  formatAccraDate,
  formatAccraDateTime,
  formatAmount,
  formatPesewas,
  parseCedis,
  toCedisInput,
} from "~/lib/format";
import {
  STATUS_BLURBS,
  STATUS_LABELS,
  STATUS_TONE,
  VARIANCE_LABELS,
  VARIANCE_TONE,
  canConfirm as mayConfirm,
  checkReceivedAmount,
  isPending,
  reasonExpected,
  varianceKind,
} from "~/lib/reconciliation";
import { requireUser, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/reconciliation-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  const day = loaderData?.row.accraDay ?? "Handover";
  return [{ title: `Handover ${day} · Yadah Dynamic Enterprise` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      return await getReconciliation(token, params.id);
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  const row = result.reconciliation;

  return data(
    {
      row,
      /**
       * Who may press Confirm. Two conditions, and both matter: the handover
       * runs one rank at a time — a teller counts in a collector's day, the
       * office counts in a teller's — and **nobody confirms their own cash**.
       * The API refuses it either way; this only decides whether the form is
       * drawn, and says which of the two is in the way when it is not.
       */
      canConfirm:
        mayConfirm(user, row) && row.collectorId !== user.id && isPending(row),
      isOwnCash: row.collectorId === user.id,
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireUser(request);
  const form = await request.formData();
  const receivedAmount = parseCedis(String(form.get("receivedAmount") ?? ""));
  const varianceReason = String(form.get("varianceReason") ?? "").trim();

  const issue = checkReceivedAmount(receivedAmount);
  if (issue || receivedAmount == null) {
    return data({ error: issue ?? "Enter what you counted." }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      confirm(token, params.id, {
        receivedAmount,
        ...(varianceReason ? { varianceReason } : {}),
      }),
    );

    const variance = result.reconciliation.variance ?? 0;
    const kind = varianceKind(variance);

    await redirectWithToast(
      `/reconciliation/${params.id}`,
      {
        tone: kind === "square" ? "success" : "warning",
        message:
          kind === "square"
            ? "Counted and balanced."
            : `Counted — ${VARIANCE_LABELS[kind].toLowerCase()} GH₵ ${formatAmount(Math.abs(variance))}.`,
        description:
          kind === "square"
            ? "The day is closed."
            : "The day is closed and the gap is on the record.",
      },
      headers,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status },
      );
    }
    throw error;
  }
}

export default function ReconciliationDetail({ loaderData }: Route.ComponentProps) {
  const { row, canConfirm, isOwnCash } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  const pending = isPending(row);
  const pesewas = parseCedis(amount);
  const issue = amount === "" ? null : checkReceivedAmount(pesewas);

  // Against the expected total, which is what a variance is. Note the API
  // recomputes `expectedAmount` at confirmation, so this preview can move if a
  // deposit is corrected in between — the figure on the response is the one
  // that counts, and it is what the toast reports.
  const gap = pesewas != null && !issue ? pesewas - row.expectedAmount : null;
  const gapKind = varianceKind(gap);
  const wantsReason =
    pesewas != null && !issue && reasonExpected(row.expectedAmount, pesewas);

  const settledKind = varianceKind(row.variance);

  return (
    <Page>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <BackLink to="/reconciliation">All handovers</BackLink>

        <div className="min-w-0 text-right">
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            <h2 className="font-heading truncate text-2xl font-bold tracking-tight">
              {formatAccraDate(`${row.accraDay}T12:00:00Z`)}
            </h2>
            <StatusPill
              label={STATUS_LABELS[row.status]}
              blurb={STATUS_BLURBS[row.status]}
              tone={STATUS_TONE[row.status]}
            />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {row.collectorName ?? "Collector"} · declared{" "}
            {formatAccraDateTime(row.declaredAt)}
          </p>
        </div>
      </header>

      {/* The three figures, in the order the process produces them. Expected and
          declared are never the same question, and neither is declared versus
          counted — so they are three tiles, not one with a footnote. */}
      <dl className="mb-6 grid gap-3 sm:grid-cols-3">
        <Figure
          label="Expected"
          value={formatPesewas(row.expectedAmount)}
          tone="muted"
          hint={`Susu ${formatPesewas(row.expectedBreakdown.susu)} · Savings ${formatPesewas(row.expectedBreakdown.savings)}`}
        />
        <Figure
          label="Declared"
          value={formatPesewas(row.declaredAmount)}
          hint={row.declaredNote || "By the collector, before counting"}
        />
        <Figure
          label="Counted"
          value={
            row.receivedAmount == null ? "—" : formatPesewas(row.receivedAmount)
          }
          tone={row.receivedAmount == null ? "muted" : undefined}
          hint={
            row.receivedAt
              ? `At the counter, ${formatAccraDateTime(row.receivedAt)}`
              : "Not yet"
          }
        />
      </dl>

      {/* Settled: what the two gaps came to. Kept apart on purpose — a
          collector who declares honestly and is short has made an error; one
          who declares a figure they do not hand over has done something else. */}
      {!pending && (
        <section className="mb-6 rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            The gaps
          </h3>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Figure
              label="Counted vs expected"
              value={
                settledKind === "square"
                  ? VARIANCE_LABELS.square
                  : `${VARIANCE_LABELS[settledKind]} ${formatPesewas(Math.abs(row.variance ?? 0))}`
              }
              tone={VARIANCE_TONE[settledKind]}
              hint="The real gap against the books"
            />
            <Figure
              label="Counted vs declared"
              value={
                row.declaredVsReceived == null
                  ? "—"
                  : row.declaredVsReceived === 0
                    ? "Matches"
                    : `${VARIANCE_LABELS[varianceKind(row.declaredVsReceived)]} ${formatPesewas(Math.abs(row.declaredVsReceived))}`
              }
              tone={
                row.declaredVsReceived
                  ? VARIANCE_TONE[varianceKind(row.declaredVsReceived)]
                  : "muted"
              }
              hint="Whether what was handed over matched what was said"
            />
          </dl>
          {row.varianceReason && (
            <p className="mt-3 border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">Reason recorded: </span>
              {row.varianceReason}
            </p>
          )}
        </section>
      )}

      {/* Still waiting on a count. */}
      {pending && !canConfirm && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            {isOwnCash
              ? "This is your own cash, so the person you hand it to has to count it in — a collector's day goes to a teller, a teller's to a manager."
              : "Whoever receives this handover has not counted it yet. It will show here when they do."}
          </span>
        </p>
      )}

      {canConfirm && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Count the cash
          </h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Put down what you actually counted. A shortage is recorded, not
            blocked — {row.collectorName ?? "the collector"} keeps working and the
            gap surfaces in the variance report.
          </p>

          <Form method="post" className="space-y-4">
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
              <Label
                htmlFor="receivedAmount"
                className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                Counted · GH₵<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="receivedAmount"
                name="receivedAmount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={issue ? true : undefined}
                className={cn("tabular text-lg", issue && "border-destructive")}
              />
              <p
                className={cn(
                  "text-xs",
                  issue ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {issue ?? "What is in front of you, not what was expected."}
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAmount(toCedisInput(row.declaredAmount))}
            >
              As declared · {formatAmount(row.declaredAmount)}
            </Button>

            {gap != null && gap !== 0 && (
              <p
                className={cn(
                  "rounded-lg border px-4 py-3 text-sm",
                  gapKind === "short"
                    ? "border-danger/40 bg-danger/10"
                    : "border-warning/40 bg-warning/10",
                )}
              >
                <span className="font-semibold">
                  {VARIANCE_LABELS[gapKind]} GH₵ {formatAmount(Math.abs(gap))}
                </span>{" "}
                against what the books expect. Saying why is what makes this
                answerable a month from now.
              </p>
            )}

            <div className="space-y-1.5">
              <Label
                htmlFor="varianceReason"
                className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                Reason{wantsReason && <span className="ml-0.5 text-destructive">*</span>}
              </Label>
              <Textarea
                id="varianceReason"
                name="varianceReason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder={
                  wantsReason
                    ? "Why the figures do not agree."
                    : "Optional when the count balances."
                }
              />
            </div>

            <Button
              type="submit"
              disabled={
                submitting ||
                Boolean(issue) ||
                !amount ||
                (wantsReason && !reason.trim())
              }
            >
              {submitting ? <Loader2Icon className="animate-spin" /> : <HandCoinsIcon />}
              Confirm the count
            </Button>
          </Form>
        </section>
      )}

      {!pending && (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <ScaleIcon className="size-4" />
          This day is closed. Reopening it is not something the API allows.
        </p>
      )}
    </Page>
  );
}
