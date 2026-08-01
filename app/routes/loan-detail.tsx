import { useEffect, useRef, useState } from "react";
import { data, Form, Link, useNavigation, useSubmit } from "react-router";
import { Button } from "@heroui/react";
import {
  ArrowUpRight,
  Ban,
  Banknote,
  Check,
  HandCoins,
  Percent,
  PiggyBank,
  Receipt,
  Snowflake,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import type { Route } from "./+types/loan-detail";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { DataTable, Table } from "~/components/data-table";
import { FIELD, FieldError, SelectField } from "~/components/form-fields";
import { Kpi } from "~/components/kpi";
import { LoanStatusPill } from "~/components/loan-status";
import { TextInput, TextareaInput } from "~/components/inputs";
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
import * as susuApi from "~/lib/api/susu";
import * as usersApi from "~/lib/api/users";
import { PAYMENT_CHANNEL_LABELS, PAYMENT_CHANNELS } from "~/lib/channel";
import { formatDate, formatDateTime } from "~/lib/format";
import { newIdempotencyKey, readIdempotencyKey } from "~/lib/idempotency";
import {
  isOpenLoan,
  LOAN_TIER_LABELS,
  readExceedsBalance,
  repaidPercent,
  repaymentSourceLabel,
  scheduleStatusLabel,
  settlementAmount,
  type Loan,
} from "~/lib/loan-client";
import { readRejectionForm, readRepaymentForm } from "~/lib/loan-form";
import { formatGhs, parseGhsAmount, toAmountInput } from "~/lib/money";
import { projectedPayout, type SusuAccount } from "~/lib/susu-client";
import { requireOffice, withAuth } from "~/lib/session.server";

/**
 * One loan: the money, the decision, the schedule and the repayments.
 *
 * The page has two quite different jobs depending on the status, and it shows
 * one or the other rather than both. A **pending** loan is a decision waiting to
 * be made — there is no schedule yet (the API generates it at approval), so the
 * page is the figures and two buttons. An **active** or **arrears** loan is a
 * balance being worked down, so it is the schedule, the history, and the two
 * ways of paying.
 *
 * The second of those ways is the one worth reading the code for. `POST
 * /loans/{id}/repayments/susu-closure` closes a susu account straight into the
 * loan in a single transaction across both modules — and refuses the whole
 * thing if the payout would overshoot the balance, because the API has no
 * answer for the excess. So the drawer compares each account's projected payout
 * against `remaining` *before* the click and says which ones would be refused,
 * rather than offering them and reporting a 422.
 */

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `${loaderData?.customer.fullName ?? "Loan"} · Loan · YADAH Dynamic Enterprise`,
    },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOffice(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const detail = await loansApi.getLoan(token, params.id);
    const open = isOpenLoan(detail.loan.status);

    const [customer, staff, susu] = await Promise.all([
      // `GET /loans/{id}` carries no `customerName` — the list rows do, the
      // detail does not — so the name costs a second request here.
      customersApi.getCustomer(token, detail.loan.customerId),
      // Only to name who recorded each repayment.
      usersApi.listUsers(token, { limit: 100 }),
      // The susu-closure repayment path needs the customer's open cycles and
      // the payout each would produce. Skipped entirely on a loan that can't
      // take a repayment — a pending or settled loan has nothing to pay into.
      open
        ? susuApi.listSusuAccounts(token, {
            customerId: detail.loan.customerId,
            status: "active",
            limit: 100,
          })
        : null,
    ]);

    return {
      detail,
      customer: customer.customer,
      staff: staff.items,
      susuAccounts: susu?.items ?? [],
    };
  }).catch(throwAsRouteError); // 404

  const staffNames: Record<string, string> = {};
  for (const member of result.staff) staffNames[member.id] = member.name;

  return data(
    {
      loan: result.detail.loan,
      schedule: result.detail.schedule,
      repayments: result.detail.repayments,
      customer: {
        id: result.customer.id,
        fullName: result.customer.fullName,
      },
      staffNames,
      susuAccounts: result.susuAccounts,
      /**
       * Two keys, not one — the same reasoning as the savings page. Cash
       * repayment and susu closure are separate endpoints, and sharing a key
       * would leave one holding a spent one after the other fired.
       */
      repaymentKey: newIdempotencyKey(),
      susuKey: newIdempotencyKey(),
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
  await requireOffice(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      runIntent({ token, intent, id: params.id, form }),
    );
    return data(result, { headers });
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const failure = toApiFailure(error);

    // 422 EXCEEDS_BALANCE carries what is actually still owed. Put it on the
    // field with the real figure — a loan cannot be overpaid, so the correction
    // is exact rather than a guess.
    const remaining = readExceedsBalance(failure.details);
    if (remaining !== null && intent === "repay") {
      return data<ActionData>({
        intent,
        fieldErrors: {
          amount: `Only ${formatGhs(remaining)} is still owed. A loan can't be overpaid.`,
        },
        failure,
      });
    }

    return data<ActionData>({
      intent,
      formError: messageFor(failure),
      failure,
    });
  }
}

