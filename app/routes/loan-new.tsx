import {
  CheckIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  data,
  Form,
  useActionData,
  useFetcher,
  useNavigation,
} from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { apply as applyForLoan, getConfig } from "~/api/loans";
import { CustomerPicker, type PickedCustomer } from "~/components/customer-picker";
import { IDLE, ScanDrop, type Slot } from "~/components/scan-drop";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { parseCedis } from "~/lib/format";
import {
  DURATIONS,
  DURATION_LABELS,
  checkPrincipal,
  rateFor,
  withDefaults,
  type LoanDuration,
  type LoanEligibility,
} from "~/lib/loans";
import { requireCounter, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/loan-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "New loan application · Yadah Dynamic Enterprise" }];
}

/**
 * The config is read here so the form can price the loan as it is typed. It is
 * advisory: the API prices the loan again at approval, from whatever config is
 * in force then, and that is the figure that counts.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireCounter(request);
  const { data: result, headers } = await withAuth(request, (token) =>
    getConfig(token).catch(() => ({ config: null })),
  );
  return data({ config: withDefaults(result.config) }, { headers });
}

export async function action({ request }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const customerId = String(form.get("customerId") ?? "").trim();
  const guarantorName = String(form.get("guarantorName") ?? "").trim();
  const guarantorPhone = String(form.get("guarantorPhone") ?? "").trim();
  const guarantorIdNumber = String(form.get("guarantorIdNumber") ?? "").trim();
  const durationMonths = Number(form.get("durationMonths") ?? 0);
  const principal = parseCedis(String(form.get("principal") ?? "").trim());
  const signatureUrl = String(form.get("signatureUrl") ?? "").trim();

  if (!customerId) {
    return data({ error: "Choose the customer applying." }, { status: 400 });
  }
  if (guarantorName.length < 2) {
    return data({ error: "Enter the guarantor's name." }, { status: 400 });
  }
  if (!guarantorPhone) {
    return data({ error: "Enter the guarantor's phone number." }, { status: 400 });
  }
  if (!signatureUrl) {
    return data({ error: "Take a picture of the customer's signature." }, { status: 400 });
  }
  if (principal == null || principal <= 0) {
    return data({ error: "Enter how much they are asking for." }, { status: 400 });
  }
  if (!DURATIONS.includes(durationMonths as LoanDuration)) {
    return data({ error: "Choose a duration." }, { status: 400 });
  }

  let result: { loan: { id: string } };
  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ data: result, headers } = await withAuth(request, (token) =>
      applyForLoan(token, {
        customerId,
        principal,
        durationMonths,
        guarantor: {
          fullName: guarantorName,
          phone: guarantorPhone,
          ...(guarantorIdNumber ? { idNumber: guarantorIdNumber } : {}),
        },
        signatureUrl,
      }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }

  // Straight to the application, which is where the decision is made.
  await redirectWithToast(
    `/loans/${result.loan.id}`,
    {
      tone: "success",
      message: "Application recorded.",
    },
    headers,
  );
}

export default function LoanNew({ loaderData }: Route.ComponentProps) {
  const { config } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [guarantorName, setGuarantorName] = useState("");
  const [guarantorPhone, setGuarantorPhone] = useState("");
  const [principal, setPrincipal] = useState("");
  const [months, setMonths] = useState<LoanDuration>(6);
  // Uploaded the moment it is taken; the form only carries the URL.
  const [signature, setSignature] = useState<Slot>(IDLE);

  // Loaded the moment a customer is picked. The decision is a person's, so the
  // form's job is to put the history in front of them before they type a
  // figure — not to score it.
  const history = useFetcher<{ eligibility: LoanEligibility | null; error: string | null }>();
  useEffect(() => {
    if (customer) history.load(`/loans/eligibility/${customer.id}`);
    // `history` is a stable fetcher; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id]);

  const eligibility = customer ? history.data?.eligibility ?? null : null;

  const pesewas = parseCedis(principal);

  const fault =
    principal === ""
      ? null
      : checkPrincipal(config, pesewas, eligibility?.bigTierUnlocked ?? false);

  // The conditions the API refuses outright. Blocking the button on them saves
  // a round trip and, more to the point, saves telling a customer their
  // application went in when it did not.
  //
  // Only an explicit `false` blocks: an API that predates a field must not stop
  // every application, and it re-checks all of this itself on submit.
  const noId = eligibility?.customer.hasId === false;
  const noScans = eligibility?.customer.hasIdDocument === false;
  const alreadyOpen = eligibility?.openLoan != null;
  const blocked = noId || noScans || alreadyOpen;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  // The customer's standing, said once as a toast when their record comes in.
  // Red when something stops the application, plain otherwise.
  useEffect(() => {
    if (!customer || history.state !== "idle" || !history.data) return;
    const { eligibility: e, error } = history.data;
    if (error || !e) {
      toast.warning(error ?? "Could not read their history.");
      return;
    }
    const idMissing = e.customer.hasId === false;
    const photosMissing = e.customer.hasIdDocument === false;
    const open = e.openLoan != null;
    const lines = [
      idMissing ? "No ID recorded" : e.customer.hasGhanaCard ? "Ghana Card" : "ID recorded",
      photosMissing ? "ID photos missing" : "ID photos uploaded",
      open ? "Loan already open" : "No open loan",
      e.bigTierUnlocked ? "Big tier unlocked" : "Big tier locked",
    ];
    const description = (
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    );
    if (idMissing || photosMissing || open) {
      toast.error(customer.fullName, { description });
    } else {
      toast(customer.fullName, { description });
    }
    // Once per record read — not again on every keystroke elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.data, history.state]);

  return (
    <RouteSheet
      backTo="/loans"
      title="New loan application"
    >
      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {actionData?.error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <p className="font-medium">{actionData.error}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Customer<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <CustomerPicker value={customer} onChange={setCustomer} placeholder="" autoFocus />
          </div>


          {/* The guarantor. Anybody willing to stand behind the loan — they
              need not bank with the branch — written down as the paper
              names them. */}
          <fieldset className="space-y-3">
            <legend className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Guarantor
            </legend>
            <div className="space-y-1.5">
              <Label htmlFor="guarantorName" className="text-xs font-medium">
                Full name<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="guarantorName"
                name="guarantorName"
                value={guarantorName}
                onChange={(event) => setGuarantorName(event.target.value)}
                autoComplete="off"
                maxLength={120}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="guarantorPhone" className="text-xs font-medium">
                  Phone<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Input
                  id="guarantorPhone"
                  name="guarantorPhone"
                  value={guarantorPhone}
                  onChange={(event) => setGuarantorPhone(event.target.value)}
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  maxLength={16}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="guarantorIdNumber" className="text-xs font-medium">
                  ID number
                </Label>
                <Input
                  id="guarantorIdNumber"
                  name="guarantorIdNumber"
                  autoComplete="off"
                  maxLength={40}
                />
              </div>
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label
              htmlFor="principal"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Principal · GH₵<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="principal"
              name="principal"
              value={principal}
              onChange={(event) => setPrincipal(event.target.value)}
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={fault ? true : undefined}
              className={cn("tabular", fault && "border-destructive")}
            />
            {fault && <p className="text-xs text-destructive">{fault}</p>}
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Duration
            </legend>
            {/* Three fixed durations, each with its own flat rate, drawn as
                checkboxes. Underneath they are still radios: a loan has one
                duration, and a box that could tick two would be a lie. */}
            <div className="space-y-2 pt-1">
              {DURATIONS.map((d) => (
                <label key={d} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="durationMonths"
                    value={d}
                    checked={months === d}
                    onChange={() => setMonths(d)}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs transition-colors",
                      "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50",
                      months === d
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background",
                    )}
                  >
                    {months === d && <CheckIcon className="size-3.5" />}
                  </span>
                  <span>
                    {DURATION_LABELS[d]} · <span className="tabular">{rateFor(config, d)}%</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* The customer signs the paper application; the picture of that
              signature is what the record keeps. */}
          <input type="hidden" name="signatureUrl" value={signature.url ?? ""} />
          <ScanDrop
            label="Customer's signature"
            kind="signature"
            slot={signature}
            onChange={setSignature}
            captureTitle="Photograph the signature"
            frame="size-32"
            className="w-fit rounded-none border-0 bg-transparent p-0"
            dropClassName="size-32 px-2"
            required
          />
        </div>

        <SheetActions>
          <SheetCancel />
          <Button
            type="submit"
            disabled={
              submitting ||
              !customer ||
              guarantorName.trim().length < 2 ||
              !guarantorPhone.trim() ||
              !principal ||
              Boolean(fault) ||
              blocked ||
              signature.status !== "done"
            }
          >
            {submitting && <Loader2Icon className="animate-spin" />}
            Record application
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}
