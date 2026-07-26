import { useEffect, useRef, useState } from "react";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import { Button } from "@heroui/react";
import type { Route } from "./+types/customer-new";
import { CustomerProfile, UploadSlot } from "~/components/customer-profile";
import { PageHeader } from "~/components/page-header";
import { toApiFailure, type ApiFailure } from "~/lib/api/client";
import * as customersApi from "~/lib/api/customers";
import {
  fieldErrorsFromFailure,
  readCustomerForm,
  validateUpload,
} from "~/lib/customer-form";
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
   * The files ride in with the profile, because this page presents them as one
   * record rather than a form followed by an upload step. The API has no such
   * combined endpoint — a photo is posted to `/customers/{id}/photo`, which
   * needs an id that doesn't exist yet — so the sequence is create, then
   * upload, with the id the create hands back.
   *
   * Both files are checked *before* the customer is created. Creating someone
   * and then refusing their photo for being a PDF would leave a half-registered
   * record behind and no obvious way to tell that is what happened.
   */
  const photo = form.get("photo");
  const idDocument = form.get("idDocument");
  const hasPhoto = photo instanceof File && photo.size > 0;
  const hasIdDocument = idDocument instanceof File && idDocument.size > 0;
  if (hasPhoto) {
    const error = validateUpload(photo);
    if (error) fieldErrors.photo = error;
  }
  if (hasIdDocument) {
    const error = validateUpload(idDocument);
    if (error) fieldErrors.idDocument = error;
  }

  if (Object.keys(fieldErrors).length) return data<ActionData>({ fieldErrors });

  /**
   * Nobody is assigned at registration: the page posts no `assignedCollectorId`,
   * so `readCustomerForm` leaves it undefined and the customer is created
   * unassigned. A collector is set later from the record, if at all.
   *
   * This is not the auto-assignment the tracker once planned — that would have
   * put the registrar on the record, which the API refuses: `POST /customers`
   * is office-only, and the field must be an *active collector* (422
   * INVALID_COLLECTOR), so an admin or manager's own id is never legal. Who
   * registered someone is recorded by the API as `registeredById` regardless.
   */

  try {
    /**
     * Create and uploads share one `withAuth`, and must. It reads the tokens
     * off the request cookie every time it is called, so a second call in the
     * same action would still be holding the refresh token the first one just
     * spent — the API would refuse it and the user would be bounced to login
     * for successfully registering someone.
     */
    const { data: result, headers } = await withAuth(request, async (token) => {
      const created = await customersApi.createCustomer(token, input);

      // Only follow the customer to its own page if the response actually
      // carried an id — building the URL blindly is how you land on
      // `/customers/undefined`, where the API rejects the path param and a
      // successful registration looks like a crash.
      const id = created?.customer?.id;
      if (!id) {
        console.warn(
          "POST /customers succeeded but returned no customer id. Response keys:",
          JSON.stringify({
            top: Object.keys(created ?? {}),
            customer: Object.keys(created?.customer ?? {}),
          }),
        );
        return { id: null, uploadsFailed: false };
      }

      /**
       * The customer is committed from here, so nothing below may throw:
       * `withAuth` retries this whole callback on a 401, and a retry after a
       * successful create would register the same person a second time.
       *
       * A failed upload is therefore recorded, not raised. The record page is
       * where a retry belongs anyway — it has the same two slots, pointed at
       * the endpoints that now have an id to accept them.
       */
      let uploadsFailed = false;
      if (hasPhoto) {
        try {
          await customersApi.uploadCustomerPhoto(token, id, photo as File);
        } catch (error) {
          uploadsFailed = true;
          console.error("[customer-new] photo upload failed:", error);
        }
      }
      if (hasIdDocument) {
        try {
          await customersApi.uploadCustomerIdDocument(
            token,
            id,
            idDocument as File,
          );
        } catch (error) {
          uploadsFailed = true;
          console.error("[customer-new] ID document upload failed:", error);
        }
      }

      return { id, uploadsFailed };
    });

    if (!result.id) return redirect("/customers", { headers });

    // Straight to the new record — the next thing anyone does is open a susu
    // account, which lives there. `headers` must ride along or the rotated
    // refresh token is lost on the way.
    return redirect(
      `/customers/${result.id}${result.uploadsFailed ? "?uploads=failed" : ""}`,
      { headers },
    );
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
        title="Register customer"
        subtitle="Only a name and phone number are required — the rest can follow later."
      />

      {actionData?.formError && (
        <p className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {actionData.formError}
        </p>
      )}

      {/* One form over the whole grid, unlike the record page: there the files
          have an id to be posted against and can go on their own, but nothing
          exists here until this is submitted, so the photo and the profile have
          to travel together. Hence `multipart/form-data` on the profile form —
          the action creates the customer, then uploads what came with it. */}
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
          {/* Files first on mobile, exactly as on the record — the photo is
              what identifies the person at a glance. Both are optional at
              registration and can be added later from the record itself. */}
          <div className="space-y-4 lg:col-span-1">
            <UploadSlot
              field="photo"
              title="Photo"
              hint="Optional — JPEG, PNG or WebP, up to 5 MB."
              error={actionData?.fieldErrors?.photo}
              onSelect={(has) => setSelected((prev) => ({ ...prev, photo: has }))}
            />
            <UploadSlot
              field="idDocument"
              title="ID document"
              hint="Optional — stored at higher resolution for legibility."
              error={actionData?.fieldErrors?.idDocument}
              onSelect={(has) =>
                setSelected((prev) => ({ ...prev, idDocument: has }))
              }
            />
          </div>

          {/* `editing` with no customer behind it: the register form is the
              record's own edit view with every field starting blank.

              Assignment is left off — a customer is registered unassigned and
              a collector is set later from the record, so there is nothing to
              ask here. */}
          <div className="space-y-7 lg:col-span-2 xl:col-span-3">
            <CustomerProfile
              editing
              showAssignment={false}
              errors={actionData?.fieldErrors}
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
              ? `${fileCount === 1 ? "1 file" : `${fileCount} files`} will be uploaded once the customer is created.`
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