/**
 * The refusals whose own phrasing doesn't say what to do next.
 *
 * `PAYOUT_EXCEEDS_BALANCE` is the important one: it sounds like a validation
 * quibble and is actually a fork in the workflow — the API will not close the
 * account and pay the excess out, so the operator has to take a cash repayment
 * and close the account separately.
 */
function messageFor(failure: ApiFailure): string {
  if (failure.status === 0) return "Something went wrong. Please try again.";
  const known: Record<string, string> = {
    NOT_PENDING:
      "This application has already been decided — someone got there first.",
    LOAN_NOT_OPEN:
      "This loan isn't open, so no repayment can be recorded against it.",
    PAYOUT_EXCEEDS_BALANCE:
      "That account's payout is more than the loan still owes, and the difference can't be paid out in the same step. Record a cash repayment for the balance, then close the account normally.",
    ALREADY_CLOSED: "That susu account has already been closed.",
    CUSTOMER_MISMATCH: "That susu account belongs to a different customer.",
    NO_PAYOUT:
      "That account has no payout — its deposits don't cover the commission.",
  };
  return known[failure.code] ?? failure.message;
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
  if (intent === "approve") {
    const { loan } = await loansApi.approveLoan(token, id);
    return {
      ok: true,
      intent,
      message: `Approved. ${formatGhs(loan.totalDue)} repayable over ${loan.durationMonths} months at ${loan.ratePercent}%. The customer has been sent an SMS.`,
    } satisfies ActionData;
  }

  if (intent === "reject") {
    const { reason, fieldErrors } = readRejectionForm(form);
    if (Object.keys(fieldErrors).length)
      return { intent, fieldErrors } satisfies ActionData;

    await loansApi.rejectLoan(token, id, { reason });
    return { ok: true, intent, message: "Application rejected." };
  }

  if (intent === "repay") {
    // No `remaining` passed here: the browser gates the field against the
    // figure already on screen, and the API owns the authoritative check.
    const { amount, channel, idempotencyKey, fieldErrors } =
      readRepaymentForm(form);
    if (Object.keys(fieldErrors).length)
      return { intent, fieldErrors } satisfies ActionData;

    const result = await loansApi.recordLoanRepayment(token, id, {
      amount,
      channel,
      idempotencyKey,
    });

    if (result.replayed) {
      return {
        ok: true,
        intent,
        message:
          "Already recorded — this is the same repayment, not a second one.",
      } satisfies ActionData;
    }

    return {
      ok: true,
      intent,
      message: settledMessage(result.loan, result.repayment.amount),
    } satisfies ActionData;
  }

  if (intent === "repay-susu") {
    const susuAccountId = String(form.get("susuAccountId") ?? "").trim();
    if (!susuAccountId) {
      return { intent, formError: "Choose a susu account to close." };
    }
    const fieldErrors: Record<string, string> = {};
    const idempotencyKey = readIdempotencyKey(form, fieldErrors);
    if (Object.keys(fieldErrors).length)
      return { intent, fieldErrors } satisfies ActionData;

    const result = await loansApi.repayLoanFromSusu(token, id, {
      susuAccountId,
      idempotencyKey,
    });

    if (result.replayed) {
      return {
        ok: true,
        intent,
        message:
          "Already recorded — this is the same closure, not a second one.",
      } satisfies ActionData;
    }

    const closure = result.susuClosure;
    const detail = closure
      ? ` Commission ${formatGhs(closure.commission)} kept.`
      : "";
    return {
      ok: true,
      intent,
      message:
        settledMessage(result.loan, result.repayment.amount) + detail,
    } satisfies ActionData;
  }

  return { formError: "Unsupported action." } satisfies ActionData;
}

