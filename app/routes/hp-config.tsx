import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { getConfig, updateConfig } from "~/api/hire-purchase";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { requireAdmin, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/hp-config";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Hire purchase settings · Yadah Dynamic Enterprise" }];
}

/** `GET /hire-purchase/config` — the rate new agreements snapshot. Admin. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const { data: result, headers } = await withAuth(request, (token) => getConfig(token));
  return data({ interestRatePercent: result.config?.interestRatePercent ?? 0 }, { headers });
}

/**
 * `PUT /hire-purchase/config` — change the rate. Admin.
 *
 * Signed agreements snapshotted theirs and are untouched; only agreements
 * signed after this reads the new figure.
 */
export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const interestRatePercent = Number(String(form.get("interestRatePercent") ?? "").trim());

  if (!Number.isFinite(interestRatePercent) || interestRatePercent < 0 || interestRatePercent > 100) {
    return data({ error: "The rate has to be a percentage from 0 to 100." }, { status: 400 });
  }

  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ headers } = await withAuth(request, (token) =>
      updateConfig(token, { interestRatePercent }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  await redirectWithToast(
    "/hire-purchase",
    {
      tone: "success",
      message: `Interest set to ${interestRatePercent}%.`,
      description: "Agreements signed from now on use it; existing ones keep theirs.",
    },
    headers,
  );
}

export default function HpConfig({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo="/hire-purchase"
      title="Hire purchase settings"
      description="Applies to agreements signed from now on."
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
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
            <Label htmlFor="interestRatePercent" className="eyebrow text-muted-foreground">
              Interest rate<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <div className="relative max-w-xs">
              <Input
                id="interestRatePercent"
                name="interestRatePercent"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                defaultValue={loaderData.interestRatePercent}
                autoFocus
                required
                className="tabular pr-8"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                %
              </span>
            </div>
          </div>
        </div>

        <SheetActions>
          <SheetCancel />
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2Icon className="animate-spin" />}
            Save settings
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
