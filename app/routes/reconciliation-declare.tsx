import { HandCoinsIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { declare, getExpected } from "~/api/reconciliation";
import { Figure } from "~/components/listing";
import { RouteSheet, SheetActions, SheetBody, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  accraDay,
  formatAccraDate,
  formatAmount,
  formatCount,
  formatPesewas,
  parseCedis,
  toCedisInput,
} from "~/lib/format";
import { checkDeclaredAmount, varianceKind } from "~/lib/reconciliation";
import { requireUser, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/reconciliation-declare";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Declare cash · Yadah Dynamic Enterprise" }];
}

/**
 * Step one of the handover: the collector says what they are handing over.
 *
 * The expected total is loaded so it can be shown, not so it can be enforced.
 * The declared figure is recorded exactly as given and a mismatch is
 * information for whoever counts the cash — that is the whole reason this is
 * two steps by two people. So the drawer shows the gap and lets it through.
 *
 * Cash channel only: a Paystack or momo deposit never passed through anyone's
 * hands, and the expected figure already excludes them.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const day = url.searchParams.get("day") || accraDay();

  const { data: expected, headers } = await withAuth(request, (token) =>
    // Collectors are pinned to themselves by the API; office roles must name
    // someone, and the only cash an office user can declare is their own.
    getExpected(token, { accraDay: day, collectorId: user.id }),
  );

  return data({ expected, day }, { headers });
}

export async function action({ request }: Route.ActionArgs) {
  await requireUser(request);
  const form = await request.formData();
  const declaredAmount = parseCedis(String(form.get("declaredAmount") ?? ""));
  const declaredNote = String(form.get("declaredNote") ?? "").trim();
  const accraDayValue = String(form.get("accraDay") ?? "").trim();

  const issue = checkDeclaredAmount(declaredAmount);
  if (issue || declaredAmount == null) {
    return data({ error: issue ?? "Enter what you are handing over." }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      declare(token, {
        declaredAmount,
        ...(accraDayValue ? { accraDay: accraDayValue } : {}),
        ...(declaredNote ? { declaredNote } : {}),
      }),
    );

    await redirectWithToast(
      `/reconciliation/${result.reconciliation.id}`,
      {
        tone: "success",
        message: `GH₵ ${formatAmount(declaredAmount)} declared.`,
        description: "The office counts it next. The gap, if any, is recorded then.",
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

export default function ReconciliationDeclare({ loaderData }: Route.ComponentProps) {
  const { expected, day } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  const pesewas = parseCedis(amount);
  const issue = amount === "" ? null : checkDeclaredAmount(pesewas);
  const gap = pesewas != null && !issue ? pesewas - expected.total : null;
  const kind = varianceKind(gap);

  return (
    <RouteSheet
      backTo="/reconciliation"
      title="Declare cash"
      description={formatAccraDate(`${day}T12:00:00Z`)}
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="accraDay" value={day} />

        <SheetBody className="space-y-6">
          {actionData?.error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <p className="font-medium">{actionData.error}</p>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              The system says you took
            </p>
            <p className="tabular mt-0.5 text-2xl font-bold">
              GH₵ {formatAmount(expected.total)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Across {formatCount(expected.entries)} cash deposit
              {expected.entries === 1 ? "" : "s"}. Mobile money and transfers are
              not in this figure — that cash never passed through your hands.
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <Figure label="Susu" value={formatPesewas(expected.susu)} />
              <Figure label="Savings" value={formatPesewas(expected.savings)} />
            </dl>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="declaredAmount"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              What you are handing over · GH₵
              <span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="declaredAmount"
              name="declaredAmount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              aria-invalid={issue ? true : undefined}
              className={cn("tabular text-lg", issue && "border-destructive")}
            />
            <p
              className={cn(
                "text-xs",
                issue ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {issue ?? "Count the money first. Put down what is actually there."}
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAmount(toCedisInput(expected.total))}
          >
            It matches · {formatAmount(expected.total)}
          </Button>

          {/* The gap is shown and allowed through. Blocking it here would push
              people to declare the system's figure rather than the money in
              their hand, which is the one thing this step must not do. */}
          {gap != null && gap !== 0 && (
            <p
              className={cn(
                "rounded-lg border px-4 py-3 text-sm",
                kind === "short"
                  ? "border-danger/40 bg-danger/10"
                  : "border-warning/40 bg-warning/10",
              )}
            >
              That is{" "}
              <span className="tabular font-semibold">
                GH₵ {formatAmount(Math.abs(gap))}
              </span>{" "}
              {kind === "short" ? "less" : "more"} than the system expects. Declare
              it anyway — say why below, and the office will record the gap when it
              counts.
            </p>
          )}

          <div className="space-y-1.5">
            <Label
              htmlFor="declaredNote"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Note
            </Label>
            <Textarea
              id="declaredNote"
              name="declaredNote"
              rows={3}
              maxLength={500}
              placeholder="Anything the office should know before it counts."
            />
          </div>
        </SheetBody>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting || Boolean(issue) || !amount}>
            {submitting ? <Loader2Icon className="animate-spin" /> : <HandCoinsIcon />}
            Declare
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
