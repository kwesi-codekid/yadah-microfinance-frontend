import { useEffect, useRef, useState } from "react";
import { data, Form, Link, useNavigation, useSearchParams } from "react-router";
import { Button } from "@heroui/react";
import { Ban, Pencil, PiggyBank, RotateCcw } from "lucide-react";
import type { Route } from "./+types/customer-detail";
import {
  CustomerProfile,
  ImageView,
  UploadSlot,
} from "~/components/customer-profile";
import { ConfirmModal } from "~/components/modals";
import { PageHeader } from "~/components/page-header";
import { notify } from "~/components/toast";
import {
  throwAsRouteError,
  toApiFailure,
  type ApiFailure,
} from "~/lib/api/client";
import * as customersApi from "~/lib/api/customers";
import * as usersApi from "~/lib/api/users";
import {
  CUSTOMER_STATUS_LABELS,
  type Customer,
} from "~/lib/customer-client";
import { fieldErrorsFromFailure, readCustomerForm } from "~/lib/customer-form";
import {
  describeUploads,
  readImageSlots,
  uploadImageSlots,
} from "~/lib/customer-uploads.server";
import { formatDate } from "~/lib/format";
import { isOffice, requireUser, withAuth } from "~/lib/session.server";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `${loaderData?.customer.fullName ?? "Customer"} · YADAH Dynamic Enterprise`,
    },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  // Collectors may open a customer assigned to them; the API returns 403
  // otherwise, which surfaces as this route's error boundary.
  const user = await requireUser(request);
  const office = isOffice(user);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const [customer, collectors] = await Promise.all([
      customersApi.getCustomer(token, params.id),
      // Only to name the assigned collector — and only office roles may ask.
      office
        ? usersApi.listUsers(token, {
            role: "collector",
            status: "active",
            limit: 100,
          })
        : null,
    ]);

    /**
     * Who registered this customer. The API sets `registeredById` itself, from
     * the token of whoever called `POST /customers` — it is not a field the
     * form sends, and it is the one piece of provenance on the record.
     *
     * Fetched one-by-one rather than read off the list above: the registrar is
     * an admin or manager, and that list is collectors only. `catch` rather
     * than `throw` — a staff member since deleted, or an id this user may not
     * look up, should cost the line its name, not the page its render.
     */
    const registrar =
      office && customer.customer.registeredById
        ? await usersApi
            .getUser(token, customer.customer.registeredById)
            .then((r) => r.user)
            .catch(() => null)
        : null;

    return {
      customer: customer.customer,
      collectors: collectors?.items ?? [],
      registrarName: registrar?.name ?? null,
    };
  }).catch(throwAsRouteError); // 404, or 403 for someone else's customer

  const collector = result.collectors.find(
    (c) => c.id === result.customer.assignedCollectorId,
  );

  return data(
    {
      customer: result.customer,
      collectorName: collector?.name ?? null,
      // The same list, trimmed to what the reassignment dropdown needs. It was
      // already fetched to name the collector above, so editing costs no extra
      // request — which is half the point of editing here rather than on a page
      // of its own.
      collectors: result.collectors.map((c) => ({ id: c.id, name: c.name })),
      registrarName: result.registrarName,
      canManage: office,
    },
    { headers },
  );
}

type ActionData = {
  ok?: boolean;
  intent?: string;
  message?: string;
  formError?: string;
  fieldErrors?: Record<string, string>;
  /** Forwarded so the browser console shows what the API actually said. */
  failure?: ApiFailure;
};

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  /**
   * Every write here is office-only now, uploads included.
   *
   * Replacing a photo used to be the one thing a collector could do, because
   * `POST /customers/{id}/photo` admitted the assigned collector. That endpoint
   * is gone: a picture is now an uploaded URL written through
   * `PATCH /customers/{id}`, which is office-only. Letting a collector submit
   * the form would just earn them a 403 from the API.
   */
  if (!isOffice(user)) {
    return data<ActionData>({
      intent,
      formError: "Only office staff can manage customers.",
    });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      runIntent({ token, intent, id: params.id, form }),
    );
    return data(result, { headers });
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const failure = toApiFailure(error);
    // A 400 on the profile names the fields it objected to; those belong on the
    // inputs, not in a banner that says only "Request validation failed". The
    // other intents post no profile fields, so there is nothing to map for them.
    const apiFieldErrors =
      intent === "update-customer" ? fieldErrorsFromFailure(failure) : {};
    if (Object.keys(apiFieldErrors).length)
      return data<ActionData>({ intent, fieldErrors: apiFieldErrors, failure });
    return data<ActionData>({
      intent,
      formError:
        failure.status === 0
          ? "Something went wrong. Please try again."
          : failure.message,
      failure,
    });
  }
}

