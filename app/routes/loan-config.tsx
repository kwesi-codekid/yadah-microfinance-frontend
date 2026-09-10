import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { getConfig, updateConfig } from "~/api/loans";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { parseCedis, toCedisInput } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/loan-config";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Loan settings · Yadah Dynamic Enterprise" }];
}

/** `GET /loans/config` — what new lending currently runs on. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const { data: result, headers } = await withAuth(request, (token) => getConfig(token));
  const c = result.config ?? {};
  return data(
    {
      ratePercent3: c.ratePercent3 ?? 0,
      ratePercent6: c.ratePercent6 ?? 0,
      ratePercent12: c.ratePercent12 ?? 0,
      smallMin: toCedisInput(c.smallMinPesewas ?? 0),
      smallMax: toCedisInput(c.smallMaxPesewas ?? 0),
      bigMax: toCedisInput(c.bigMaxPesewas ?? 0),
    },
    { headers },
  );
}

/**
 * `PUT /loans/config` — change the parameters. Office.
 *
 * New applications and approvals only: a loan already approved locked its
 * rate and schedule at that moment, which is the sentence the sheet says
 * before the button.
 */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();

  const rate = (key: string) => {
    const v = Number(String(form.get(key) ?? "").trim());
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
  };
  const ratePercent3 = rate("ratePercent3");
  const ratePercent6 = rate("ratePercent6");
  const ratePercent12 = rate("ratePercent12");
  const smallMinPesewas = parseCedis(String(form.get("smallMin") ?? "").trim());
  const smallMaxPesewas = parseCedis(String(form.get("smallMax") ?? "").trim());
  const bigMaxPesewas = parseCedis(String(form.get("bigMax") ?? "").trim());

  if (ratePercent3 == null || ratePercent6 == null || ratePercent12 == null) {
    return data({ error: "Each rate has to be a percentage from 0 to 100." }, { status: 400 });
  }
  if (smallMinPesewas == null || smallMaxPesewas == null || bigMaxPesewas == null) {
    return data({ error: "Enter each limit as an amount in cedis." }, { status: 400 });
  }
  if (smallMinPesewas > smallMaxPesewas) {
    return data({ error: "The small-loan minimum cannot exceed its maximum." }, { status: 400 });
  }
  if (smallMaxPesewas > bigMaxPesewas) {
    return data({ error: "A big loan has to be able to go above a small one." }, { status: 400 });
  }

  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ headers } = await withAuth(request, (token) =>
      updateConfig(token, {
        ratePercent3,
        ratePercent6,
        ratePercent12,
        smallMinPesewas,
        smallMaxPesewas,
        bigMaxPesewas,
      }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  await redirectWithToast(
    "/loans",
    {
      tone: "success",
      message: "Loan settings saved.",
      description: "They apply to new applications and approvals from now on.",
    },
    headers,
  );
}

export default function LoanConfig({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo="/loans"
      title="Loan settings"
      description="Applies to applications from now on."
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

          <fieldset className="space-y-4">
            <legend className="text-sm font-medium">Flat interest, by duration</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <RateField id="ratePercent3" label="3 months" defaultValue={loaderData.ratePercent3} />
              <RateField id="ratePercent6" label="6 months" defaultValue={loaderData.ratePercent6} />
              <RateField id="ratePercent12" label="12 months" defaultValue={loaderData.ratePercent12} />
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-sm font-medium">Limits · GH₵</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <AmountField id="smallMin" label="Small, from" defaultValue={loaderData.smallMin} />
              <AmountField id="smallMax" label="Small, up to" defaultValue={loaderData.smallMax} />
              <AmountField id="bigMax" label="Big, up to" defaultValue={loaderData.bigMax} />
            </div>
          </fieldset>
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

function RateField({ id, label, defaultValue }: { id: string; label: string; defaultValue: number }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="eyebrow text-muted-foreground">
        {label}<span className="ml-0.5 text-destructive">*</span>
      </Label>
      <div className="relative">
        <Input
          id={id}
          name={id}
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step="0.01"
          defaultValue={defaultValue}
          required
          className="tabular pr-8"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
          %
        </span>
      </div>
    </div>
  );
}

function AmountField({ id, label, defaultValue }: { id: string; label: string; defaultValue: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="eyebrow text-muted-foreground">
        {label}<span className="ml-0.5 text-destructive">*</span>
      </Label>
      <Input
        id={id}
        name={id}
        inputMode="decimal"
        defaultValue={defaultValue}
        autoComplete="off"
        required
        className="tabular"
      />
    </div>
  );
}