/**
 * The message a repayment earns — and the reason settlement gets its own.
 *
 * Paying the balance exactly stamps `repaidOnTime`, which is what unlocks the
 * big tier for this customer's next application. That is worth telling the
 * person at the counter, because it is the one consequence of a repayment that
 * isn't visible in the figures.
 */
function settledMessage(loan: Loan, amount: number): string {
  if (loan.status === "repaid") {
    return loan.repaidOnTime
      ? `Settled with ${formatGhs(amount)}. Repaid on time — this customer can now borrow at the big tier.`
      : `Settled with ${formatGhs(amount)}. The loan is fully repaid.`;
  }
  return `Recorded ${formatGhs(amount)}. ${formatGhs(loan.remaining)} still owed.`;
}

export default function LoanDetail({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    loan,
    schedule,
    repayments,
    customer,
    staffNames,
    susuAccounts,
    repaymentKey,
    susuKey,
  } = loaderData;
  const [repaying, setRepaying] = useState(false);
  const [closingSusu, setClosingSusu] = useState(false);
  const open = isOpenLoan(loan.status);

  useEffect(() => {
    if (actionData?.ok) notify.success(actionData.message ?? "Done.");
    else if (actionData?.formError) notify.error(actionData.formError);
    if (actionData?.failure)
      console.error("[loan-detail] request failed:", actionData.failure);
    // Only a recorded write closes its drawer. A rejected one stays open with
    // the message on the field it belongs to.
    if (actionData?.ok && actionData.intent === "repay") setRepaying(false);
    if (actionData?.ok && actionData.intent === "repay-susu")
      setClosingSusu(false);
  }, [actionData]);

  return (
    <div className="mx-auto w-full px-6 py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs
          items={[
            { label: "Customers", to: "/customers" },
            { label: customer.fullName, to: `/customers/${customer.id}` },
            { label: "Loans", to: `/customers/${customer.id}/loans` },
            { label: formatGhs(loan.principal) },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          {loan.status === "pending" && (
            <>
              <ApproveButton loan={loan} name={customer.fullName} />
              <RejectButton />
            </>
          )}
          {open && (
            <>
              <Button
                type="button"
                size="sm"
                className="min-h-9 rounded-md bg-success px-3"
                onPress={() => setRepaying(true)}
              >
                <HandCoins size={14} />
                Record repayment
              </Button>
              {/* Offered even when no account qualifies — the drawer explains
                  which ones would be refused and why, which is more use than a
                  button that isn't there. */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-9 rounded-md border-2 border-teal-dark px-3 text-teal-dark hover:bg-teal-dark/10 dark:border-teal dark:text-teal"
                onPress={() => setClosingSusu(true)}
              >
                <PiggyBank size={14} />
                Repay from susu
              </Button>
            </>
          )}
        </div>
      </div>

      {open && (
        <>
          {/* Keyed on the idempotency key, which the loader remints on every
              revalidation: a recorded write therefore resets its form, while a
              rejected one — same key, same mount — keeps what was typed. */}
          <RepayDrawer
            key={repaymentKey}
            isOpen={repaying}
            loan={loan}
            idempotencyKey={repaymentKey}
            fieldErrors={
              actionData?.intent === "repay" ? actionData.fieldErrors : undefined
            }
            onClose={() => setRepaying(false)}
          />
          <SusuClosureDrawer
            key={susuKey}
            isOpen={closingSusu}
            loan={loan}
            accounts={susuAccounts}
            customerId={customer.id}
            idempotencyKey={susuKey}
            onClose={() => setClosingSusu(false)}
          />
        </>
      )}

      <MoneyPanel loan={loan} />

      {/* A pending loan has no schedule — the API generates it at approval —
          and no repayments either, so neither table is rendered as an empty
          one. What it has instead is a decision, which the buttons above are. */}
      {loan.status === "pending" ? (
        <p className="mt-6 rounded-lg border-2 border-dashed border-border p-6 text-center text-sm text-muted">
          This application is waiting on a decision. Approving it locks the rate
          and interest from the settings as they stand at that moment, generates
          the monthly schedule, and sends the customer an SMS.
        </p>
      ) : loan.status === "rejected" ? null : (
        <>
          <section className="mt-6">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
              Repayment schedule
            </h2>
            <DataTable
              columns={["#", "Due", "Amount due", "Paid", "Status"]}
              ariaLabel="Repayment schedule"
              emptyContent={{
                title: "No schedule",
                subtext: "A schedule is generated when a loan is approved.",
              }}
            >
              {schedule.map((instalment) => (
                <Table.Row
                  key={instalment.installmentNumber}
                  id={String(instalment.installmentNumber)}
                >
                  <Table.Cell className="px-4 py-2 font-medium text-foreground">
                    {instalment.installmentNumber}
                  </Table.Cell>
                  <Table.Cell className="px-4 py-2 text-muted">
                    {formatDate(instalment.dueDate)}
                  </Table.Cell>
                  <Table.Cell className="px-4 py-2 tabular-nums text-muted">
                    {formatGhs(instalment.amountDue, { symbol: null })}
                  </Table.Cell>
                  <Table.Cell
                    className={`px-4 py-2 tabular-nums ${
                      instalment.amountPaid >= instalment.amountDue
                        ? "font-medium text-success"
                        : "text-muted"
                    }`}
                  >
                    {formatGhs(instalment.amountPaid, { symbol: null })}
                  </Table.Cell>
                  <Table.Cell className="px-4 py-2 text-muted">
                    {scheduleStatusLabel(instalment.status)}
                  </Table.Cell>
                </Table.Row>
              ))}
            </DataTable>
          </section>

          <section className="mt-6">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
              Repayment history
            </h2>
            <DataTable
              columns={["Date", "Amount", "Source", "Recorded by"]}
              ariaLabel="Repayment history"
              emptyContent={{
                icon: <HandCoins size={20} />,
                title: "No repayments yet",
                subtext: "The first repayment will appear here.",
              }}
            >
              {repayments.map((repayment) => (
                <Table.Row key={repayment.id} id={repayment.id}>
                  <Table.Cell className="px-4 py-2 text-muted">
                    {formatDateTime(repayment.createdAt)}
                  </Table.Cell>
                  <Table.Cell className="px-4 py-2 font-medium tabular-nums text-success">
                    {formatGhs(repayment.amount, { symbol: null })}
                  </Table.Cell>
                  <Table.Cell className="px-4 py-2 text-muted">
                    {/* A susu-closure repayment links back to the account it
                        emptied — the two records only make sense together. */}
                    {repayment.susuAccountId ? (
                      <Link
                        to={`/susu/${repayment.susuAccountId}`}
                        className="hover:text-success hover:underline"
                      >
                        {repaymentSourceLabel(repayment.source)}
                      </Link>
                    ) : (
                      repaymentSourceLabel(repayment.source)
                    )}
                  </Table.Cell>
                  <Table.Cell className="px-4 py-2 text-muted">
                    {staffNames[repayment.recordedById] ?? "Unknown"}
                  </Table.Cell>
                </Table.Row>
              ))}
            </DataTable>
          </section>
        </>
      )}
    </div>
  );
}

/**
 * The figures, and the two things that qualify them.
 *
 * Escalation is the reason this panel exists rather than a row of stat tiles:
 * `ratePercent` is the *current* rate, not the agreed one, and on a loan that
 * has fallen behind the interest on screen is larger than the interest the
 * customer was quoted. A page that showed the number without saying that would
 * be handing an operator a figure they can't explain.
 */
function MoneyPanel({ loan }: { loan: Loan }) {
  const decided = loan.status !== "pending" && loan.status !== "rejected";

  return (
    /* No outer card. Four tiles that each carry their own border inside a fifth
       border is a box in a box, and the figures are the panel — the status and
       the dates are a caption over them, not a header bar. */
    <section>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <LoanStatusPill loan={loan} />
        <p className="text-xs text-muted">
          Applied {formatDate(loan.appliedAt)}
          {loan.approvedAt && ` · approved ${formatDate(loan.approvedAt)}`}
          {loan.dueDate && ` · due ${formatDate(loan.dueDate)}`}
        </p>
      </div>

      {/* The same tile the dashboard's six use — see
          [kpi.tsx](app/components/kpi.tsx). Each foot carries the one thing
          that makes its figure mean something, which is what keeps this to a
          single band: the progress bar rides under the total it is a fraction
          of, rather than costing a row of its own. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={<Banknote size={14} />}
          label="Principal"
          value={formatGhs(loan.principal)}
          foot={
            <p className="mt-0.5 truncate text-[11px] text-muted">
              {LOAN_TIER_LABELS[loan.tier]} tier · {loan.durationMonths} months
            </p>
          }
        />
        <Kpi
          icon={<Percent size={14} />}
          label={`Interest at ${loan.ratePercent}%`}
          value={formatGhs(loan.interestAmount)}
          foot={
            <p className="mt-0.5 truncate text-[11px] text-muted">
              {/* Flat is the fact people get wrong about this product — it is
                  charged once on the principal, not per month. */}
              {loan.escalatedAt ? "Flat, escalated" : "Flat, one-off"}
            </p>
          }
        />
        <Kpi
          icon={<Receipt size={14} />}
          label="Total repayable"
          value={formatGhs(loan.totalDue)}
          foot={
            decided ? (
              <span className="mt-1.5 flex items-center gap-2">
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-border">
                  <span
                    className="block h-full rounded-full bg-success transition-all"
                    style={{ width: `${repaidPercent(loan)}%` }}
                  />
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted">
                  {repaidPercent(loan)}%
                </span>
              </span>
            ) : (
              <p className="mt-0.5 truncate text-[11px] text-muted">
                Not yet approved
              </p>
            )
          }
        />
        <Kpi
          icon={<Wallet size={14} />}
          label="Still owed"
          value={formatGhs(loan.remaining)}
          tone={loan.status === "arrears" ? "danger" : undefined}
          foot={
            <p className="mt-0.5 truncate text-[11px] text-muted">
              {decided
                ? `${formatGhs(loan.totalRepaid)} repaid`
                : "Nothing owed until approval"}
            </p>
          }
        />
      </div>

      {/* Escalation and frozen are one note, not two. They are one event seen
          from two sides — the ladder moved, and it has run out — and an
          escalated loan is frozen at the top of the ladder by definition, so
          stacking them meant this panel's worst case printed five lines of
          prose about a single fact. The status pill already says "Frozen"; the
          note only has to say what it means. */}
      {loan.escalatedAt ? (
        <Note tone="danger" icon={<TriangleAlert size={13} />}>
          Rate escalated {formatDate(loan.escalatedAt)} to {loan.ratePercent}%,
          charged on the original principal — the total above is higher than the
          figure quoted at approval.
          {loan.frozen && " It can rise no further; this loan now needs a person."}
        </Note>
      ) : loan.frozen ? (
        <Note tone="muted" icon={<Snowflake size={13} />}>
          Frozen — the rate can rise no further. This loan needs a person.
        </Note>
      ) : null}

      {loan.status === "repaid" && (
        <Note tone="success" icon={<Check size={13} />}>
          Settled{loan.closedAt ? ` ${formatDate(loan.closedAt)}` : ""} —{" "}
          {loan.repaidOnTime
            ? "on time, so this customer can borrow at the big tier."
            : "late, so the big tier stays locked."}
        </Note>
      )}

      {loan.status === "rejected" && loan.rejectionReason && (
        <Note tone="muted">
          <span className="font-medium text-foreground">Rejected:</span>{" "}
          {loan.rejectionReason}
        </Note>
      )}
    </section>
  );
}

/** A one-line qualifier under the figures. Icon optional, tone semantic. */
function Note({
  tone,
  icon,
  children,
}: {
  tone: "danger" | "success" | "muted";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const TONE = {
    danger: "bg-red-500/10 text-red-600 dark:text-red-400",
    success: "bg-success/10 text-success",
    muted: "bg-surface-secondary text-muted",
  } as const;

  return (
    <p className={`mt-2 flex gap-1.5 rounded-md px-2.5 py-1.5 text-xs ${TONE[tone]}`}>
      {icon && (
        <span aria-hidden="true" className="mt-px shrink-0">
          {icon}
        </span>
      )}
      <span>{children}</span>
    </p>
  );
}

/** Approving locks the rate, generates the schedule and texts the customer. */
function ApproveButton({ loan, name }: { loan: Loan; name: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Form method="post" ref={formRef}>
        <input type="hidden" name="intent" value="approve" />
        <Button
          type="button"
          size="sm"
          className="min-h-9 rounded-md bg-success px-3"
          onPress={() => setConfirming(true)}
        >
          <Check size={14} />
          Approve
        </Button>
      </Form>

      <ConfirmModal
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Approve this loan?"
        footer={
          <Button
            size="sm"
            className="rounded-md bg-success"
            onPress={() => {
              setConfirming(false);
              formRef.current?.requestSubmit();
            }}
          >
            Approve
          </Button>
        }
      >
        <div className="space-y-3 text-sm text-muted">
          <p>
            <span className="font-medium text-foreground">{name}</span> borrows{" "}
            {formatGhs(loan.principal)} over {loan.durationMonths} months. The
            rate and interest are locked from the settings as they stand now,
            the schedule is generated, and the customer is sent an SMS.
          </p>
          {/* The figures on a pending loan are the API's own projection at the
              rate current when it was applied for. They are shown because they
              are what was quoted — and captioned, because approval re-reads the
              settings and may not land on the same number. */}
          <dl className="space-y-2 rounded-lg border border-border bg-background p-3">
            <Figure label="Principal" value={formatGhs(loan.principal)} />
            <Figure
              label={`Interest at ${loan.ratePercent}%`}
              value={formatGhs(loan.interestAmount)}
            />
            <Figure
              label="Total repayable"
              value={formatGhs(loan.totalDue)}
              strong
            />
          </dl>
          <p>
            These figures are as quoted. Approval re-reads the current settings,
            so they can differ if the rates have changed since. This can't be
            undone.
          </p>
        </div>
      </ConfirmModal>
    </>
  );
}

/** Rejecting needs a reason — it is stored and read back later. */
function RejectButton() {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const probe = new FormData();
  probe.set("reason", reason);
  const { fieldErrors } = readRejectionForm(probe);
  const ready = Object.keys(fieldErrors).length === 0;

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="danger"
        className="min-h-9 rounded-md px-3"
        onPress={() => setOpen(true)}
      >
        <Ban size={14} />
        Reject
      </Button>

      <SideDrawer
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Reject this application"
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              className="rounded-md"
              onPress={() => setOpen(false)}
              isDisabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="reject-loan"
              variant="danger"
              className="rounded-md"
              isDisabled={submitting || !ready}
            >
              {submitting ? "Rejecting…" : "Reject"}
            </Button>
          </>
        }
      >
        <Form id="reject-loan" method="post" className="space-y-4">
          <input type="hidden" name="intent" value="reject" />
          <TextareaInput
            name="reason"
            label="Reason"
            value={reason}
            onChange={setReason}
            textareaProps={{
              rows: 4,
              placeholder: "Why is this application being turned down?",
            }}
          />
          <FieldError message={reason ? fieldErrors.reason : undefined} />
          <p className="text-xs text-muted">
            Stored on the record, so whoever fields the customer's question
            about it later can read it. 2–300 characters.
          </p>
        </Form>
      </SideDrawer>
    </>
  );
}

/**
 * A cash repayment.
 *
 * The one thing this drawer does beyond taking an amount is name the moment the
 * payment *settles* the loan rather than merely reducing it — because settling
 * exactly is what stamps `repaidOnTime` and unlocks the big tier, and because
 * anything above the balance is refused outright rather than taken.
 */
function RepayDrawer({
  isOpen,
  loan,
  idempotencyKey,
  fieldErrors,
  onClose,
}: {
  isOpen: boolean;
  loan: Loan;
  idempotencyKey: string;
  fieldErrors?: Record<string, string>;
  onClose: () => void;
}) {
  const navigation = useNavigation();
  const submit = useSubmit();
  const submitting = navigation.state === "submitting";
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const remaining = settlementAmount(loan);

  const probe = new FormData();
  probe.set("amount", amount);
  probe.set("idempotencyKey", idempotencyKey);
  const { fieldErrors: liveErrors } = readRepaymentForm(probe, remaining);
  const pesewas = parseGhsAmount(amount);
  const ready = pesewas !== null && Object.keys(liveErrors).length === 0;
  const settles = ready && pesewas === remaining;

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
      title="Record a repayment"
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
            {submitting ? "Recording…" : "Record repayment"}
          </Button>
        </>
      }
    >
      <ConfirmModal
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Record this repayment?"
        closeLabel="Back"
        className="z-60"
        footer={
          <Button
            size="sm"
            className="rounded-md bg-success"
            onPress={confirmAndSend}
          >
            Record repayment
          </Button>
        }
      >
        <div className="space-y-3 text-sm text-muted">
          <dl className="space-y-2 rounded-lg border border-border bg-background p-3">
            <Figure label="Owed now" value={formatGhs(remaining)} />
            <Figure label="Taking" value={formatGhs(pesewas ?? 0)} strong />
            <Figure
              label="Owed after"
              value={formatGhs(Math.max(0, remaining - (pesewas ?? 0)))}
            />
          </dl>
          {settles && (
            <p className="rounded-lg bg-success/10 p-3 text-success">
              This settles the loan. If it is on time, the customer unlocks the
              big tier for their next one.
            </p>
          )}
          <p>Count the cash before confirming — a repayment can't be reversed.</p>
        </div>
      </ConfirmModal>

      {/* `onSubmit` is intercepted so Enter in the amount field asks for
          confirmation too, rather than being the one route that skips it. */}
      <Form
        ref={formRef}
        method="post"
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) setConfirming(true);
        }}
      >
        <input type="hidden" name="intent" value="repay" />
        {/* The whole point of the key: this exact value survives a retry, so a
            second tap on a bad connection replays the first repayment instead
            of taking the money again. */}
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        <div className="space-y-1.5">
          <TextInput
            name="amount"
            label="Amount"
            value={amount}
            onChange={setAmount}
            inputProps={{
              inputMode: "decimal",
              autoComplete: "off",
              placeholder: "0.00",
              className: FIELD,
            }}
          />
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs text-muted">
              {formatGhs(remaining)} still owed.
            </p>
            {/* Settling in full is the commonest repayment there is, and it is
                the only one with a consequence beyond the balance. */}
            {remaining > 0 && (
              <button
                type="button"
                onClick={() => setAmount(toAmountInput(remaining))}
                className="text-xs font-medium text-success hover:underline"
              >
                Settle in full
              </button>
            )}
          </div>
          <FieldError
            message={
              amount
                ? (liveErrors.amount ?? fieldErrors?.amount)
                : fieldErrors?.amount
            }
          />
        </div>

        <SelectField
          name="channel"
          label="Channel"
          defaultValue="cash"
          options={PAYMENT_CHANNELS.map((channel) => ({
            value: channel,
            label: PAYMENT_CHANNEL_LABELS[channel],
          }))}
        />

        <dl className="space-y-2 rounded-lg border-2 border-border bg-background p-3">
          <Figure label="Owed now" value={formatGhs(remaining)} />
          <Figure label="Taking" value={formatGhs(ready ? pesewas : 0)} strong />
          <Figure
            label="Owed after"
            value={formatGhs(
              Math.max(0, remaining - (ready && pesewas !== null ? pesewas : 0)),
            )}
          />
        </dl>

        <p className="text-xs text-muted">
          Repayments are allocated to instalments oldest first. A loan can't be
          overpaid — anything above {formatGhs(remaining)} is refused.
        </p>
      </Form>
    </SideDrawer>
  );
}

