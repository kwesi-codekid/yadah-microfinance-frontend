import { useEffect, useRef, useState } from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useNavigation,
  useSubmit,
} from "react-router";
import { Button } from "@heroui/react";
import {
  BadgeCheck,
  CircleAlert,
  HandCoins,
  IdCard,
  Landmark,
  PiggyBank,
  TriangleAlert,
} from "lucide-react";
import type { Route } from "./+types/customer-loans";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { DataTable, Table } from "~/components/data-table";
import { FIELD, FieldError } from "~/components/form-fields";
import { Kpi } from "~/components/kpi";
import { LoanStatusPill } from "~/components/loan-status";
import { TextInput } from "~/components/inputs";
import { ConfirmModal } from "~/components/modals";
import { SideDrawer } from "~/components/side-drawer";
import { notify } from "~/components/toast";
import {
  throwAsRouteError,
  toApiFailure,
  type ApiFailure,
} from "~/lib/api/client";
import * as customersApi from "~/lib/api/customers";
import * as loansApi from "~/lib/api/loans";
import { formatDate } from "~/lib/format";
import {
  LOAN_APPLICATION_ERRORS,
  LOAN_DURATIONS,
  LOAN_TIER_LABELS,
  normalizeLoanConfig,
  projectInstalments,
  projectInterest,
  projectTotalDue,
  rateFor,
  tierFor,
  type LoanConfig,
  type LoanDuration,
  type LoanEligibility,
} from "~/lib/loan-client";
import { readLoanApplicationForm } from "~/lib/loan-form";
import { formatGhs, parseGhsAmount } from "~/lib/money";
import { requireOffice, withAuth } from "~/lib/session.server";

/**
 * One customer's loans — the history, the evidence, and the application form.
 *
 * It mirrors [customer-accounts.tsx](app/routes/customer-accounts.tsx): a loan
 * belongs to a customer, so this is also where one is applied for and there is
 * no `/loans/new`. What it adds over the accounts page is the **eligibility
 * summary**, which is not decoration — the API publishes it precisely because
 * the decision is a person's, and a person deciding needs the four months of
 * susu and savings history that sit behind it.
 *
 * Two of those fields are hard gates rather than evidence: a missing Ghana Card
 * and an open loan each guarantee a refusal, so both are checked before the
 * form is offered at all.
 */

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `${loaderData?.customer.fullName ?? "Loans"} · Loans · YADAH Dynamic Enterprise`,
    },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOffice(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const [customer, eligibility, loans, config] = await Promise.all([
      customersApi.getCustomer(token, params.id),
      loansApi.getLoanEligibility(token, params.id),
      loansApi.listLoans(token, { customerId: params.id, limit: 50 }),
      // The bounds and rates the application form validates against. Fetched
      // rather than hard-coded: `PUT /loans/config` can move all six, and a
      // form checking against last month's ceiling refuses a principal the API
      // would take.
      loansApi.getLoanConfig(token),
    ]);
    return { customer: customer.customer, eligibility, loans, config };
  }).catch(throwAsRouteError); // 404

  const { config, complete } = normalizeLoanConfig(
    (result.config as { config?: unknown }).config,
  );

  return data(
    {
      customer: {
        id: result.customer.id,
        fullName: result.customer.fullName,
        status: result.customer.status,
      },
      eligibility: result.eligibility,
      loans: result.loans.items,
      loanTotal: result.loans.total,
      config,
      /** False when the config response was missing fields and defaults filled in. */
      configComplete: complete,
    },
    { headers },
  );
}

type ActionData = {
  formError?: string;
  fieldErrors?: Record<string, string>;
  failure?: ApiFailure;
};

