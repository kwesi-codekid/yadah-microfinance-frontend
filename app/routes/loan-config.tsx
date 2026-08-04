import { useEffect } from "react";
import { data, Form, useNavigation } from "react-router";
import { Button } from "@heroui/react";
import { Info, TriangleAlert } from "lucide-react";
import type { Route } from "./+types/loan-config";
import { Field } from "~/components/form-fields";
import { notify } from "~/components/toast";
import {
  throwAsRouteError,
  toApiFailure,
  type ApiFailure,
} from "~/lib/api/client";
import * as loansApi from "~/lib/api/loans";
import { normalizeLoanConfig } from "~/lib/loan-client";
import { readLoanConfigForm } from "~/lib/loan-form";
import { toAmountInput } from "~/lib/money";
import { requireOffice, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Loan settings · YADAH Dynamic Enterprise" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);

  const { data: raw, headers } = await withAuth(request, (token) =>
    loansApi.getLoanConfig(token),
  ).catch(throwAsRouteError);

  const { config, complete, missing } = normalizeLoanConfig(
    (raw as { config?: unknown }).config,
  );

  return data({ config, complete, missing }, { headers });
}

type ActionData = {
  ok?: boolean;
  message?: string;
  formError?: string;
  fieldErrors?: Record<string, string>;
  failure?: ApiFailure;
};

export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);

  const form = await request.formData();
  const { config, fieldErrors } = readLoanConfigForm(form);
  if (Object.keys(fieldErrors).length) return data<ActionData>({ fieldErrors });

  try {
    const { headers } = await withAuth(request, (token) =>
      loansApi.updateLoanConfig(token, config),
    );
    return data<ActionData>(
      { ok: true, message: "Loan settings saved." },
      { headers },
    );
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const failure = toApiFailure(error);
    return data<ActionData>({
      formError:
        failure.status === 0
          ? "Something went wrong. Please try again."
          : failure.message,
      failure,
    });
  }
}

export default function LoanSettings({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { config, complete, missing } = loaderData;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const errors = actionData?.fieldErrors;

  useEffect(() => {
    if (actionData?.ok) notify.success(actionData.message ?? "Saved.");
    else if (actionData?.formError) notify.error(actionData.formError);
    if (actionData?.failure)
      console.error("[loan-config] request failed:", actionData.failure);
  }, [actionData]);

  return (
    <div>
      <h2 className="font-heading text-lg font-semibold text-foreground">
        Loan settings
      </h2>
      <p className="mt-1 text-sm text-muted">
        The rates and bounds new applications are quoted at.
      </p>

      {!complete && (
        <p className="mt-5 flex gap-2 rounded-lg bg-warning/15 p-3 text-sm text-warning-foreground dark:text-warning">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <span>
            The API returned no value for {missing.join(", ")}, so{" "}
            {missing.length === 1 ? "it is" : "they are"} showing this app's
            default. Saving this form would write{" "}
            {missing.length === 1 ? "that default" : "those defaults"} as the
            real setting — check {missing.length === 1 ? "it" : "them"} first.
          </span>
        </p>
      )}

      <p className="mt-5 flex gap-2 rounded-lg bg-surface-secondary p-3 text-sm text-muted">
        <Info size={16} className="mt-0.5 shrink-0" />
        <span>
          Changes apply to <span className="font-medium">new applications
          and approvals only</span>. Loans already running keep the rate they
          were approved at — this can't be used to correct one.
        </span>
      </p>

      <Form method="post" className="mt-6 space-y-8">
        <section>
          <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
            Interest rates
          </h2>
          <p className="mb-4 text-sm text-muted">
            Flat percentages of the principal, charged once over the whole term
            — not monthly rates and not an APR.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              name="ratePercent3"
              label="3 months (%)"
              defaultValue={String(config.ratePercent3)}
              error={errors?.ratePercent3}
              inputProps={{ inputMode: "numeric", autoComplete: "off" }}
            />
            <Field
              name="ratePercent6"
              label="6 months (%)"
              defaultValue={String(config.ratePercent6)}
              error={errors?.ratePercent6}
              inputProps={{ inputMode: "numeric", autoComplete: "off" }}
            />
            <Field
              name="ratePercent12"
              label="12 months (%)"
              defaultValue={String(config.ratePercent12)}
              error={errors?.ratePercent12}
              inputProps={{ inputMode: "numeric", autoComplete: "off" }}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
            Tier bounds
          </h2>
          <p className="mb-4 text-sm text-muted">
            In cedis. A principal at or below the small ceiling is a small loan;
            above it is a big one, and the big tier needs a previous small loan
            repaid on time.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              name="smallMinPesewas"
              label="Smallest loan"
              defaultValue={toAmountInput(config.smallMinPesewas)}
              error={errors?.smallMinPesewas}
              inputProps={{ inputMode: "decimal", autoComplete: "off" }}
            />
            <Field
              name="smallMaxPesewas"
              label="Small tier ceiling"
              defaultValue={toAmountInput(config.smallMaxPesewas)}
              error={errors?.smallMaxPesewas}
              inputProps={{ inputMode: "decimal", autoComplete: "off" }}
            />
            <Field
              name="bigMaxPesewas"
              label="Big tier ceiling"
              defaultValue={toAmountInput(config.bigMaxPesewas)}
              error={errors?.bigMaxPesewas}
              inputProps={{ inputMode: "decimal", autoComplete: "off" }}
            />
          </div>
        </section>

        <div className="flex items-center gap-2">
          <Button
            type="submit"
            className="rounded-md bg-success"
            isDisabled={submitting}
          >
            {submitting ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </Form>
    </div>
  );
}
