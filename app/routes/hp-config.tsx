import { useEffect, useState } from "react";
import { data, Form, useNavigation } from "react-router";
import { Button } from "@heroui/react";
import { Percent, TriangleAlert } from "lucide-react";
import type { Route } from "./+types/hp-config";
import { FIELD, FieldError } from "~/components/form-fields";
import { TextInput } from "~/components/inputs";
import { notify } from "~/components/toast";
import { toApiFailure, type ApiFailure } from "~/lib/api/client";
import * as hpApi from "~/lib/api/hire-purchase";
import { normalizeHpConfig } from "~/lib/hp-client";
import { requireOffice, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Hire purchase settings · YADAH Dynamic Enterprise" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);

  const { data: raw, headers } = await withAuth(request, (token) =>
    hpApi.getHpConfig(token),
  );

  const { config, complete } = normalizeHpConfig(raw.config);
  return data({ config, configComplete: complete }, { headers });
}

type ActionData = {
  ok?: boolean;
  message?: string;
  formError?: string;
  fieldErrors?: Record<string, string>;
  /** Forwarded so the browser console shows what the API actually said. */
  failure?: ApiFailure;
};

export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);

  const form = await request.formData();
  const rate = Number(String(form.get("interestRatePercent") ?? "").trim());

  if (!Number.isInteger(rate) || rate < 0 || rate > 100) {
    return data<ActionData>({
      fieldErrors: {
        interestRatePercent: "A whole number between 0 and 100.",
      },
    });
  }

  try {
    const { headers } = await withAuth(request, (token) =>
      hpApi.updateHpConfig(token, { interestRatePercent: rate }),
    );
    return data<ActionData>(
      {
        ok: true,
        message: `Rate set to ${rate}%. It applies to agreements signed from now on.`,
      },
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

export default function HpConfigRoute({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { config, configComplete } = loaderData;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [rate, setRate] = useState(String(config.interestRatePercent));

  useEffect(() => {
    if (actionData?.ok) notify.success(actionData.message ?? "Saved.");
    else if (actionData?.formError) notify.error(actionData.formError);
    if (actionData?.failure)
      console.error("[hire-purchase] request failed:", actionData.failure);
  }, [actionData]);

  return (
    <div>
      <h2 className="font-heading text-lg font-semibold text-foreground">
        Hire purchase settings
      </h2>
      <p className="mt-1 text-sm text-muted">
        One number: the flat interest charged on the financed half. It is
        applied once when an agreement activates, so settling early pays the
        same total.
      </p>

      {!configComplete && (
        <p className="mt-4 flex gap-2 rounded-lg border-2 border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          <TriangleAlert size={14} className="mt-px shrink-0" />
          <span>
            The current rate couldn't be read from the API — the spec declares
            this response without any fields, so the figure below is a fallback
            rather than what is in force. Saving will set it for certain.
          </span>
        </p>
      )}

      <Form method="post" className="mt-6 space-y-5">
        <div className="space-y-1.5">
          <TextInput
            name="interestRatePercent"
            label="Interest rate"
            value={rate}
            onChange={setRate}
            startContent={<Percent className="size-4" />}
            inputProps={{
              inputMode: "numeric",
              autoComplete: "off",
              className: FIELD,
            }}
          />
          <FieldError message={actionData?.fieldErrors?.interestRatePercent} />
          <p className="text-xs text-muted">
            A whole percentage, 0–100. Changing it never touches an agreement
            already signed — those keep the rate they activated at.
          </p>
        </div>

        <Button
          type="submit"
          className="rounded-md bg-success"
          isDisabled={submitting}
        >
          {submitting ? "Saving…" : "Save rate"}
        </Button>
      </Form>
    </div>
  );
}
