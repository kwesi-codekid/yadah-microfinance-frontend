import { useEffect, useRef, useState } from "react";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import { Button } from "@heroui/react";
import type { Route } from "./+types/customer-new";
import { CustomerProfile, UploadSlot } from "~/components/customer-profile";
import { PageHeader } from "~/components/page-header";
import { toApiFailure, type ApiFailure } from "~/lib/api/client";
import * as customersApi from "~/lib/api/customers";
import { fieldErrorsFromFailure, readCustomerForm } from "~/lib/customer-form";
import {
  readImageSlots,
  uploadImageSlots,
} from "~/lib/customer-uploads.server";
import { requireOffice, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Register customer · YADAH Dynamic Enterprise" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  return null;
}

type ActionData = {
  formError?: string;
  fieldErrors?: Record<string, string>;
  /** Forwarded so the browser console shows what the API actually said. */
  failure?: ApiFailure;
};

export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);

  const form = await request.formData();
  const { input, fieldErrors } = readCustomerForm(form);

  const { pending, fieldErrors: uploadErrors } = readImageSlots(form);
  Object.assign(fieldErrors, uploadErrors);

  if (Object.keys(fieldErrors).length) return data<ActionData>({ fieldErrors });

  try {
    const { data: id, headers } = await withAuth(request, async (token) => {
      const images = await uploadImageSlots(token, pending);
      const created = await customersApi.createCustomer(token, {
        ...input,
        ...images,
      });

      const newId = created?.customer?.id;
      if (!newId) {
        console.warn(
          "POST /customers succeeded but returned no customer id. Response keys:",
          JSON.stringify({
            top: Object.keys(created ?? {}),
            customer: Object.keys(created?.customer ?? {}),
          }),
        );
        return null;
      }
      return newId;
    });

    if (!id) return redirect("/customers", { headers });

    return redirect(`/customers/${id}`, { headers });
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const failure = toApiFailure(error);
    const apiFieldErrors = fieldErrorsFromFailure(failure);
    return data<ActionData>({
      fieldErrors: Object.keys(apiFieldErrors).length
        ? apiFieldErrors
        : undefined,
      formError: Object.keys(apiFieldErrors).length
        ? undefined
        : failure.status === 0
          ? "Something went wrong. Please try again."
          : failure.message,
      failure,
    });
  }
}

export default function CustomerNew({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const fileCount = Object.values(selected).filter(Boolean).length;
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (actionData?.failure)
      console.error("[customer-new] registration failed:", actionData.failure);
  }, [actionData]);

  return (
    <div className="mx-auto w-full px-6 py-8">
      <PageHeader
        title="Register Customer"
        subtitle="Only a name and phone number are required — the rest can follow later."
      />

      {actionData?.formError && (
        <p className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {actionData.formError}
        </p>
      )}

      <Form
        method="post"
        ref={formRef}
        encType="multipart/form-data"
        noValidate
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 xl:grid-cols-4">
          <div className="space-y-4 lg:col-span-1">
            <UploadSlot
              field="idDocumentFront"
              title="ID document — front"
              hint="Optional — stored at higher resolution for legibility."
              error={actionData?.fieldErrors?.idDocumentFront}
              onSelect={(has) =>
                setSelected((prev) => ({ ...prev, idDocumentFront: has }))
              }
            />
            <UploadSlot
              field="idDocumentBack"
              title="ID document — back"
              hint="Optional — the reverse of the same document."
              error={actionData?.fieldErrors?.idDocumentBack}
              onSelect={(has) =>
                setSelected((prev) => ({ ...prev, idDocumentBack: has }))
              }
            />
          </div>

          <div className="space-y-7 lg:col-span-2 xl:col-span-3">
            <CustomerProfile
              editing
              showRecord={false}
              errors={actionData?.fieldErrors}
              photoSlot={
                <UploadSlot
                  compact
                  camera
                  field="photo"
                  title="Photo"
                  error={actionData?.fieldErrors?.photo}
                  onSelect={(has) =>
                    setSelected((prev) => ({ ...prev, photo: has }))
                  }
                />
              }
            />
          </div>
        </div>

        <div className="sticky bottom-0 -mx-6 -mb-8 mt-6 flex flex-wrap items-center gap-3 border-t-2 border-border bg-surface px-6 py-3">
          <p className="text-xs text-muted">
            {fileCount > 0
              ? `${fileCount === 1 ? "1 image" : `${fileCount} images`} will be uploaded before the customer is created.`
              : "A photo and ID document can be added now or later."}
          </p>

          <div className="ml-auto flex items-center gap-3">
            <Link
              to="/customers"
              className="flex min-h-9 items-center rounded-md px-3 text-sm font-medium text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              Cancel
            </Link>
            <Button
              type="submit"
              size="sm"
              className="rounded-md bg-success"
              isDisabled={submitting}
            >
              {submitting ? "Registering…" : "Register customer"}
            </Button>
          </div>
        </div>
      </Form>
    </div>
  );
}
