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
  // Registration happens at the office — collectors can't create customers.
  // Nothing else to fetch: this page no longer asks who collects, so the
  // collector list it used to load for that dropdown is gone with it.
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

  /**
   * The pictures ride in with the profile, because this page presents them as
   * one record rather than a form followed by an upload step — and now the API
   * agrees. Images go to `/uploads/images` on their own and the customer record
   * takes the resulting URLs as ordinary fields, so both halves of this page
   * can be committed in the right order: **upload first, then create**.
   *
   * That ordering is the whole reason this got simpler. It used to be create
   * -then-upload, because a photo needed a customer id to be posted against,
   * which meant a rejected file could leave a half-registered record behind. An
   * upload that fails now happens before anything exists.
   */
  const { pending, fieldErrors: uploadErrors } = readImageSlots(form);
  Object.assign(fieldErrors, uploadErrors);

  if (Object.keys(fieldErrors).length) return data<ActionData>({ fieldErrors });

  /**
   * Registration asks nothing about who collects. It never really did — the
   * plan was once to assign the registrar, which the API always refused — and
   * the question is now gone from the API altogether: any collector may collect
   * from any customer, so there is no assignment to make here or later. Who
   * registered someone is still recorded, by the API, as `registeredById`.
   */

  try {
    /**
     * Uploads and create share one `withAuth`, and must. It reads the tokens
     * off the request cookie every time it is called, so a second call in the
     * same action would still be holding the refresh token the first one just
     * spent — the API would refuse it and the user would be bounced to login
     * for successfully registering someone.
     *
     * The callback is safely retryable on a 401, which is the other reason to
     * order it this way: nothing here is committed until the very last call.
     * Re-running an upload costs a duplicate image, not a duplicate customer.
     */
    const { data: id, headers } = await withAuth(request, async (token) => {
      const images = await uploadImageSlots(token, pending);
      const created = await customersApi.createCustomer(token, {
        ...input,
        ...images,
      });

      // Only follow the customer to its own page if the response actually
      // carried an id — building the URL blindly is how you land on
      // `/customers/undefined`, where the API rejects the path param and a
      // successful registration looks like a crash.
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

    // Straight to the new record — the next thing anyone does is open an
    // account, which lives there. `headers` must ride along or the rotated
    // refresh token is lost on the way.
    return redirect(`/customers/${id}`, { headers });
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const failure = toApiFailure(error);
    // A 400 names the fields it objected to. Put those on the inputs and keep
    // the banner for failures that aren't about a particular field.
    const apiFieldErrors = fieldErrorsFromFailure(failure);
    // The page shows one sentence; the failure rides along so the browser
    // console can show the code and the field-level `details` behind it.
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
  // Which upload slots are holding a file — only to say so in the action bar,
  // since here the files go with the record whether or not there are any.
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const fileCount = Object.values(selected).filter(Boolean).length;
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (actionData?.failure)
      console.error("[customer-new] registration failed:", actionData.failure);
  }, [actionData]);

  return (
    // The same measure and gutter as the record this creates, so registering
    // someone and then looking at them is one continuous page rather than two
    // that happen to list the same fields.
    <div className="mx-auto w-full px-6 py-8">
      <PageHeader
        backTo="/customers"
        backLabel="Customers"
        title="Register Customer"
        subtitle="Only a name and phone number are required — the rest can follow later."
      />

      {actionData?.formError && (
        <p className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {actionData.formError}
        </p>
      )}

      {/* One form over the whole grid — the same shape the record page uses
          while editing, so registering someone and then changing them are the
          same gesture. `multipart/form-data` because the pictures ride in with
          the fields; the action uploads them and then creates the customer
          with the URLs they returned. */}
      <Form
        method="post"
        ref={formRef}
        encType="multipart/form-data"
        // Our own rules cover the same ground and can report in place; the
        // browser's bubbles would fire on `type="email"` first.
        noValidate
      >
        {/* Four columns from `xl`, not three: the upload slots need about the
            same width whatever the screen, so giving the profile the extra
            quarter is what lets its fields sit three and four across instead of
            running down the page. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 xl:grid-cols-4">
          {/* The ID scans, and only those. The photo used to sit up here with
              them, but a picture of someone belongs with their name and date of
              birth rather than in a pile of attachments — it is now the aside
              of the Identity section below. What is left is genuinely a column
              of documents.

              Two sides, not one: the API stores the front and back of an ID
              separately, and a Ghana Card's number is on the front while its
              expiry is on the back. */}
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

          {/* `editing` with no customer behind it: the register form is the
              record's own edit view with every field starting blank.

              The Record section is left off — it reports who registered the
              customer and their id, neither of which exists until this form is
              submitted. */}
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

        {/* Pinned to the foot of the page, as on the record: 25 fields is more
            than a screen, and a submit button only at the top would mean
            scrolling back up to commit. The negative margins cancel the page's
            gutter and its bottom padding so the bar spans the full width and
            sits flush against the edge. */}
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
