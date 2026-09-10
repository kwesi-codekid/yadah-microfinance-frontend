import { data, useActionData } from "react-router";

import { createCustomer } from "~/api/customers";
import { ApiError } from "~/api/error";
import { listUsers } from "~/api/users";
import { CustomerForm } from "~/components/customer-form";
import { Page } from "~/components/page";
import { missingRequired, parseCustomerForm } from "~/lib/customer-form";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/customer-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Register customer · Yadah Dynamic Enterprise" }];
}

/**
  * Registration is office-only — enforced here, not just by hiding the button.
  *
  * The collectors come with it because the API now insists a new customer joins
  * somebody's round: without a list to choose from the form cannot be completed
  * at all, so it is loaded up front rather than fetched when the field is
  * reached. Active only — a disabled collector has no round to join.
  */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const { data: result, headers } = await withAuth(request, (token) =>
    listUsers(token, { role: "collector", status: "active", limit: 100 }),
  );
  return data(
    { collectors: result.items.map(({ id, name }) => ({ id, name })) },
    { headers },
  );
}

export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
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
