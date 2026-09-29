import { CheckIcon, Loader2Icon, PlusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { data, Form, useActionData, useNavigation } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { recordPaperLoan } from "~/api/loans";
import { CustomerPicker, type PickedCustomer } from "~/components/customer-picker";
import { IDLE, ScanDrop, type Slot } from "~/components/scan-drop";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { DateField } from "~/components/ui/date-field";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatPesewas, parseCedis } from "~/lib/format";
import { DURATIONS, DURATION_LABELS, type LoanDuration } from "~/lib/loans";
import { requireOffice, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/loan-paper";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Add paper loan · Yadah Dynamic Enterprise" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  return null;
}

const RATES = [10, 20, 30] as const;
type Rate = (typeof RATES)[number];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Copies in a loan the branch made on paper before the system existed. The API
 * writes it as history — dated on the day the money went out, at the rate the
 * paper says is owed now, with each payment on its own day — so nothing here
 * lands in today's cash.
 */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const text = (key: string) => String(form.get(key) ?? "").trim();

  const customerId = text("customerId");
  const principal = parseCedis(text("principal"));
  const durationMonths = Number(text("durationMonths")) as LoanDuration;
  const ratePercent = Number(text("ratePercent")) as Rate;
  const disbursedOn = text("disbursedOn");
  const paperRef = text("paperRef");
  const paperPhotoUrl = text("paperPhotoUrl");

  // Payments come as two parallel lists, one entry per line on the form.
  const days = form.getAll("paidOn").map((v) => String(v).trim());
  const amounts = form.getAll("amountPaid").map((v) => String(v).trim());
  const repayments: { paidOn: string; amount: number }[] = [];
  for (const [i, day] of days.entries()) {
    const raw = amounts[i] ?? "";
    if (day === "" && raw === "") continue;
    const amount = parseCedis(raw);
    if (!DAY_RE.test(day) || amount == null || amount <= 0) {
      return data(
        { error: `Payment ${i + 1} needs both a date and an amount.` },
        { status: 400 },
      );
    }
    repayments.push({ paidOn: day, amount });
  }

  // Guarantors the same way: three parallel lists, one entry per block.
  const names = form.getAll("guarantorName").map((v) => String(v).trim());
  const phones = form.getAll("guarantorPhone").map((v) => String(v).trim());
  const ids = form.getAll("guarantorIdNumber").map((v) => String(v).trim());
  const guarantors: { fullName: string; phone: string; idNumber?: string }[] = [];
  for (const [i, fullName] of names.entries()) {
    const phone = phones[i] ?? "";
    const idNumber = ids[i] ?? "";
    if (fullName === "" && phone === "" && idNumber === "") continue;
    if (fullName === "" || phone === "") {
      return data(
        { error: `Guarantor ${i + 1} needs both a name and a phone.` },
        { status: 400 },
      );
    }
    guarantors.push({ fullName, phone, ...(idNumber ? { idNumber } : {}) });
  }

  if (!customerId) return data({ error: "Choose the customer." }, { status: 400 });
  if (principal == null || principal <= 0) {
    return data({ error: "Enter the amount borrowed." }, { status: 400 });
  }
  if (!DURATIONS.includes(durationMonths)) {
    return data({ error: "Choose the duration." }, { status: 400 });
  }
  if (!RATES.includes(ratePercent)) {
    return data({ error: "Choose the rate owed now." }, { status: 400 });
  }
  if (!DAY_RE.test(disbursedOn)) {
    return data({ error: "Choose the date the money was given." }, { status: 400 });
  }

  let result: { loan: { id: string } };
  let headers: { "Set-Cookie": string } | undefined;
  try {
    ({ data: result, headers } = await withAuth(request, (token) =>
      recordPaperLoan(token, {
        customerId,
        principal,
        durationMonths,
        ratePercent,
        disbursedOn,
        repayments,
        guarantors,
        ...(paperRef ? { paperRef } : {}),
        ...(paperPhotoUrl ? { paperPhotoUrl } : {}),
      }),
    ));
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  await redirectWithToast(
    `/loans/${result.loan.id}`,
    { tone: "success", message: "Paper loan recorded." },
    headers,
  );
}

/** Flat interest on the principal — what the paper's rate works out to. */
function totalFor(principal: number, rate: number): number {
  return principal + Math.round((principal * rate) / 100);
}

