import { useEffect, useRef, useState } from "react";
import { data, Form, Link, useNavigation, useSearchParams } from "react-router";
import { Button } from "@heroui/react";
import { Ban, HandCoins, Pencil, RotateCcw, WalletCards } from "lucide-react";
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
  const user = await requireUser(request);
  const office = isOffice(user);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const customer = await customersApi.getCustomer(token, params.id);

    const registrar =
      office && customer.customer.registeredById
        ? await usersApi
            .getUser(token, customer.customer.registeredById)
            .then((r) => r.user)
            .catch(() => null)
        : null;

    return {
      customer: customer.customer,
      registrarName: registrar?.name ?? null,
    };
  }).catch(throwAsRouteError); // 404

  return data(
    {
      customer: result.customer,
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
  if (intent === "update-customer") {
    const { input, fieldErrors } = readCustomerForm(form);
    const { pending, fieldErrors: uploadErrors } = readImageSlots(form);
    Object.assign(fieldErrors, uploadErrors);

    if (Object.keys(fieldErrors).length)
      return { intent, fieldErrors } satisfies ActionData;

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
  const { customer, registrarName, canManage } = loaderData;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const fileCount = Object.values(selected).filter(Boolean).length;

  const [searchParams, setSearchParams] = useSearchParams();
  const editing = canManage && searchParams.has("edit");
  const profileFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (actionData?.ok) {
      notify.success(actionData.message ?? "Done.");
      // The files are stored now; the slots clear themselves off the new URLs.
      setSelected({});
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

  const profileColumn = `space-y-7 ${
    canManage ? "lg:col-span-2 xl:col-span-3" : "lg:col-span-3 xl:col-span-4"
  }`;

  const profile = (
    <CustomerProfile
      customer={customer}
      registrarName={registrarName}
      editing={editing}
      errors={actionData?.fieldErrors}
      showRecord={canManage}
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
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 xl:grid-cols-4">
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
        actions={
          !editing && (
            <>
              <Link
                to={`/customers/${customer.id}/accounts`}
                className="flex min-h-9 items-center gap-1.5 rounded-md border-2 border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-background"
              >
                <WalletCards size={14} />
                Accounts
              </Link>
              {canManage && (
                <>
                  <Link
                    to={`/customers/${customer.id}/loans`}
                    className="flex min-h-9 items-center gap-1.5 rounded-md border-2 border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-background"
                  >
                    <HandCoins size={14} />
                    Loans
                  </Link>
                  <Link
                    to="?edit"
                    className="flex min-h-9 items-center gap-1.5 rounded-md border-2 border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-background"
                  >
                    <Pencil size={14} />
                    Edit
                  </Link>
                  <StatusButton customer={customer} />
                </>
              )}
            </>
          )
        }
      />

      {editing ? (
        <Form
          method="post"
          ref={profileFormRef}
          encType="multipart/form-data"
          noValidate
        >
          <input type="hidden" name="intent" value="update-customer" />
          {recordGrid}
        </Form>
      ) : (
        recordGrid
      )}

      {editing && (
        <div className="sticky bottom-0 -mx-6 -mb-8 mt-6 flex flex-wrap items-center gap-3 border-t-2 border-border bg-surface px-6 py-3">
          <p className="text-xs text-muted">
            {fileCount > 0
              ? `${fileCount === 1 ? "1 image" : `${fileCount} images`} will be uploaded when you save.`
              : "Clearing a field won't erase what's stored."}
          </p>

          <div className="ml-auto flex items-center gap-3">
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
