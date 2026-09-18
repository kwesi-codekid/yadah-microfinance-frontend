import { data, useActionData } from "react-router";

import { listCollectors } from "~/api/collectors";
import { createCustomer } from "~/api/customers";
import { ApiError } from "~/api/error";
import { CustomerForm } from "~/components/customer-form";
import { Page } from "~/components/page";
import { missingRequired, parseCustomerForm } from "~/lib/customer-form";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/customer-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Register customer · Yadah Dynamic Enterprise" }];
}

/**
 * Registration is counter work — enforced here, not just by hiding the button.
 *
 * The collectors come with it because the API insists a new customer joins
 * somebody's round: without a list to choose from the form cannot be completed
 * at all, so it is loaded up front rather than fetched when the field is
 * reached. Active only — a disabled collector has no round to join.
 *
 * Read from the roster rather than the staff directory. `GET /users` is
 * office-only, so asking it here meant a teller passed the guard above and
 * then hit a 403 they could not act on — the screen died on a question it
 * should never have asked.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireCounter(request);
  const { data: result, headers } = await withAuth(request, (token) =>
    listCollectors(token),
  );
  return data({ collectors: result.collectors }, { headers });
}

export async function action({ request }: Route.ActionArgs) {
  await requireCounter(request);
  const input = parseCustomerForm(await request.formData());

  if (missingRequired(input)) {
    return data(
      {
        error: "Add the full name, phone, the photo and a collector.",
      },
      { status: 400 },
    );
  }

  let result: { customer: { id: string } };
  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ data: result, headers } = await withAuth(request, (token) =>
      createCustomer(token, input),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status },
      );
    }
    throw error;
  }

  await redirectWithToast(
    `/customers/${result.customer.id}`,
    { tone: "success", message: `${input.fullName} registered.` },
    headers,
  );
}

export default function CustomerNew({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  return (
    <Page className="max-w-none">
      <CustomerForm
        mode="create"
        collectors={loaderData.collectors}
        error={actionData?.error}
        details={actionData && "details" in actionData ? actionData.details : undefined}
        cancelTo="/customers"
      />
    </Page>
  );
}
