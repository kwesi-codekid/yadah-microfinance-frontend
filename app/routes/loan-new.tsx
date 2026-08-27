import {
  CheckIcon,
  IdCardIcon,
  Loader2Icon,
  LockIcon,
  MinusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { data, Form, useActionData, useFetcher, useNavigation } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { apply as applyForLoan, getConfig } from "~/api/loans";
import { CustomerPicker, type PickedCustomer } from "~/components/customer-picker";
import { Figure } from "~/components/listing";
import { RouteSheet, SheetActions, SheetCancel } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatAmount, formatPesewas, parseCedis } from "~/lib/format";
import {
  DURATIONS,
  DURATION_LABELS,
  checkPrincipal,
  interestOn,
  rateFor,
  tierFor,
  withDefaults,
  type LoanDuration,
  type LoanEligibility,
} from "~/lib/loans";
import { requireOffice, withAuth } from "~/lib/session.server";
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
  await requireOffice(request);
  const { data: result, headers } = await withAuth(request, (token) =>
    getConfig(token).catch(() => ({ config: null })),
  );
  return data({ config: withDefaults(result.config) }, { headers });
}

export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const customerId = String(form.get("customerId") ?? "").trim();
  const durationMonths = Number(form.get("durationMonths") ?? 0);
  const principal = parseCedis(String(form.get("principal") ?? "").trim());

  if (!customerId) {
    return data({ error: "Choose the customer applying." }, { status: 400 });
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
      applyForLoan(token, { customerId, principal, durationMonths }),
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
      description: "Nothing is disbursed until someone approves it.",
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
  const [principal, setPrincipal] = useState("");
  const [months, setMonths] = useState<LoanDuration>(6);

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
  const loading = customer != null && history.state !== "idle";

  const pesewas = parseCedis(principal);
  const rate = rateFor(config, months);
  const interest = pesewas != null ? interestOn(pesewas, rate) : 0;
  const tier = pesewas != null ? tierFor(config, pesewas) : null;

  const fault =
    principal === ""
      ? null
      : checkPrincipal(config, pesewas, eligibility?.bigTierUnlocked ?? false);

  // Two conditions the API refuses outright. Blocking the button on them saves
  // a round trip and, more to the point, saves telling a customer their
  // application went in when it did not.
  const noCard = eligibility != null && !eligibility.customer.hasGhanaCard;
  const alreadyOpen = eligibility?.openLoan != null;
  const blocked = noCard || alreadyOpen;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  return (
    <RouteSheet
      backTo="/loans"
      title="New loan application"
      description="Recorded now, decided by a person afterwards."
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
            <CustomerPicker value={customer} onChange={setCustomer} autoFocus />
          </div>

          {customer && (
            <HistoryPanel
              loading={loading}
              eligibility={eligibility}
              error={history.data?.error ?? null}
            />
          )}

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
              placeholder="0.00"
              autoComplete="off"
              aria-invalid={fault ? true : undefined}
              className={cn("tabular", fault && "border-destructive")}
            />
            <p
              className={cn(
                "text-xs",
                fault ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {fault ??
                `Small: GH₵ ${formatAmount(config.smallMinPesewas)}–${formatAmount(config.smallMaxPesewas)}. Big: up to GH₵ ${formatAmount(config.bigMaxPesewas)}.`}
            </p>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Duration
            </legend>
            {/* Three fixed durations, each with its own flat rate. A segmented
                control rather than a dropdown: the rate is the thing being
                chosen, and it should be visible in all three options at once. */}
            <div className="grid grid-cols-3 gap-2">
              {DURATIONS.map((d) => (
                <label
                  key={d}
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-0.5 rounded-lg border px-3 py-2.5 text-center transition-colors",
                    "focus-within:ring-2 focus-within:ring-ring",
                    months === d
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-input hover:bg-accent",
                  )}
                >
                  <input
                    type="radio"
                    name="durationMonths"
                    value={d}
                    checked={months === d}
                    onChange={() => setMonths(d)}
                    className="sr-only"
                  />
                  <span className="text-sm font-medium">{DURATION_LABELS[d]}</span>
                  <span
                    className={cn(
                      "tabular text-xs",
                      months === d ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {rateFor(config, d)}% flat
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* What the loan costs, worked out before anyone commits to it. Flat
              interest on the principal, so this figure does not change with
              early repayment — which is the part customers ask about. */}
          {pesewas != null && !fault && (
            <dl className="grid grid-cols-2 gap-3">
              <Figure
                label="Interest"
                value={formatPesewas(interest)}
                hint={`${rate}% of the principal, flat`}
              />
              <Figure
                label="Total repayable"
                value={formatPesewas(pesewas + interest)}
                hint={
                  tier
                    ? `${tier === "big" ? "Big" : "Small"} tier · ${months} months`
                    : undefined
                }
              />
              <Figure
                label="Monthly instalment"
                value={formatPesewas(Math.floor((pesewas + interest) / months))}
                hint="The remainder folds into the last one"
                className="col-span-2"
              />
            </dl>
          )}

          <p className="text-xs text-muted-foreground">
            These figures use the rates in force today. The rate and the schedule
            are locked from the config at the moment someone approves it.
          </p>
        </div>

        <SheetActions>
          <SheetCancel />
          <Button
            type="submit"
            disabled={submitting || !customer || !principal || Boolean(fault) || blocked}
          >
            {submitting && <Loader2Icon className="animate-spin" />}
            Record application
          </Button>
        </SheetActions>
      </Form>
    </RouteSheet>
  );
}

/* ----------------------------------------------------------------- history --- */

/**
 * The decision aid. Four months of the customer's own record, plus the two
 * conditions that stop an application dead — no Ghana Card on the profile, and
 * a loan already open. Both are refusals the API would make anyway; saying them
 * here means nobody promises a customer something that cannot happen.
 */
function HistoryPanel({
  loading,
  eligibility,
  error,
}: {
  loading: boolean;
  eligibility: LoanEligibility | null;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        Reading their history…
      </div>
    );
  }

  if (error || !eligibility) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
        <span>
          {error ?? "Could not read their history."} The application can still be
          recorded — the API checks the conditions again when it is submitted.
        </span>
      </div>
    );
  }

  const noCard = !eligibility.customer.hasGhanaCard;
  const alreadyOpen = eligibility.openLoan != null;

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
      <h3 className="eyebrow text-muted-foreground">Their record</h3>

      <dl className="grid grid-cols-2 gap-3">
        <Figure
          label="Saving for"
          value={`${eligibility.monthsOfHistory} month${eligibility.monthsOfHistory === 1 ? "" : "s"}`}
        />
        <Figure
          label="Susu paid in"
          value={formatPesewas(eligibility.susu.totalDeposited)}
          hint={`${eligibility.susu.accounts} account${eligibility.susu.accounts === 1 ? "" : "s"}, ${eligibility.susu.activeAccounts} active`}
        />
        <Figure
          label="Savings balance"
          value={formatPesewas(eligibility.savings.totalBalance)}
          hint={`${eligibility.savings.accounts} account${eligibility.savings.accounts === 1 ? "" : "s"}`}
          className="col-span-2"
        />
      </dl>

      <ul className="space-y-1.5 text-sm">
        <Condition met={!noCard} icon={<IdCardIcon className="size-4" />}>
          {noCard
            ? "No Ghana Card on the profile. Add it before applying."
            : "Ghana Card on file."}
        </Condition>
        <Condition met={!alreadyOpen}>
          {alreadyOpen
            ? "A loan is already open. Only one at a time."
            : "No loan currently open."}
        </Condition>
        <Condition
          met={eligibility.bigTierUnlocked}
          neutral={!eligibility.bigTierUnlocked}
          icon={eligibility.bigTierUnlocked ? undefined : <LockIcon className="size-4" />}
        >
          {eligibility.bigTierUnlocked
            ? "Big tier unlocked by a small loan repaid on time."
            : "Big tier locked until a small loan is repaid on time."}
        </Condition>
      </ul>
    </section>
  );
}

function Condition({
  met,
  neutral,
  icon,
  children,
}: {
  met: boolean;
  /** A condition that limits the application without blocking it. */
  neutral?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const tone = met ? "text-success" : neutral ? "text-muted-foreground" : "text-danger";
  return (
    <li className="flex items-start gap-2">
      <span className={cn("mt-0.5 shrink-0", tone)}>
        {icon ?? (met ? <CheckIcon className="size-4" /> : <MinusIcon className="size-4" />)}
      </span>
      <span className={met ? "text-muted-foreground" : "text-foreground"}>
        {children}
      </span>
    </li>
  );
}
