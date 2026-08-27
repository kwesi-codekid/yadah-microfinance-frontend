import { Loader2Icon, TriangleAlertIcon, UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { listCustomers, reassignCollectorRound } from "~/api/customers";
import { ApiError } from "~/api/error";
import { getUser, listUsers } from "~/api/users";
import { RouteSheet, SheetActions, SheetBody, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { formatCount } from "~/lib/format";
import { requireAdmin, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/staff-round";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Hand over a round · Yadah Dynamic Enterprise" }];
}

/**
 * `POST /customers/reassign-collector` — hand a collector's whole round to
 * somebody else. Admin only.
 *
 * For when a collector leaves or swaps zones. Transactional on the API's side:
 * either every customer moves or none does, with one audit entry written per
 * customer. The count is read first so the confirmation can say how many people
 * this touches — "move a round" is an abstraction, "move 148 customers" is the
 * decision actually being made.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const [{ user }, round, staff] = await Promise.all([
        getUser(token, params.id),
        // One row, for its `total`: the size of the round, not the round itself.
        listCustomers(token, { assignedCollectorId: params.id, page: 1, limit: 1 }),
        listUsers(token, { role: "collector", status: "active", limit: 100 }),
      ]);
      return { user, size: round.total, collectors: staff.items };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data(
    {
      from: { id: result.user.id, name: result.user.name },
      size: result.size,
      // Never offer to hand a round to the person who already holds it.
      collectors: result.collectors
        .filter((c) => c.id !== params.id)
        .map(({ id, name }) => ({ id, name })),
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const toCollectorId = String(form.get("toCollectorId") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim();

  if (!toCollectorId) {
    return data({ error: "Pick who takes the round on." }, { status: 400 });
  }
  if (toCollectorId === params.id) {
    return data({ error: "That is the same collector." }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      reassignCollectorRound(token, {
        fromCollectorId: params.id,
        toCollectorId,
        ...(reason ? { reason } : {}),
      }),
    );

    await redirectWithToast(
      `/staff/${params.id}`,
      {
        tone: "success",
        message:
          result.reassigned === 0
            ? "That round was already empty."
            : `${formatCount(result.reassigned)} customer${result.reassigned === 1 ? "" : "s"} moved.`,
        description: "One audit entry per customer, so the history still reads.",
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

export default function StaffRound({ loaderData }: Route.ComponentProps) {
  const { from, size, collectors } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [toCollectorId, setToCollectorId] = useState("");

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  const taker = collectors.find((c) => c.id === toCollectorId);

  return (
    <RouteSheet
      backTo={`/staff/${from.id}`}
      title="Hand over the round"
      description={from.name}
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
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
              On {from.name}&rsquo;s round
            </p>
            <p className="tabular mt-0.5 text-2xl font-bold">{formatCount(size)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              customer{size === 1 ? "" : "s"}. All of them move together — the API
              does it in one transaction, so either every one lands on the new
              round or none does.
            </p>
          </div>

          {collectors.length === 0 ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              There is no other active collector to hand the round to. Add one
              under Staff first.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Hand it to<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Select
                name="toCollectorId"
                value={toCollectorId}
                onValueChange={setToCollectorId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick a collector" />
                </SelectTrigger>
                <SelectContent>
                  {collectors.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label
              htmlFor="reason"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Reason
            </Label>
            <Textarea
              id="reason"
              name="reason"
              rows={3}
              maxLength={300}
              placeholder="Left the branch, swapped zones, on long leave."
            />
          </div>

          {taker && size > 0 && (
            <p className="rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-sm">
              {formatCount(size)} customer{size === 1 ? "" : "s"} will be collected
              by {taker.name} from now on. This does not move any money, only who
              is due to visit.
            </p>
          )}
        </SheetBody>

        <SheetActions>
          <SheetCancel />
          <Button
            type="submit"
            disabled={submitting || !toCollectorId || collectors.length === 0}
          >
            {submitting ? <Loader2Icon className="animate-spin" /> : <UsersIcon />}
            Hand over {size > 0 ? formatCount(size) : ""}
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
