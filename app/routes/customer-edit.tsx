import { TriangleAlertIcon } from "lucide-react";
import { data, Link, useActionData } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { getCustomer, updateCustomer } from "~/api/customers";
import { ApiError } from "~/api/error";
import { CustomerForm } from "~/components/customer-form";
import { BackLink, Page } from "~/components/page";
import {
  diffCustomer,
  missingRequiredForEdit,
  parseCustomerForm,
} from "~/lib/customer-form";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import type { Route } from "./+types/customer-edit";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.customer.fullName ?? "Customer";
  return [{ title: `Edit ${name} · Yadah Dynamic Enterprise` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOffice(request);
  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      return await getCustomer(token, params.id);
    } catch (error) {
      throwAsRouteError(error);
    }
  });
  return data({ customer: result.customer }, { headers });
}

/**
 * `PATCH /customers/:id`, with only the fields that moved. Inactive customers
 * are refused by the API (`CUSTOMER_INACTIVE`) — its message says to reactivate,
 * and the detail page offers the button, so it is passed straight through.
 */
export async function action({ request, params }: Route.ActionArgs) {
  await requireOffice(request);
  const input = parseCustomerForm(await request.formData());

  if (missingRequiredForEdit(input)) {
    return data(
      { error: "The full name, phone, photo and both sides of the ID document are required." },
      { status: 400 },
    );
  }

  try {
    const { data: result, headers } = await withAuth(request, async (token) => {
      const { customer } = await getCustomer(token, params.id);
      const patch = diffCustomer(customer, input);
      if (Object.keys(patch).length === 0) return { unchanged: true as const };
      await updateCustomer(token, params.id, patch);
      return { unchanged: false as const };
    });

    if (result.unchanged) {
      return data({ error: "Nothing was changed." }, { status: 400 });
    }
    await redirectWithToast(
      `/customers/${params.id}`,
      { tone: "success", message: "Changes saved." },
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

export default function CustomerEdit({ loaderData }: Route.ComponentProps) {
  const { customer } = loaderData;
  const actionData = useActionData<typeof action>();
  const inactive = customer.status === "inactive";

  return (
    <Page className="max-w-none">
      <BackLink to={`/customers/${customer.id}`} className="mb-4">
        Back to {customer.fullName}
      </BackLink>

      {inactive && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            This customer is deactivated, so the API will refuse the save.{" "}
            <Link
              to={`/customers/${customer.id}`}
              className="font-medium underline underline-offset-4"
            >
              Reactivate them
            </Link>{" "}
            first.
          </p>
        </div>
      )}

      <CustomerForm
        mode="edit"
        customer={customer}
        error={actionData?.error}
        details={actionData && "details" in actionData ? actionData.details : undefined}
        cancelTo={`/customers/${customer.id}`}
      />
    </Page>
  );
}
