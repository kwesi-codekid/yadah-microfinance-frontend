import { CheckIcon, Loader2Icon, PackageXIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { approveDamage, getDamage, listItems, rejectDamage } from "~/api/hire-purchase";
import { Figure, StatusPill } from "~/components/listing";
import { BackLink, Page } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { isOffice } from "~/lib/auth";
import { formatAccraDate, formatAccraDateTime, formatCount, formatPesewas } from "~/lib/format";
import {
  DAMAGE_CAUSE_LABELS,
  DAMAGE_STATUS_LABELS,
  damageTone,
} from "~/lib/hire-purchase";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/inventory-damage";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `${loaderData?.damage.itemName ?? "Damage"} · Damages · Yadah Dynamic Enterprise`,
    },
  ];
}

/** What the layout header calls this page. */
export const handle = { title: "Damage report" };

export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireCounter(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const { damage } = await getDamage(token, params.id);
      // While it is pending there is no struck cost yet, so the approver is
      // shown what it would cost at today's price — the figure the decision
      // actually turns on. A missing item must not take the page down.
      const list = await listItems(token, { limit: 100 }).catch(() => null);
      const item = list?.items.find((candidate) => candidate.id === damage.itemId);
      return { damage, unitCostNow: item?.costPrice ?? null };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data(
    {
      damage: result.damage,
      unitCostNow: result.unitCostNow,
      viewerId: viewer.id,
      canDecide: isOffice(viewer),
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  let headers: { "Set-Cookie": string } | undefined;
  try {
    if (intent === "approve") {
      const { data: result, headers: h } = await withAuth(request, (token) =>
        approveDamage(token, params.id),
      );
      headers = h;
      await redirectWithToast(
        "/inventory/damages",
        {
          tone: "success",
          message: `${formatCount(result.damage.quantity)} × ${result.damage.itemName} written off.`,
          description: `${formatPesewas(result.damage.costValue ?? 0)} off the shelf at cost.`,
        },
        headers,
      );
      return null;
    }

    if (intent === "reject") {
      const reason = String(form.get("reason") ?? "").trim();
      if (reason.length < 2) {
        return data({ error: "Say why it was refused — the reporter sees this." }, { status: 400 });
      }
      ({ headers } = await withAuth(request, (token) =>
        rejectDamage(token, params.id, reason),
      ));
      await redirectWithToast(
        "/inventory/damages",
        {
          tone: "success",
          message: "Report rejected.",
          description: "The shelf is untouched — it never moved.",
        },
        headers,
      );
      return null;
    }

    return data({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export default function InventoryDamage({ loaderData }: Route.ComponentProps) {
  const { damage, unitCostNow, viewerId, canDecide } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [rejecting, setRejecting] = useState(false);

  const pending = damage.status === "pending";
  // The API refuses a self-approval; saying so before the click beats a
  // disabled button with no reason beside it.
  const ownReport = damage.reportedById === viewerId;
  // Struck once, at approval. Until then this is an estimate at today's price.
  const estimate = unitCostNow == null ? null : unitCostNow * damage.quantity;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <Page>
      <BackLink to="/inventory/damages" className="mb-4">
        All damages
      </BackLink>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">{damage.itemName}</h2>
          <StatusPill
            tone={damageTone(damage.status)}
            label={DAMAGE_STATUS_LABELS[damage.status]}
          />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatCount(damage.quantity)} unit{damage.quantity === 1 ? "" : "s"} ·{" "}
          {DAMAGE_CAUSE_LABELS[damage.cause]} · {formatAccraDate(damage.occurredOn)}
        </p>
      </header>

      <dl className="mb-6 grid gap-3 sm:grid-cols-3">
        <Figure
          label={damage.costValue != null ? "Cost" : "Would cost"}
          value={
            damage.costValue != null
              ? formatPesewas(damage.costValue)
              : estimate != null
                ? formatPesewas(estimate)
                : "—"
          }
          hint={
            damage.unitCost != null
              ? `${formatPesewas(damage.unitCost)} each, struck when it was approved`
              : estimate != null
                ? `${formatPesewas(unitCostNow ?? 0)} each at today's cost — struck on approval`
                : "Valued at the cost on the day it is approved"
          }
          tone={damage.status === "approved" ? "danger" : "muted"}
        />
        <Figure
          label="Reported by"
          value={damage.reportedByName ?? "Staff"}
          hint={formatAccraDateTime(damage.createdAt)}
          tone="muted"
        />
        <Figure
          label="Decided by"
          value={damage.reviewedByName ?? "—"}
          hint={damage.reviewedAt ? formatAccraDateTime(damage.reviewedAt) : "Not yet decided"}
          tone="muted"
        />
      </dl>

      <section className="mb-6 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h3 className="mb-2 text-sm font-semibold">What happened</h3>
        <p className="text-sm text-muted-foreground">{damage.description}</p>

        {damage.rejectionReason && (
          <>
            <h3 className="mt-4 mb-2 text-sm font-semibold">Why it was refused</h3>
            <p className="text-sm text-muted-foreground">{damage.rejectionReason}</p>
          </>
        )}

        {damage.photoUrls.length > 0 && (
          <>
            <h3 className="mt-4 mb-2 text-sm font-semibold">Photographs</h3>
            <div className="flex flex-wrap gap-3">
              {damage.photoUrls.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-lg border border-border"
                >
                  <img
                    src={url}
                    alt="The damage as reported"
                    className="h-40 w-auto object-cover"
                  />
                </a>
              ))}
            </div>
          </>
        )}
      </section>

      {pending && canDecide && (
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <h3 className="text-sm font-semibold">Decide</h3>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            Approving takes {formatCount(damage.quantity)} unit
            {damage.quantity === 1 ? "" : "s"} off the shelf and books the loss at
            today's cost. Rejecting changes nothing.
          </p>

          {rejecting ? (
            <Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="reject" />
              <div className="space-y-1.5">
                <Label htmlFor="reason" className="eyebrow text-muted-foreground">
                  Why<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Textarea
                  id="reason"
                  name="reason"
                  rows={3}
                  maxLength={300}
                  autoFocus
                  placeholder="It was repaired — put it back on the shelf."
                />
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" variant="destructive" disabled={submitting}>
                  {submitting && <Loader2Icon className="animate-spin" />}
                  Reject report
                </Button>
                <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
              </div>
            </Form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Form method="post">
                <input type="hidden" name="intent" value="approve" />
                <Button type="submit" disabled={submitting || ownReport}>
                  {submitting ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
                  Approve and write off
                </Button>
              </Form>
              <Button type="button" variant="outline" onClick={() => setRejecting(true)}>
                <XIcon />
                Reject
              </Button>
              {ownReport && (
                <p className="text-xs text-muted-foreground">
                  You reported this one — somebody else in the office has to
                  approve it.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {pending && !canDecide && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <PackageXIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            Waiting on the office. The shelf still shows these units until
            somebody approves the write-off.
          </span>
        </p>
      )}
    </Page>
  );
}