export async function action({ request, params }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();

  try {
    const { data: result, headers } = await withAuth(request, async (token) => {
      // The bounds are re-read here rather than trusted from a hidden field:
      // the form was rendered against the config as it was when the page
      // loaded, and this is a write.
      const raw = await loansApi.getLoanConfig(token);
      const { config } = normalizeLoanConfig(
        (raw as { config?: unknown }).config,
      );

      const { principal, durationMonths, fieldErrors } =
        readLoanApplicationForm(form, config);
      if (Object.keys(fieldErrors).length) {
        return { fieldErrors } satisfies ActionData;
      }

      const { loan } = await loansApi.applyForLoan(token, {
        customerId: params.id,
        principal,
        durationMonths,
      });
      return { loanId: loan?.id };
    });

    if ("fieldErrors" in result) return data<ActionData>(result, { headers });

    // Straight to the application that was just recorded — the next thing
    // anyone does is approve or reject it. `headers` must ride along or the
    // rotated refresh token is lost on the way.
    return result.loanId
      ? redirect(`/loans/${result.loanId}`, { headers })
      : redirect(`/customers/${params.id}/loans`, { headers });
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const failure = toApiFailure(error);

    // The five refusals that mean "not this loan, not this customer" each read
    // better as a sentence than as the API's terser phrasing — and two of them
    // (`PRINCIPAL_OUT_OF_RANGE`, `BIG_TIER_LOCKED`) are about the amount, so
    // they belong on that field rather than in a banner.
    const known = LOAN_APPLICATION_ERRORS[failure.code];
    if (
      failure.code === "PRINCIPAL_OUT_OF_RANGE" ||
      failure.code === "BIG_TIER_LOCKED"
    ) {
      return data<ActionData>({
        fieldErrors: { principal: known ?? failure.message },
        failure,
      });
    }

    return data<ActionData>({
      formError:
        known ??
        (failure.status === 0
          ? "Something went wrong. Please try again."
          : failure.message),
      failure,
    });
  }
}

