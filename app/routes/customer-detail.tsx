import { useEffect, useRef, useState } from "react";
import { data, Form, Link, useNavigation, useSearchParams } from "react-router";
import { Button } from "@heroui/react";
import { Ban, Pencil, Plus, RotateCcw } from "lucide-react";
import type { Route } from "./+types/customer-detail";
import { CustomerProfile, UploadSlot } from "~/components/customer-profile";
import { FIELD, FieldError } from "~/components/form-fields";
import { TextInput } from "~/components/inputs";
import { ConfirmModal } from "~/components/modals";
import { PageHeader } from "~/components/page-header";
import { notify } from "~/components/toast";
import {
  throwAsRouteError,
  toApiFailure,
  type ApiFailure,
} from "~/lib/api/client";
import * as customersApi from "~/lib/api/customers";
import * as susuApi from "~/lib/api/susu";
import * as usersApi from "~/lib/api/users";
import {
  CUSTOMER_STATUS_LABELS,
  type Customer,
} from "~/lib/customer-client";
import {
  fieldErrorsFromFailure,
  readCustomerForm,
  validateUpload,
} from "~/lib/customer-form";
import { formatDate } from "~/lib/format";
import { formatGhs, parseGhsAmount } from "~/lib/money";
import { readOpenAccountForm } from "~/lib/susu-form";
import { SUSU_CYCLE_TARGET } from "~/lib/susu-client";
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
    const [customer, collectors, susu] = await Promise.all([
      customersApi.getCustomer(token, params.id),
      // Only to name the assigned collector — and only office roles may ask.
      office
        ? usersApi.listUsers(token, {
            role: "collector",
            status: "active",
            limit: 100,
          })
        : null,
      // The accounts themselves are not shown here — they live on
      // `/susu?customer=<id>`. Only the count is wanted, to reset the open
      // dialog once a new one exists, so ask for a single item and read the
      // total off the envelope rather than pulling the whole holding down.
      susuApi.listSusuAccounts(token, { customerId: params.id, limit: 1 }),
    ]);
    return {
      customer: customer.customer,
      collectors: collectors?.items ?? [],
      susuAccountCount: susu.total,
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
      susuAccountCount: result.susuAccountCount,
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

  // Replacing the photo is the one write a collector is allowed, and only for
  // a customer assigned to them — which the API checks, not us. `runIntent`
  // gets `office` so it can refuse the ID document half of the same submit.
  const office = isOffice(user);
  if (!office && intent !== "upload-files") {
    return data<ActionData>({
      intent,
      formError: "Only office staff can manage customers.",
    });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      runIntent({ token, intent, id: params.id, form, office }),
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
  office,
}: {
  token: string;
  intent: string;
  id: string;
  form: FormData;
  office: boolean;
}): Promise<ActionData> {
  /**
   * Both slots post together under one button, so this handles whichever of
   * them carried a file. They still go to separate endpoints — the API takes
   * the photo and the ID document at their own URLs — but that is an
   * implementation detail the form shouldn't expose.
   */
  if (intent === "upload-files") {
    const photo = form.get("photo");
    const idDocument = form.get("idDocument");
    const hasPhoto = photo instanceof File && photo.size > 0;
    const hasIdDocument = idDocument instanceof File && idDocument.size > 0;

    if (!hasPhoto && !hasIdDocument)
      return { intent, formError: "Choose a file to upload." } satisfies ActionData;
    if (hasIdDocument && !office)
      return {
        intent,
        formError: "Only office staff can upload an ID document.",
      } satisfies ActionData;

    // The API answers 413/415 for these, but checking here saves uploading
    // several megabytes just to be told no. Both are checked before either is
    // sent, so a bad second file can't leave the first already committed.
    const fieldErrors: Record<string, string> = {};
    if (hasPhoto) {
      const error = validateUpload(photo);
      if (error) fieldErrors.photo = error;
    }
    if (hasIdDocument) {
      const error = validateUpload(idDocument);
      if (error) fieldErrors.idDocument = error;
    }
    if (Object.keys(fieldErrors).length)
      return { intent, fieldErrors } satisfies ActionData;

    const done: string[] = [];
    if (hasPhoto) {
      await customersApi.uploadCustomerPhoto(token, id, photo as File);
      done.push("Photo");
    }
    if (hasIdDocument) {
      await customersApi.uploadCustomerIdDocument(token, id, idDocument as File);
      done.push("ID document");
    }
    return {
      ok: true,
      intent,
      message: `${done.join(" and ")} updated.`,
    } satisfies ActionData;
  }

  if (intent === "update-customer") {
    // The same reader the register page runs, over the same field names — the
    // two share `CustomerProfile`, so they can't disagree about either.
    const { input, fieldErrors } = readCustomerForm(form);
    if (Object.keys(fieldErrors).length)
      return { intent, fieldErrors } satisfies ActionData;

    await customersApi.updateCustomer(token, id, input);
    return {
      ok: true,
      intent,
      message: "Profile updated.",
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

  if (intent === "open-susu") {
    const { dailyAmount, fieldErrors } = readOpenAccountForm(form);
    if (Object.keys(fieldErrors).length)
      return { intent, fieldErrors } satisfies ActionData;

    const { account } = await susuApi.openSusuAccount(token, {
      customerId: id,
      dailyAmount,
    });
    return {
      ok: true,
      intent,
      message: `Susu account opened at ${formatGhs(account.dailyAmount)} a day.`,
    } satisfies ActionData;
  }

  return { formError: "Unsupported action." } satisfies ActionData;
}

export default function CustomerDetail({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { customer, collectorName, collectors, susuAccountCount, canManage } =
    loaderData;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  // Which upload slots are holding a file. Lifted here because the single
  // submit button below them needs to know whether there is anything to send.
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const anySelected = Object.values(selected).some(Boolean);

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

  const profile = (
    <CustomerProfile
      customer={customer}
      collectors={collectors}
      collectorName={collectorName}
      editing={editing}
      errors={actionData?.fieldErrors}
      showAssignment={canManage}
    />
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
              {/* First in the row: opening a cycle is what this page gets
                  opened for, where editing a profile is occasional. An
                  inactive customer can't be given one — the API answers 422
                  CUSTOMER_INACTIVE — so the button isn't offered. */}
              {customer.status === "active" && (
                <OpenAccountButton
                  // Remounts once the account exists, which clears the amount
                  // out of the dialog. A rejected submit leaves the count
                  // unchanged, so the typed value survives to be corrected.
                  key={susuAccountCount}
                  error={actionData?.fieldErrors?.dailyAmount}
                />
              )}
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

      {/* Registration created the customer but couldn't store the files it
          came with. Said here rather than as a toast on the way in, because
          the fix is on this page: the slots below are where a retry goes, and
          the notice should still be there when someone gets to them. */}
      {searchParams.get("uploads") === "failed" && (
        <p
          role="alert"
          className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {customer.fullName} was registered, but the files chosen at the time
          didn't upload. Choose them again below.
        </p>
      )}

      {/* The cycles themselves are not listed here — this page is the identity
          record, and `/susu?customer=<id>` is the one place that shows what
          someone is saving. Opening an account still starts here, because an
          account belongs to a customer.

          Without that button there is nothing to explain its own absence, so
          an inactive customer gets a line saying why. */}
      {canManage && !editing && customer.status !== "active" && (
        <p className="mb-6 text-sm text-muted">
          Reactivate this customer to open a susu account.
        </p>
      )}

      {/* Four columns from `xl`, not three: the upload slots need about the
          same width whatever the screen, so giving the profile the extra
          quarter is what lets its fields sit three and four across instead of
          running down the page. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 xl:grid-cols-4">
        {/* Files first on mobile: the photo identifies the person at a glance,
            and it is the one thing a collector in the field can change.

            Its own form, separate from the profile's: the record already
            exists, so the files have somewhere to go on their own and there is
            no reason to make replacing a photo wait on the whole profile. On
            registration there is no id yet and the two have to travel
            together — which is the one place these pages differ. */}
        <Form
          method="post"
          encType="multipart/form-data"
          className="space-y-4 lg:col-span-1"
        >
          <input type="hidden" name="intent" value="upload-files" />

          <UploadSlot
            field="photo"
            title="Photo"
            hint="JPEG, PNG or WebP, up to 5 MB."
            currentUrl={customer.photoUrl}
            error={actionData?.fieldErrors?.photo}
            onSelect={(has) => setSelected((prev) => ({ ...prev, photo: has }))}
          />
          {/* The ID document is office-only, unlike the photo — don't offer a
              collector an upload the API will refuse. */}
          {canManage && (
            <UploadSlot
              field="idDocument"
              title="ID document"
              hint="Stored at higher resolution for legibility."
              currentUrl={customer.idDocumentUrl}
              error={actionData?.fieldErrors?.idDocument}
              onSelect={(has) =>
                setSelected((prev) => ({ ...prev, idDocument: has }))
              }
            />
          )}

          <Button
            type="submit"
            size="sm"
            className="rounded-md bg-success"
            // Nothing chosen means nothing to send.
            isDisabled={submitting || !anySelected}
          >
            {submitting ? "Uploading…" : "Upload"}
          </Button>
        </Form>

        {/* The same column either way. A `<Form>` only when there is something
            to submit — and a sibling of the upload form above, never a parent:
            nesting one form inside another is not allowed. */}
        {editing ? (
          <Form
            method="post"
            ref={profileFormRef}
            // Our own rules cover the same ground and can report in place; the
            // browser's bubbles would fire on `type="email"` first.
            noValidate
            className="space-y-7 lg:col-span-2 xl:col-span-3"
          >
            {/* Hidden rather than on the button: the bar below submits with
                `requestSubmit()` and no submitter, so a name/value on the
                button would never reach the action. */}
            <input type="hidden" name="intent" value="update-customer" />
            {profile}
          </Form>
        ) : (
          <div className="space-y-7 lg:col-span-2 xl:col-span-3">{profile}</div>
        )}
      </div>

      {/* Pinned to the foot of the page while editing: the profile is 25
          fields tall, and a save button only at the top would mean scrolling
          back up to commit a change made at the bottom. The negative margins
          cancel the page's gutter and its bottom padding so the bar spans the
          full width and sits flush against the edge. */}
      {editing && (
        <div className="sticky bottom-0 -mx-6 -mb-8 mt-6 flex flex-wrap items-center gap-3 border-t-2 border-border bg-surface px-6 py-3">
          {/* The one rule of this form that isn't visible in it: `undefined`
              and "make this empty" look identical over the wire, so the API
              reads a cleared field as "leave it alone". */}
          <p className="text-xs text-muted">
            Clearing a field won't erase what's stored.
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

/**
 * Open a cycle, from the page header.
 *
 * The daily amount is fixed for the life of the cycle — the only way to change
 * it is to close the account and open another — so the dialog does double duty:
 * it takes the amount and, as you type, states what it commits to. Reading back
 * `GHS 50,000.00` is what catches the missing decimal point; a ceiling invented
 * here would eventually refuse an account the API would have allowed.
 */
function OpenAccountButton({ error }: { error?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const pesewas = parseGhsAmount(amount);
  const valid = pesewas !== null && pesewas >= 1;

  // A rejected submit has to bring the dialog back, or the message lands on a
  // field that is no longer on screen. Adjusted during render rather than in an
  // effect, so there is no pass with the error set and the dialog still closed.
  const [seenError, setSeenError] = useState(error);
  if (error !== seenError) {
    setSeenError(error);
    if (error) setOpen(true);
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        className="min-h-6 rounded-md bg-success"
        onPress={() => setOpen(true)}
      >
        <Plus size={14} />
        Open account
      </Button>

      {/* The dialog renders in a portal, so the field inside it can't sit in
          this form. It posts the same state through a hidden input instead —
          which is also what lets the footer button submit from outside. */}
      <Form method="post" ref={formRef} className="hidden">
        <input type="hidden" name="intent" value="open-susu" />
        <input type="hidden" name="dailyAmount" value={amount} />
      </Form>

      <ConfirmModal
        isOpen={open}
        onOpenChange={setOpen}
        title="Open a susu account"
        closeLabel="Cancel"
        footer={
          <Button
            size="sm"
            className="rounded-md bg-success"
            isDisabled={!valid}
            onPress={() => {
              setOpen(false);
              formRef.current?.requestSubmit();
            }}
          >
            Open account
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <TextInput
              label="Daily amount"
              value={amount}
              onChange={setAmount}
              autoFocus
              inputProps={{
                // `decimal` so a phone keypad offers the point for pesewas.
                inputMode: "decimal",
                autoComplete: "off",
                placeholder: "5.00",
                className: `${FIELD} min-h-11`,
              }}
            />
            <FieldError message={error} />
          </div>

          <div className="space-y-3 text-sm text-muted">
            {/* Only once there is an amount to talk about — a sentence full of
                GHS 0.00 before anyone has typed is noise. */}
            {valid && (
              <p>
                <span className="font-medium text-foreground">
                  {formatGhs(pesewas)}
                </span>{" "}
                every day for {SUSU_CYCLE_TARGET} days —{" "}
                <span className="font-medium text-foreground">
                  {formatGhs(pesewas * SUSU_CYCLE_TARGET)}
                </span>{" "}
                over the full cycle.
              </p>
            )}
            <p>
              The daily amount can't be changed afterwards. To save a different
              amount, this account has to be closed and a new one opened — and
              one day's deposit is kept as commission when it closes.
            </p>
          </div>
        </div>
      </ConfirmModal>
    </>
  );
}