export default function LoanPaper() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [principal, setPrincipal] = useState("");
  const [months, setMonths] = useState<LoanDuration>(3);
  const [rate, setRate] = useState<Rate>(10);
  const [photo, setPhoto] = useState<Slot>(IDLE);

  // One line per payment on the paper. Keys only, so removing a line never
  // shifts what somebody typed into the line below it.
  const nextKey = useRef(1);
  const [lines, setLines] = useState<number[]>([0]);
  const [paid, setPaid] = useState<Record<number, string>>({});
  // One block per guarantor the paper names, keyed the same way.
  const [guarantors, setGuarantors] = useState<number[]>(() => [nextKey.current++]);

  const pesewas = parseCedis(principal);
  const totalDue = pesewas != null && pesewas > 0 ? totalFor(pesewas, rate) : null;
  const totalPaid = lines.reduce((sum, key) => sum + (parseCedis(paid[key] ?? "") ?? 0), 0);
  const over = totalDue != null && totalPaid > totalDue;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  const label = "text-xs font-medium tracking-wide text-muted-foreground uppercase";
  const today = new Date();

  return (
    <RouteSheet backTo="/loans" title="Add paper loan">
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
            <Label className={label}>
              Customer<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <CustomerPicker value={customer} onChange={setCustomer} placeholder="" autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="principal" className={label}>
                Amount · GH₵<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="principal"
                name="principal"
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                className="tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="disbursedOn" className={label}>
                Date given<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <DateField
                id="disbursedOn"
                name="disbursedOn"
                placeholder=""
                matcher={{ after: today }}
                startMonth={new Date(2000, 0)}
                endMonth={today}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <fieldset className="space-y-1.5">
              <legend className={label}>Duration</legend>
              <div className="space-y-2 pt-1">
                {DURATIONS.map((d) => (
                  <Choice
                    key={d}
                    name="durationMonths"
                    value={d}
                    checked={months === d}
                    onChange={() => setMonths(d)}
                  >
                    {DURATION_LABELS[d]}
                  </Choice>
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-1.5">
              <legend className={label}>Rate owed now</legend>
              <div className="space-y-2 pt-1">
                {RATES.map((r) => (
                  <Choice
                    key={r}
                    name="ratePercent"
                    value={r}
                    checked={rate === r}
                    onChange={() => setRate(r)}
                  >
                    <span className="tabular">{r}%</span>
                  </Choice>
                ))}
              </div>
            </fieldset>
          </div>

          <fieldset className="space-y-2">
            <legend className={cn(label, "mb-1.5")}>Payments already made</legend>
            {lines.length > 0 && (
              <div className="flex gap-2 text-xs font-medium" aria-hidden>
                <span className="flex-1">Date</span>
                <span className="w-32">Amount · GH₵</span>
                <span className="w-9" />
              </div>
            )}
            {lines.map((key, i) => (
              <div key={key} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <DateField
                    name="paidOn"
                    placeholder=""
                    matcher={{ after: today }}
                    startMonth={new Date(2000, 0)}
                    endMonth={today}
                  />
                </div>
                <Input
                  name="amountPaid"
                  value={paid[key] ?? ""}
                  onChange={(e) => setPaid((p) => ({ ...p, [key]: e.target.value }))}
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={`Payment ${i + 1} amount`}
                  className="tabular w-32"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove payment ${i + 1}`}
                  onClick={() => setLines((l) => l.filter((k) => k !== key))}
                >
                  <XIcon />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((l) => [...l, nextKey.current++])}
            >
              <PlusIcon /> Add payment
            </Button>
            {totalDue != null && (
              <p className={cn("tabular text-sm", over ? "text-destructive" : "text-muted-foreground")}>
                {formatPesewas(totalPaid)} paid of {formatPesewas(totalDue)} owed
                {!over && totalPaid === totalDue ? " · fully repaid" : ""}
              </p>
            )}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className={cn(label, "mb-1.5")}>
              {guarantors.length > 1 ? "Guarantors" : "Guarantor"}
            </legend>
            {guarantors.map((key, i) => (
              <div
                key={key}
                className={cn("space-y-3", i > 0 && "border-t border-border pt-3")}
              >
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Label htmlFor={`guarantorName-${key}`} className="text-xs font-medium">
                      Full name
                    </Label>
                    <Input
                      id={`guarantorName-${key}`}
                      name="guarantorName"
                      autoComplete="off"
                      maxLength={120}
                    />
                  </div>
                  {i > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove guarantor ${i + 1}`}
                      onClick={() => setGuarantors((g) => g.filter((k) => k !== key))}
                    >
                      <XIcon />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`guarantorPhone-${key}`} className="text-xs font-medium">
                      Phone
                    </Label>
                    <Input
                      id={`guarantorPhone-${key}`}
                      name="guarantorPhone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="off"
                      maxLength={16}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`guarantorIdNumber-${key}`} className="text-xs font-medium">
                      ID number
                    </Label>
                    <Input
                      id={`guarantorIdNumber-${key}`}
                      name="guarantorIdNumber"
                      autoComplete="off"
                      maxLength={40}
                    />
                  </div>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setGuarantors((g) => [...g, nextKey.current++])}
            >
              <PlusIcon /> Add guarantor
            </Button>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="paperRef" className={label}>
              Paper no
            </Label>
            <Input id="paperRef" name="paperRef" autoComplete="off" maxLength={40} />
          </div>

          <input type="hidden" name="paperPhotoUrl" value={photo.url ?? ""} />
          <ScanDrop
            label="Photo of the paper form"
            kind="document"
            slot={photo}
            onChange={setPhoto}
            captureTitle="Photograph the paper form"
            frame="size-32"
            className="w-fit rounded-none border-0 bg-transparent p-0"
            dropClassName="size-32 px-2"
          />
        </div>

        <SheetActions>
          <SheetCancel />
          <Button
            type="submit"
            disabled={
              submitting ||
              !customer ||
              pesewas == null ||
              pesewas <= 0 ||
              over ||
              photo.status === "uploading"
            }
          >
            {submitting && <Loader2Icon className="animate-spin" />}
            Record paper loan
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}

/** A single choice drawn as a checkbox, the way the application form draws them. */
function Choice({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: number;
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs transition-colors",
          "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background",
        )}
      >
        {checked && <CheckIcon className="size-3.5" />}
      </span>
      <span>{children}</span>
    </label>
  );
}