/**
 * Repay by closing a susu account.
 *
 * The refusal this drawer is built around is `PAYOUT_EXCEEDS_BALANCE`: the API
 * will not close an account whose payout overshoots what the loan owes, because
 * it has nowhere to put the excess. So each account is measured against
 * `remaining` here and the ones that would be refused say so, with the way
 * through — a cash repayment first, then an ordinary closure.
 *
 * The payout figure is `projectedPayout` from
 * [susu-client.ts](app/lib/susu-client.ts), the same arithmetic the susu pages
 * use: total deposited less one day's commission. It is a projection of what
 * the API will compute, not a figure the API has given us for this purpose.
 */
function SusuClosureDrawer({
  isOpen,
  loan,
  accounts,
  customerId,
  idempotencyKey,
  onClose,
}: {
  isOpen: boolean;
  loan: Loan;
  accounts: SusuAccount[];
  customerId: string;
  idempotencyKey: string;
  onClose: () => void;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const remaining = settlementAmount(loan);

  const rows = accounts.map((account) => {
    const payout = projectedPayout(account);
    return {
      account,
      payout,
      // The two refusals knowable from here. `NO_PAYOUT` is the account that
      // hasn't yet covered one day's commission; `PAYOUT_EXCEEDS_BALANCE` is
      // the one that would overshoot.
      blocked:
        payout <= 0
          ? "No payout yet — deposits don't cover the commission."
          : payout > remaining
            ? `Payout is more than the ${formatGhs(remaining)} still owed. Take a cash repayment first, then close this account normally.`
            : null,
    };
  });

  const chosen = rows.find((row) => row.account.id === selected) ?? null;
  const ready = chosen !== null && chosen.blocked === null;

  return (
    <SideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Repay from susu"
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
            {submitting ? "Closing…" : "Close and apply"}
          </Button>
        </>
      }
    >
      <ConfirmModal
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Close this account into the loan?"
        closeLabel="Back"
        className="z-60"
        footer={
          <Button
            size="sm"
            className="rounded-md bg-success"
            onPress={() => {
              setConfirming(false);
              formRef.current?.requestSubmit();
            }}
          >
            Close and apply
          </Button>
        }
      >
        <div className="space-y-3 text-sm text-muted">
          <p>
            Susu account{" "}
            <span className="font-medium text-foreground">
              {chosen?.account.accountNumber}
            </span>{" "}
            closes and its payout goes straight to the loan — the customer
            receives no cash. Both happen together or neither does.
          </p>
          <dl className="space-y-2 rounded-lg border border-border bg-background p-3">
            <Figure
              label="Deposited"
              value={formatGhs(chosen?.account.totalDeposited ?? 0)}
            />
            <Figure
              label="Commission kept"
              value={formatGhs(chosen?.account.dailyAmount ?? 0)}
            />
            <Figure
              label="Applied to loan"
              value={formatGhs(chosen?.payout ?? 0)}
              strong
            />
            <Figure
              label="Owed after"
              value={formatGhs(Math.max(0, remaining - (chosen?.payout ?? 0)))}
            />
          </dl>
          <p>The account can't be reopened, and this can't be reversed.</p>
        </div>
      </ConfirmModal>

      <Form ref={formRef} method="post" className="space-y-4">
        <input type="hidden" name="intent" value="repay-susu" />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="susuAccountId" value={selected ?? ""} />

        <p className="text-sm text-muted">
          {formatGhs(remaining)} still owed. Closing a susu account applies its
          payout to that balance instead of paying the customer.
        </p>

        {rows.length === 0 ? (
          <p className="rounded-lg border-2 border-dashed border-border p-6 text-center text-sm text-muted">
            This customer has no open susu accounts.{" "}
            <Link
              to={`/customers/${customerId}/accounts`}
              className="font-medium text-success hover:underline"
            >
              Their accounts
            </Link>
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map(({ account, payout, blocked }) => (
              <li key={account.id}>
                <button
                  type="button"
                  // Blocked accounts stay clickable and stay visible: hiding
                  // them would leave someone wondering where an account went,
                  // and the reason is the useful part.
                  onClick={() => setSelected(account.id)}
                  aria-pressed={selected === account.id}
                  className={`w-full rounded-lg border-2 p-3 text-left transition-colors ${
                    selected === account.id
                      ? "border-success"
                      : "border-border hover:border-success/50"
                  } ${blocked ? "opacity-70" : ""}`}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-foreground">
                      {account.accountNumber}
                    </span>
                    <span className="tabular-nums text-foreground">
                      {formatGhs(payout)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {formatGhs(account.dailyAmount)} daily ·{" "}
                    {account.depositsCount}/{account.cycleTarget} paid ·{" "}
                    {formatGhs(account.totalDeposited)} in
                  </span>
                  {blocked && (
                    <span className="mt-1.5 flex gap-1.5 text-xs text-warning-foreground dark:text-warning">
                      <ArrowUpRight size={12} className="mt-0.5 shrink-0" />
                      {blocked}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted">
          The payout is this app's projection — deposits less one day's
          commission. The API computes its own at closure, and refuses the whole
          operation if it comes to more than the loan owes.
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