export default function CustomerLoans({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    customer,
    eligibility,
    loans,
    loanTotal,
    config,
    configComplete,
  } = loaderData;
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (actionData?.formError) notify.error(actionData.formError);
    if (actionData?.failure)
      console.error("[customer-loans] request failed:", actionData.failure);
  }, [actionData]);

  // The three refusals knowable before the form is opened. Checked here rather
  // than left to the API because each has a different next step, and none of
  // them is "try a smaller amount".
  const blocker = applicationBlocker(eligibility, customer.status);

  return (
    <div className="mx-auto w-full px-6 py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs
          items={[
            { label: "Customers", to: "/customers" },
            { label: customer.fullName, to: `/customers/${customer.id}` },
            { label: "Loans" },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/customers/${customer.id}/accounts`}
            className="flex min-h-9 items-center gap-1.5 rounded-md border-2 border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-secondary"
          >
            <PiggyBank size={14} />
            Savings accounts
          </Link>
          {/* Never disabled, for the same reason the savings page's Withdraw
              button never is: a grey button with no visible explanation reads
              as a broken page. The click always lands and answers with the
              reason it can't go ahead. */}
          <Button
            type="button"
            size="sm"
            className="min-h-9 rounded-md bg-success px-3"
            onPress={() => {
              if (blocker) {
                notify.warning(blocker.title, { description: blocker.detail });
                return;
              }
              setApplying(true);
            }}
          >
            <HandCoins size={14} />
            Apply for a loan
          </Button>
        </div>
      </div>

      <ApplyDrawer
        isOpen={applying}
        config={config}
        configComplete={configComplete}
        eligibility={eligibility}
        fieldErrors={actionData?.fieldErrors}
        onClose={() => setApplying(false)}
      />

      <EligibilityPanel eligibility={eligibility} blocker={blocker} />

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">
            Loan history
          </h2>
          {loanTotal > loans.length && (
            <p className="text-xs text-muted">
              Showing the latest {loans.length} of {loanTotal}.
            </p>
          )}
        </div>

        <DataTable
          columns={["Applied", "Principal", "Term", "Status", "Outstanding"]}
          ariaLabel="Loan history"
          emptyContent={{
            icon: <HandCoins size={20} />,
            title: "No loans yet",
            subtext: "Applications recorded for this customer appear here.",
          }}
        >
          {loans.map((loan) => (
            <Table.Row key={loan.id} id={loan.id}>
              <Table.Cell className="px-4 py-2 font-medium text-foreground">
                <Link
                  to={`/loans/${loan.id}`}
                  className="hover:text-success hover:underline"
                >
                  {formatDate(loan.appliedAt)}
                </Link>
              </Table.Cell>
              <Table.Cell className="px-4 py-2 tabular-nums text-muted">
                {formatGhs(loan.principal, { symbol: null })}
              </Table.Cell>
              <Table.Cell className="px-4 py-2 text-muted">
                {loan.durationMonths} mo · {loan.ratePercent}%
              </Table.Cell>
              <Table.Cell className="px-4 py-2">
                <LoanStatusPill loan={loan} />
              </Table.Cell>
              <Table.Cell className="px-4 py-2 tabular-nums text-muted">
                {loan.status === "pending" || loan.status === "rejected"
                  ? "—"
                  : formatGhs(loan.remaining, { symbol: null })}
              </Table.Cell>
            </Table.Row>
          ))}
        </DataTable>
      </section>
    </div>
  );
}

/**
 * Why an application can't be recorded, or null when it can.
 *
 * Each of the three is a guaranteed refusal from the API, and each has a
 * different next step: add the card, settle the loan, reactivate the customer.
 * Answering them here means the instruction arrives on the click rather than as
 * a 422 after a form has been filled in.
 */
function applicationBlocker(
  eligibility: LoanEligibility,
  customerStatus: string,
): { title: string; detail: string } | null {
  if (!eligibility.customer.hasGhanaCard) {
    return {
      title: "No Ghana Card on file",
      detail: LOAN_APPLICATION_ERRORS.GHANA_CARD_REQUIRED,
    };
  }
  if (eligibility.openLoan) {
    return {
      title: "This customer already has an open loan",
      detail: LOAN_APPLICATION_ERRORS.LOAN_EXISTS,
    };
  }
  if (customerStatus !== "active") {
    return {
      title: "This customer is deactivated",
      detail: LOAN_APPLICATION_ERRORS.CUSTOMER_INACTIVE,
    };
  }
  return null;
}

/**
 * The evidence, laid out for the person who has to decide.
 *
 * Nothing here scores anything, because the API doesn't and inventing a score
 * would be this app asserting a lending policy it hasn't been told. It shows
 * what the customer has actually done — how long they have saved, how much has
 * gone through susu, what is sitting in savings — and marks the two facts that
 * are gates rather than evidence.
 */
function EligibilityPanel({
  eligibility,
  blocker,
}: {
  eligibility: LoanEligibility;
  blocker: { title: string; detail: string } | null;
}) {
  return (
    /* Same treatment as the loan page's figures: no outer card, because four
       bordered tiles inside a fifth border is a box in a box. The heading and
       the blocker are a caption over the tiles, not a panel around them. */
    <section>
      <h2 className="mb-2.5 text-xs font-bold uppercase tracking-wide text-muted">
        Saving history
      </h2>

      {blocker && (
        <p className="mb-3 flex gap-2 rounded-md bg-warning/15 px-2.5 py-1.5 text-xs text-warning-foreground dark:text-warning">
          <TriangleAlert size={13} className="mt-px shrink-0" />
          <span>
            <span className="font-medium">{blocker.title}.</span>{" "}
            {blocker.detail}
          </span>
        </p>
      )}

      {/* The same tile as the dashboard and the loan page — see
          [kpi.tsx](app/components/kpi.tsx). */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={<Landmark size={14} />}
          label="History"
          value={
            eligibility.firstActivityAt
              ? `${eligibility.monthsOfHistory} months`
              : "None"
          }
          foot={
            <p className="mt-0.5 truncate text-[11px] text-muted">
              {eligibility.firstActivityAt
                ? `Since ${formatDate(eligibility.firstActivityAt)}`
                : "Never saved with us"}
            </p>
          }
        />
        <Kpi
          icon={<HandCoins size={14} />}
          label="Susu"
          value={formatGhs(eligibility.susu.totalDeposited)}
          foot={
            <p className="mt-0.5 truncate text-[11px] text-muted">
              {eligibility.susu.accounts} accounts ·{" "}
              {eligibility.susu.activeAccounts} active
            </p>
          }
        />
        <Kpi
          icon={<PiggyBank size={14} />}
          label="Savings"
          value={formatGhs(eligibility.savings.totalBalance)}
          foot={
            <p className="mt-0.5 truncate text-[11px] text-muted">
              {eligibility.savings.accounts} accounts
            </p>
          }
        />
        {/* The only tile here that is a gate rather than evidence, so it is the
            only one that ever takes a tone. */}
        <Kpi
          icon={
            eligibility.customer.hasGhanaCard ? (
              <IdCard size={14} />
            ) : (
              <CircleAlert size={14} />
            )
          }
          label="Ghana Card"
          value={eligibility.customer.hasGhanaCard ? "On file" : "Missing"}
          tone={eligibility.customer.hasGhanaCard ? undefined : "danger"}
          foot={
            <p className="mt-0.5 truncate text-[11px] text-muted">
              {eligibility.customer.hasGhanaCard
                ? "Required for any loan"
                : "No loan without one"}
            </p>
          }
        />
      </div>

      {/* The big tier is the one thing here that is *earned* rather than
          measured, so it gets a line of its own rather than a fifth tile. */}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
        {eligibility.bigTierUnlocked ? (
          <>
            <BadgeCheck size={13} className="shrink-0 text-success" />
            Big tier unlocked — a previous small loan was repaid on time.
          </>
        ) : (
          <>
            <CircleAlert size={13} className="shrink-0" />
            Small tier only. The big tier opens once a small loan has been
            repaid on time.
          </>
        )}
      </p>
    </section>
  );
}

/**
 * The application: an amount and a term, and the arithmetic they imply.
 *
 * The figures below the fields are a **projection**, and the drawer says so.
 * The rate is locked from the config at *approval*, not here — so a config
 * change between recording this and approving it moves every number on screen.
 * Showing them anyway is right: this is what the customer is being quoted, and
 * quoting nothing is worse than quoting something dated.
 */
function ApplyDrawer({
  isOpen,
  config,
  configComplete,
  eligibility,
  fieldErrors,
  onClose,
}: {
  isOpen: boolean;
  config: LoanConfig;
  configComplete: boolean;
  eligibility: LoanEligibility;
  fieldErrors?: Record<string, string>;
  onClose: () => void;
}) {
  const navigation = useNavigation();
  const submit = useSubmit();
  const submitting = navigation.state === "submitting";
  const [principal, setPrincipal] = useState("");
  const [months, setMonths] = useState<LoanDuration>(3);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // The same reader the action runs, run here against the typed value — so the
  // tier bounds are written once and enforced on both sides.
  const probe = new FormData();
  probe.set("principal", principal);
  probe.set("durationMonths", String(months));
  const { fieldErrors: liveErrors } = readLoanApplicationForm(probe, config, {
    bigTierUnlocked: eligibility.bigTierUnlocked,
  });
  const pesewas = parseGhsAmount(principal);
  const ready = Object.keys(liveErrors).length === 0 && pesewas !== null;

  const rate = rateFor(config, months);
  const interest = pesewas === null ? 0 : projectInterest(pesewas, rate);
  const totalDue = pesewas === null ? 0 : projectTotalDue(pesewas, rate);
  const instalments = projectInstalments(totalDue, months);
  const tier = pesewas === null ? null : tierFor(config, pesewas);

  const ceiling = eligibility.bigTierUnlocked
    ? config.bigMaxPesewas
    : config.smallMaxPesewas;

  // See the note on the savings deposit drawer: `submit(form)` rather than
  // `requestSubmit()`, or the intercepted `onSubmit` would reopen the very
  // confirmation that called this.
  function confirmAndSend() {
    setConfirming(false);
    if (formRef.current) submit(formRef.current, { method: "post" });
  }

  return (
    <SideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Apply for a loan"
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            className="rounded-md"
            onPress={onClose}
            isDisabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="rounded-md bg-success"
            isDisabled={submitting || !ready}
            onPress={() => setConfirming(true)}
          >
            {submitting ? "Recording…" : "Record application"}
          </Button>
        </>
      }
    >
      <ConfirmModal
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Record this application?"
        closeLabel="Back"
        // Its backdrop and the drawer's panel are both `z-50`; stated outright
        // rather than left to DOM order. Same as the savings drawers.
        className="z-60"
        footer={
          <Button
            size="sm"
            className="rounded-md bg-success"
            onPress={confirmAndSend}
          >
            Record application
          </Button>
        }
      >
        <div className="space-y-3 text-sm text-muted">
          <p>
            This records a <span className="font-medium">pending</span>{" "}
            application. No money moves and no rate is locked until someone
            approves it.
          </p>
          <dl className="space-y-2 rounded-lg border border-border bg-background p-3">
            <Figure label="Principal" value={formatGhs(pesewas ?? 0)} strong />
            <Figure label="Term" value={`${months} months`} />
            <Figure label="Rate today" value={`${rate}%`} />
            <Figure label="Total repayable" value={formatGhs(totalDue)} />
          </dl>
        </div>
      </ConfirmModal>

      <Form
        ref={formRef}
        method="post"
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) setConfirming(true);
        }}
      >
        <div className="space-y-1.5">
          <TextInput
            name="principal"
            label="Loan amount"
            value={principal}
            onChange={setPrincipal}
            inputProps={{
              inputMode: "decimal",
              autoComplete: "off",
              placeholder: "1000.00",
              className: FIELD,
            }}
          />
          <p className="text-xs text-muted">
            {formatGhs(config.smallMinPesewas)} to {formatGhs(ceiling)}
            {tier && ` · ${LOAN_TIER_LABELS[tier]} tier`}
          </p>
          <FieldError
            message={
              principal
                ? (liveErrors.principal ?? fieldErrors?.principal)
                : fieldErrors?.principal
            }
          />
        </div>

        {/* Three fixed options, so they are three buttons rather than a select:
            the choice changes every figure below it, and a dropdown hides two
            thirds of the product behind a click. */}
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-foreground">Term</legend>
          <input type="hidden" name="durationMonths" value={months} />
          <div className="flex gap-2">
            {LOAN_DURATIONS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={months === option}
                onClick={() => setMonths(option)}
                className={`flex-1 rounded-md border-2 px-3 py-2 text-sm transition-colors ${
                  months === option
                    ? "border-success font-semibold text-foreground"
                    : "border-border font-medium text-muted hover:text-foreground"
                }`}
              >
                {option} months
                <span className="block text-xs font-normal text-muted">
                  {rateFor(config, option)}%
                </span>
              </button>
            ))}
          </div>
          <FieldError message={fieldErrors?.durationMonths} />
        </fieldset>

        {/* Always on screen, not only once the amount is valid: this is the
            arithmetic being checked *while* it is typed, and a panel that
            appears at the end is one nobody sees. */}
        <dl className="space-y-2 rounded-lg border-2 border-border bg-background p-3">
          <Figure label="Principal" value={formatGhs(pesewas ?? 0)} />
          <Figure label={`Interest at ${rate}%`} value={formatGhs(interest)} />
          <Figure label="Total repayable" value={formatGhs(totalDue)} strong />
          <Figure
            label={`Monthly × ${months}`}
            value={
              instalments.each === instalments.last
                ? formatGhs(instalments.each)
                : `${formatGhs(instalments.each)} · last ${formatGhs(instalments.last)}`
            }
          />
        </dl>

        <p className="text-xs text-muted">
          Interest is flat — a one-off percentage of the principal, not a
          monthly rate. These figures are indicative: the rate is locked from
          the settings when the loan is approved, not now.
          {!configComplete && (
            <>
              {" "}
              <span className="text-warning-foreground dark:text-warning">
                The loan settings couldn't be read in full, so some of these
                bounds are defaults — check them in Loan settings.
              </span>
            </>
          )}
        </p>
      </Form>
    </SideDrawer>
  );
}

/** One label/figure pair. `strong` marks the number the eye should land on. */
function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd
        className={`shrink-0 tabular-nums ${
          strong
            ? "text-base font-semibold text-foreground"
            : "text-sm text-foreground"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