async function runIntent({
  token,
  intent,
  id,
  form,
}: {
  token: string;
  intent: string;
  id: string;
  form: FormData;
}): Promise<ActionData> {
  /**
   * The profile and its pictures save together, under one button — the same
   * shape as registration, which is the point: a photo is part of the record,
   * not an errand run beside it. There is no separate upload intent any more.
   *
   * Two steps, though, not one: the images go to `/uploads/images` and the URLs
   * that come back are folded into the same PATCH as the fields. The API no
   * longer takes a file at a customer's own URL — see
   * [customer-uploads.server.ts](app/lib/customer-uploads.server.ts).
   */
  if (intent === "update-customer") {
    // The same readers the register page runs, over the same field names — the
    // two share `CustomerProfile`, so they can't disagree about either.
    const { input, fieldErrors } = readCustomerForm(form);
    const { pending, fieldErrors: uploadErrors } = readImageSlots(form);
    Object.assign(fieldErrors, uploadErrors);

    if (Object.keys(fieldErrors).length)
      return { intent, fieldErrors } satisfies ActionData;

    // Same token for both legs, deliberately — `withAuth` wraps this whole
    // function, and asking it twice would spend the refresh token twice.
    const images = await uploadImageSlots(token, pending);
    await customersApi.updateCustomer(token, id, { ...input, ...images });

    return {
      ok: true,
      intent,
      message: pending.length
        ? `Profile and ${describeUploads(pending).toLowerCase()} updated.`
        : "Profile updated.",
    } satisfies ActionData;
  }

  if (intent === "deactivate") {
    await customersApi.deactivateCustomer(token, id);
    return {
      ok: true,
      intent,
      message: "Customer deactivated.",
    } satisfies ActionData;
  }

  if (intent === "activate") {
    await customersApi.activateCustomer(token, id);
    return {
      ok: true,
      intent,
      message: "Customer activated.",
    } satisfies ActionData;
  }

  return { formError: "Unsupported action." } satisfies ActionData;
}

