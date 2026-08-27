import { Loader2Icon, TriangleAlertIcon, UserRoundCogIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { getCustomer, reassignCustomerCollector } from "~/api/customers";
import { ApiError } from "~/api/error";
import { listUsers } from "~/api/users";
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
import { requireAdmin, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/customer-collector";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Reassign collector · Yadah Dynamic Enterprise" }];
}

/**
 * `PATCH /customers/:id/collector` — move one customer to another round.
 *
 * Admin only, and deliberately so: a manager may edit a customer but must not
 * quietly move who collects from them. It is also the *only* way the field
 * changes — a profile update ignores it — which is why this is a route of its
 * own rather than a field on the edit form.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const [{ customer }, staff] = await Promise.all([
        getCustomer(token, params.id),
        listUsers(token, { role: "collector", status: "active", limit: 100 }),
      ]);
      return { customer, collectors: staff.items };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data(
    {
      customer: {
        id: result.customer.id,
        fullName: result.customer.fullName,
        assignedCollectorId: result.customer.assignedCollectorId ?? "",
      },
      collectors: result.collectors.map(({ id, name }) => ({ id, name })),
    },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const collectorId = String(form.get("collectorId") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim();

  if (!collectorId) {
    return data({ error: "Pick who takes them on." }, { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      reassignCustomerCollector(token, params.id, {
        collectorId,
        ...(reason ? { reason } : {}),
      }),
    );

    await redirectWithToast(
      `/customers/${params.id}`,
      {
        tone: "success",
        message: `${result.customer.fullName} moved to another round.`,
        description: "The change is recorded against the customer.",
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

export default function CustomerCollector({ loaderData }: Route.ComponentProps) {
  const { customer, collectors } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [collectorId, setCollectorId] = useState(customer.assignedCollectorId);

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  const current = collectors.find((c) => c.id === customer.assignedCollectorId);
  const unchanged = collectorId === customer.assignedCollectorId;

  return (
    <RouteSheet
      backTo={`/customers/${customer.id}`}
      title="Reassign collector"
      description={customer.fullName}
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
              On the round of
            </p>
            <p className="mt-0.5 font-semibold">
              {current?.name ??
                (customer.assignedCollectorId ? "A collector no longer active" : "Nobody")}
            </p>
          </div>

          {collectors.length === 0 ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              There are no active collectors to move them to. Add one under Staff
              first.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Move to<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Select
                name="collectorId"
                value={collectorId}
                onValueChange={setCollectorId}
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
              {unchanged && customer.assignedCollectorId && (
                <p className="text-xs text-muted-foreground">
                  That is already their round.
                </p>
              )}
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
              placeholder="Moved zones, covering leave, customer asked."
            />
            <p className="text-xs text-muted-foreground">
              Recorded with the change, so the books can still answer who owned
              this customer on any given day.
            </p>
          </div>
        </SheetBody>

        <SheetActions>
          <SheetCancel />
          <Button
            type="submit"
            disabled={submitting || !collectorId || unchanged || collectors.length === 0}
          >
            {submitting ? <Loader2Icon className="animate-spin" /> : <UserRoundCogIcon />}
            Reassign
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
