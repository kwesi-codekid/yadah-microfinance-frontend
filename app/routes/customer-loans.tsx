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
import { HandCoins, PiggyBank } from "lucide-react";
import type { Route } from "./+types/customer-loans";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { DataTable, Table } from "~/components/data-table";
import { FIELD, FieldError } from "~/components/form-fields";
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

    return result.loanId
      ? redirect(`/loans/${result.loanId}`, { headers })
      : redirect(`/customers/${params.id}/loans`, { headers });
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const failure = toApiFailure(error);

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

      <section>
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