export default function CustomerDetail({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { customer, collectorName, collectors, registrarName, canManage } =
    loaderData;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  // Which upload slots are holding a file — only to say so in the save bar,
  // since the pictures go with the profile whether or not there are any.
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const fileCount = Object.values(selected).filter(Boolean).length;

  /**
   * Editing is a URL state, not a `useState`: `?edit` survives a reload, gives
   * the back button something to undo, and lets the customers list link
   * straight into it. Cancel is then an ordinary link back to the bare path.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const editing = canManage && searchParams.has("edit");
  // The save button sits in the bar below the grid, outside the form it
  // submits — the form is one column of a grid and a bar spanning only that
  // column would stop short of the page.
  const profileFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (actionData?.ok) {
      notify.success(actionData.message ?? "Done.");
      // The files are stored now; the slots clear themselves off the new URLs.
      setSelected({});
      // A saved profile leaves edit mode. `replace` so the back button doesn't
      // drop straight back into the form that was just committed.
      if (actionData.intent === "update-customer")
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("edit");
            return next;
          },
          { replace: true },
        );
    } else if (actionData?.formError) notify.error(actionData.formError);
    if (actionData?.failure)
      console.error("[customer-detail] request failed:", actionData.failure);
  }, [actionData, setSearchParams]);

  /**
   * The profile takes the whole grid when there is no document column beside
   * it. A collector may not change anything, and their page would otherwise
   * show the record in three quarters of the width with a gap where the ID
   * scans aren't — those being office-only to view as well as to replace.
   */
  const profileColumn = `space-y-7 ${
    canManage ? "lg:col-span-2 xl:col-span-3" : "lg:col-span-3 xl:col-span-4"
  }`;

  const profile = (
    <CustomerProfile
      customer={customer}
      collectors={collectors}
      collectorName={collectorName}
      registrarName={registrarName}
      editing={editing}
      errors={actionData?.fieldErrors}
      showAssignment={canManage}
      // At the end of the Identity row, as on registration — a picture of
      // someone is identity in the same sense their name is. An upload slot
      // while editing, the picture itself when not; same frame either way, so
      // toggling edit doesn't move anything.
      photoSlot={
        editing ? (
          <UploadSlot
            compact
            camera
            field="photo"
            title="Photo"
            currentUrl={customer.photoUrl}
            error={actionData?.fieldErrors?.photo}
            onSelect={(has) => setSelected((prev) => ({ ...prev, photo: has }))}
          />
        ) : (
          <ImageView compact title="Photo" url={customer.photoUrl} />
        )
      }
    />
  );

  const recordGrid = (
    /* Four columns from `xl`, not three: the ID scans need about the same
       width whatever the screen, so giving the profile the extra quarter is
       what lets its fields sit three and four across instead of running down
       the page. */
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 xl:grid-cols-4">
      {/* The ID scans, and only those — the photo belongs with the name and
          date of birth, and sits at the end of the Identity row instead.

          Two sides, not one document: the API stores the front and back of an
          ID separately, and a Ghana Card's number is on the front while its
          expiry is on the back. */}
      {canManage && (
        <div className="space-y-4 lg:col-span-1">
          {editing ? (
            <>
              <UploadSlot
                field="idDocumentFront"
                title="ID document — front"
                hint="Stored at higher resolution for legibility."
                currentUrl={customer.idDocumentFrontUrl}
                error={actionData?.fieldErrors?.idDocumentFront}
                onSelect={(has) =>
                  setSelected((prev) => ({ ...prev, idDocumentFront: has }))
                }
              />
              <UploadSlot
                field="idDocumentBack"
                title="ID document — back"
                hint="The reverse of the same document."
                currentUrl={customer.idDocumentBackUrl}
                error={actionData?.fieldErrors?.idDocumentBack}
                onSelect={(has) =>
                  setSelected((prev) => ({ ...prev, idDocumentBack: has }))
                }
              />
            </>
          ) : (
            <>
              <ImageView
                title="ID document — front"
                url={customer.idDocumentFrontUrl}
              />
              <ImageView
                title="ID document — back"
                url={customer.idDocumentBackUrl}
              />
            </>
          )}
        </div>
      )}

      <div className={profileColumn}>{profile}</div>
    </div>
  );

  return (
    <div className="mx-auto w-full px-6 py-8">
      <PageHeader
        backTo="/customers"
        backLabel="Customers"
        title={customer.fullName}
        subtitle={`${CUSTOMER_STATUS_LABELS[customer.status]} · registered ${formatDate(customer.createdAt)}`}
        // Nothing up here while editing: opening a cycle or deactivating
        // someone mid-form would throw away everything typed, and the bar at
        // the foot of the page owns the two actions that do apply.
        actions={
          canManage &&
          !editing && (
            <>
              {/* First in the row: what someone is saving is asked far more
                  often than what their profile says, and opening a cycle
                  starts from that page too. */}
              <Link
                to={`/customers/${customer.id}/accounts`}
                className="flex min-h-9 items-center gap-1.5 rounded-md border-2 border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-background"
              >
                <PiggyBank size={14} />
                Accounts
              </Link>
              {/* A search param on this same page, not a route of its own —
                  the fields turn into inputs where they already sit. */}
              <Link
                to="?edit"
                className="flex min-h-9 items-center gap-1.5 rounded-md border-2 border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-background"
              >
                <Pencil size={14} />
                Edit
              </Link>
              <StatusButton customer={customer} />
            </>
          )
        }
      />

      {/* No "uploads failed" notice any more: registration uploads its images
          before it creates anything, so there is no longer a state where the
          customer exists but their pictures didn't arrive. */}

      {/* The accounts themselves are not listed here — this page is the
          identity record, and `/customers/:id/accounts` is the one place that
          shows what someone is saving. The Accounts button above goes there,
          and opening a cycle starts from that page. */}

      {/* One form over the whole grid while editing, exactly as on
          registration: the pictures and the fields are one record and save
          under one button. This used to be two forms, because the record
          already exists and a replacement photo had somewhere of its own to go
          — but that left an upload widget sitting on the page in plain view
          mode, and made this page behave differently from the one that creates
          the same thing. Not editing: no form at all, and the images are
          simply images.

          A ternary over one `recordGrid` element, not a wrapper component
          declared here — a component defined during render is a new type on
          every render, which would unmount the file inputs and drop whatever
          was waiting in them the moment any state changed. */}
      {editing ? (
        <Form
          method="post"
          ref={profileFormRef}
          encType="multipart/form-data"
          // Our own rules cover the same ground and can report in place; the
          // browser's bubbles would fire on `type="email"` first.
          noValidate
        >
          {/* Hidden rather than on the button: the bar below submits with
              `requestSubmit()` and no submitter, so a name/value on the button
              would never reach the action. */}
          <input type="hidden" name="intent" value="update-customer" />
          {recordGrid}
        </Form>
      ) : (
        recordGrid
      )}

      {/* Pinned to the foot of the page while editing: the profile is 25
          fields tall, and a save button only at the top would mean scrolling
          back up to commit a change made at the bottom. The negative margins
          cancel the page's gutter and its bottom padding so the bar spans the
          full width and sits flush against the edge. */}
      {editing && (
        <div className="sticky bottom-0 -mx-6 -mb-8 mt-6 flex flex-wrap items-center gap-3 border-t-2 border-border bg-surface px-6 py-3">
          {/* Normally the one rule of this form that isn't visible in it:
              `undefined` and "make this empty" look identical over the wire,
              so the API reads a cleared field as "leave it alone". A picture
              waiting to be sent displaces it — that is the more urgent thing
              to know, and it is true only while it is true. */}
          <p className="text-xs text-muted">
            {fileCount > 0
              ? `${fileCount === 1 ? "1 image" : `${fileCount} images`} will be uploaded when you save.`
              : "Clearing a field won't erase what's stored."}
          </p>

          <div className="ml-auto flex items-center gap-3">
            {/* A link, not a button: this genuinely navigates, back to the
                same page without the `edit` param. `replace` so cancelling
                doesn't leave the form in the history to go back into. */}
            <Link
              to={`/customers/${customer.id}`}
              replace
              className="flex min-h-9 items-center rounded-md px-3 text-sm font-medium text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              Cancel
            </Link>
            <Button
              type="button"
              size="sm"
              className="rounded-md bg-success"
              isDisabled={submitting}
              onPress={() => profileFormRef.current?.requestSubmit()}
            >
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Activate / deactivate, with a confirmation on the destructive direction. */
function StatusButton({ customer }: { customer: Customer }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);
  const isActive = customer.status === "active";

  return (
    <>
      <Form method="post" ref={formRef}>
        {/* The intent rides in a hidden field rather than on the button: a
            confirmed submit goes through `requestSubmit()` with no submitter,
            so a name/value on the button would never reach the action. */}
        <input
          type="hidden"
          name="intent"
          value={isActive ? "deactivate" : "activate"}
        />
        <Button
          type={isActive ? "button" : "submit"}
          size="sm"
          variant={isActive ? "danger" : "primary"}
          className="rounded-md"
          onPress={isActive ? () => setConfirming(true) : undefined}
        >
          {isActive ? <Ban size={14} /> : <RotateCcw size={14} />}
          {isActive ? "Deactivate" : "Activate"}
        </Button>
      </Form>

      <ConfirmModal
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Deactivate this customer?"
        footer={
          <Button
            size="sm"
            variant="danger"
            className="rounded-md"
            onPress={() => {
              setConfirming(false);
              formRef.current?.requestSubmit();
            }}
          >
            Deactivate
          </Button>
        }
      >
        <p className="text-sm text-muted">
          <span className="font-medium text-foreground">
            {customer.fullName}
          </span>{" "}
          will be marked inactive. Nothing is deleted — their history stays
          intact and you can reactivate them later.
        </p>
      </ConfirmModal>
    </>
  );
}
