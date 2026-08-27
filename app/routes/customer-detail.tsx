import {
  BanIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PrinterIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { data, Link, useFetcher } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import {
  activateCustomer,
  deactivateCustomer,
  getCustomer,
  trashCustomer,
} from "~/api/customers";
import { ApiError } from "~/api/error";
import { BackLink, Page } from "~/components/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { isOffice } from "~/lib/auth";
import {
  ID_TYPE_LABELS,
  type Customer,
  type CustomerStatus,
} from "~/lib/customers";
import { formatAccraDate, relativeDayLabel } from "~/lib/format";
import { requireOffice, requireUser, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/customer-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.customer.fullName ?? "Customer";
  return [{ title: `${name} · Yadah Dynamic Enterprise` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      return await getCustomer(token, params.id);
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  // The API names whoever registered the customer with an id and nothing else,
  // and there is no user lookup on this screen. Naming the one person we can
  // name — the viewer — beats printing a raw id at them.
  const registeredBy =
    result.customer.registeredById === user.id ? user.name : null;

  return data(
    { customer: result.customer, canEdit: isOffice(user), registeredBy },
    { headers },
  );
}

interface ActionResult {
  ok: boolean;
  message: string;
  holdings?: Record<string, number>;
}

/**
 * Deactivate, reactivate and move-to-trash, from the header menu. Trashing
 * leaves nothing to show, so it redirects back to the listing; the other two
 * stay put and let the loader re-run.
 */
export async function action({ request, params }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const reason = String(form.get("reason") ?? "").trim();

  try {
    const { data: result, headers } = await withAuth(request, async (token) => {
      if (intent === "deactivate") {
        await deactivateCustomer(token, params.id);
        return { message: "Customer deactivated.", gone: false };
      }
      if (intent === "activate") {
        await activateCustomer(token, params.id);
        return { message: "Customer reactivated.", gone: false };
      }
      if (intent === "trash") {
        await trashCustomer(token, params.id, reason || undefined);
        return { message: "Customer moved to the trash.", gone: true };
      }
      throw new Response("Unknown action.", { status: 400 });
    });

    if (result.gone) {
      await redirectWithToast(
        "/customers",
        { tone: "success", message: result.message },
        headers,
      );
    }
    return data<ActionResult>({ ok: true, message: result.message }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return data<ActionResult>(
        { ok: false, message: error.message, holdings: openHoldings(error) },
        { status: error.status },
      );
    }
    throw error;
  }
}

/** The `{ susu, savings, loans, hirePurchase }` counts on a `CANNOT_TRASH`. */
function openHoldings(error: ApiError): Record<string, number> | undefined {
  if (error.code !== "CANNOT_TRASH" || typeof error.details !== "object" || !error.details) {
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(error.details as Record<string, unknown>)) {
    if (typeof value === "number" && value > 0) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

const HOLDING_LABELS: Record<string, string> = {
  susu: "susu account(s)",
  savings: "savings account(s)",
  loans: "loan(s)",
  hirePurchase: "hire-purchase agreement(s)",
};

/**
 * The record, read-only, laid out exactly as the registration form lays it out:
 * the two ID scans down a left rail, then the same sections in the same order
 * with the same field names beside them. Reading a customer and editing one
 * should not feel like two different screens, so the only thing that changes
 * here is that each input is replaced by the value it would hold.
 */
export default function CustomerDetail({ loaderData }: Route.ComponentProps) {
  const { customer, canEdit, registeredBy } = loaderData;
  const registered = `${relativeDayLabel(customer.createdAt)} · ${formatAccraDate(customer.createdAt)}`;
  const kin = customer.nextOfKin;
  const id = customer.identification;

  return (
    <Page className="max-w-none">
      <BackLink to="/customers" className="mb-4">
        All customers
      </BackLink>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="font-heading text-2xl font-bold tracking-tight">
              {customer.fullName}
            </h2>
            <StatusPill status={customer.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="tabular">#{shortId(customer.id)}</span>
            {" · Registered "}
            {registered}
          </p>
        </div>
        {canEdit && <HeaderActions customer={customer} />}
      </div>

      {customer.status === "inactive" && (
        <p className="mb-6 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          This customer is deactivated. Their records are kept and stay visible,
          but the profile and its accounts cannot be edited until they are
          reactivated.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Left rail: the two ID document scans. */}
        <div className="space-y-4">
          <DocScan label="ID document — front" url={customer.idDocumentFrontUrl} />
          <DocScan label="ID document — back" url={customer.idDocumentBackUrl} />
        </div>

        {/* Right: the record. */}
        <div className="space-y-6">
          <Section title="Identity">
            <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
              <Fld label="Full name" value={customer.fullName} />
              <Fld
                label="Date of birth"
                value={
                  customer.dateOfBirth ? formatAccraDate(customer.dateOfBirth) : undefined
                }
              />
              <Fld label="Gender" value={customer.gender} capitalize />

              {/* Photo occupies the fourth column across both rows. */}
              <div className="sm:col-span-2 xl:col-span-1 xl:col-start-4 xl:row-start-1 xl:row-span-2">
                <PhotoScan url={customer.photoUrl} name={customer.fullName} />
              </div>

              <Fld label="Marital status" value={customer.maritalStatus} capitalize />
              <Fld label="Nationality" value={customer.nationality} />
              <Fld label="Mother's maiden name" value={customer.mothersMaidenName} />
            </div>
          </Section>

          <Section title="Contact">
            <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
              <Fld label="Phone" value={customer.phone} tabular />
              <Fld label="Alternate phone" value={customer.altPhone} tabular />
              <Fld label="Email" value={customer.email} />
              <Fld label="GhanaPost GPS" value={customer.ghanaPostGps} tabular />
              <Fld label="Residential address" value={customer.residentialAddress} />
              <Fld label="Postal address" value={customer.postalAddress} />
            </div>
          </Section>

          <Section title="Identification">
            <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
              <Fld label="ID type" value={id?.idType ? ID_TYPE_LABELS[id.idType] : undefined} />
              <Fld label="ID number" value={id?.idNumber} tabular />
              <Fld
                label="Expiry date"
                value={id?.idExpiryDate ? formatAccraDate(id.idExpiryDate) : undefined}
              />
              {/* Write-only on the API: it accepts a place of issue on the way
                  in and never returns one, so there is nothing to show. */}
              <Fld label="Place of issue" value={undefined} />
            </div>
          </Section>

          <Section title="Work">
            <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
              <Fld label="Occupation" value={customer.occupation} />
              <Fld label="Employer or business" value={customer.employerOrBusiness} />
              <Fld label="Purpose of account" value={customer.purposeOfAccount} />
            </div>
          </Section>

          <Section title="Next of kin">
            <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
              <Fld label="Full name" value={kin?.fullName} />
              <Fld label="Relationship" value={kin?.relationship} capitalize />
              <Fld label="Phone" value={kin?.phone} tabular />
              <Fld label="Address" value={kin?.address} />
            </div>
          </Section>

          <Section title="Record">
            <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
              <Fld
                label="Registered by"
                value={registeredBy ?? undefined}
                fallback={`Staff #${shortId(customer.registeredById)}`}
              />
            </div>
          </Section>
        </div>
      </div>
    </Page>
  );
}

/** Statement · Print · Edit, plus the state changes behind an ellipsis. */
function HeaderActions({ customer }: { customer: Customer }) {
  const fetcher = useFetcher<ActionResult>();
  const [confirm, setConfirm] = useState<"deactivate" | "trash" | null>(null);
  const [reason, setReason] = useState("");
  const active = customer.status === "active";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      toast.success(fetcher.data.message);
      return;
    }
    const { message, holdings } = fetcher.data;
    toast.error(message, {
      description: holdings
        ? `Still open: ${Object.entries(holdings)
            .map(([k, n]) => `${n} ${HOLDING_LABELS[k] ?? k}`)
            .join(", ")}.`
        : undefined,
    });
  }, [fetcher.state, fetcher.data]);

  const submit = (intent: "deactivate" | "activate" | "trash") =>
    fetcher.submit(intent === "trash" ? { intent, reason } : { intent }, {
      method: "post",
    });

  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <Link to={`/customers/${customer.id}/statement`}>
          <FileTextIcon />
          Statement
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a
          href={`/customers/${customer.id}/registration-form`}
          target="_blank"
          rel="noreferrer"
        >
          <PrinterIcon />
          Print
        </a>
      </Button>
      <Button asChild size="sm" disabled={!active}>
        <Link to={`/customers/${customer.id}/edit`}>
          <PencilIcon />
          Edit
        </Link>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8">
            <MoreHorizontalIcon />
            <span className="sr-only">More actions for {customer.fullName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {active ? (
            <DropdownMenuItem
              variant="destructive"
              onSelect={(e) => {
                e.preventDefault();
                setConfirm("deactivate");
              }}
            >
              <BanIcon />
              Deactivate
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => submit("activate")}>
              <CircleCheckIcon />
              Activate
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setReason("");
              setConfirm("trash");
            }}
          >
            <Trash2Icon />
            Move to trash
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          {confirm === "trash" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Move {customer.fullName} to the trash?</AlertDialogTitle>
                <AlertDialogDescription>
                  They disappear from the listings and from lookups, and can be
                  restored from Trash. Their phone number stays reserved. This is
                  refused while they still hold an open susu account, savings
                  account, loan or hire-purchase agreement.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-1.5">
                <Label
                  htmlFor="trash-reason"
                  className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
                >
                  Reason (optional)
                </Label>
                <Textarea
                  id="trash-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={300}
                  rows={2}
                  placeholder="Duplicate record, registered in error…"
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() => submit("trash")}
                >
                  Move to trash
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Deactivate {customer.fullName}?</AlertDialogTitle>
                <AlertDialogDescription>
                  They stay visible and their records are kept, but the profile and
                  its accounts cannot be edited until reactivated.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() => submit("deactivate")}
                >
                  Deactivate
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------------------------------------------------------- the record, read --- */

/**
 * The read-only twin of the form's `Section`. The same heading, with a rule
 * under it: without input boxes there is nothing left to separate one block of
 * text from the next.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="border-t border-border pt-4">{children}</div>
    </section>
  );
}

/** The read-only twin of the form's `Fld`: the same label, over the value. */
function Fld({
  label,
  value,
  fallback,
  tabular,
  capitalize,
}: {
  label: string;
  value?: string | null;
  /** Shown muted in place of the em dash when the blank needs explaining. */
  fallback?: string;
  tabular?: boolean;
  capitalize?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={cn(
          "text-sm break-words",
          value ? "text-foreground" : "text-muted-foreground",
          value && tabular && "tabular",
          value && capitalize && "capitalize",
        )}
      >
        {value || fallback || "—"}
      </p>
    </div>
  );
}

/** One ID scan, in the slot the form's dropzone occupies. */
function DocScan({ label, url }: { label: string; url?: string }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{label}</p>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="group relative block overflow-hidden rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <img src={url} alt={label} className="h-40 w-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center gap-1.5 bg-foreground/50 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <ExternalLinkIcon className="size-3.5" />
            Open full size
          </span>
        </a>
      ) : (
        <Missing className="h-40" />
      )}
    </div>
  );
}

/** The customer photo, in the slot the form's photo uploader occupies. */
function PhotoScan({ url, name }: { url?: string; name: string }) {
  return (
    <div className="flex h-full w-full flex-col space-y-1.5 sm:w-44">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Photo
      </p>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="group relative block min-h-32 w-full flex-1 overflow-hidden rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <img src={url} alt={name} className="size-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center bg-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <ExternalLinkIcon className="size-4 text-white" />
          </span>
        </a>
      ) : (
        <Missing className="min-h-32 flex-1" />
      )}
    </div>
  );
}

/** An image the record does not carry — the empty dropzone, without the drop. */
function Missing({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex w-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground",
        className,
      )}
    >
      None
    </div>
  );
}

function StatusPill({ status }: { status: CustomerStatus }) {
  const active = status === "active";
  return (
    <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap">
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", active ? "bg-success" : "bg-muted-foreground/50")}
      />
      <span className={active ? "text-foreground" : "text-muted-foreground"}>
        {active ? "Active" : "Inactive"}
      </span>
    </span>
  );
}

function shortId(id: string): string {
  return id.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase() || id.toUpperCase();
}
