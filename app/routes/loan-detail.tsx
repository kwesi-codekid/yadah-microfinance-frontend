import { useEffect, useRef, useState } from "react";
import { data, Form, Link, useNavigation, useSubmit } from "react-router";
import { Button } from "@heroui/react";
import {
  ArrowUpRight,
  Ban,
  Banknote,
  Check,
  Clock,
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
  readExceedsBalance,
  repaymentSourceLabel,
  settlementAmount,
  type Loan,
} from "~/lib/loan-client";
import { readRejectionForm, readRepaymentForm } from "~/lib/loan-form";
import { formatGhs, parseGhsAmount, toAmountInput } from "~/lib/money";
import { projectedPayout, type SusuAccount } from "~/lib/susu-client";
import { requireOffice, withAuth } from "~/lib/session.server";

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
      // The loan usually names its customer; only fetch when it doesn't.
      detail.loan.customerName
        ? null
        : customersApi.getCustomer(token, detail.loan.customerId),
      // Only to name who recorded each repayment.
      usersApi.listUsers(token, { limit: 100 }),
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
      customerName:
        detail.loan.customerName ??
        customer?.customer.fullName ??
        "Unnamed customer",
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
        id: result.detail.loan.customerId,
        fullName: result.customerName,
      },
      staffNames,
      susuAccounts: result.susuAccounts,
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

function messageFor(failure: ApiFailure): string {
  if (failure.status === 0) return "Something went wrong. Please try again.";
  const known: Record<string, string> = {
    NOT_PENDING:
      "This application has already been decided — someone got there first.",
    LOAN_NOT_OPEN:
      "This loan isn't open, so no repayment can be recorded against it.",
    // The spec now says the excess is handled, but still lists this code —
    // so it is mapped in case staging is running the older behaviour.
    PAYOUT_EXCEEDS_BALANCE:
      "This API build still refuses a payout larger than the loan owes. Record a cash repayment for the balance, then close the account normally.",
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

    const excessTo =
      form.get("excessTo") === "savings" ? "savings" : "pending-withdrawal";

    const result = await loansApi.repayLoanFromSusu(token, id, {
      susuAccountId,
      idempotencyKey,
      excessTo,
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

    // The API caps what it applies at the balance; the rest went somewhere.
    const excess = closure
      ? Math.max(0, closure.payout - result.repayment.amount)
      : 0;
    const spare =
      excess > 0
        ? excessTo === "savings"
          ? ` ${formatGhs(excess)} over went to their savings.`
          : ` ${formatGhs(excess)} over stays in the susu account for them to collect.`
        : "";

    return {
      ok: true,
      intent,
      message:
        settledMessage(result.loan, result.repayment.amount) + detail + spare,
    } satisfies ActionData;
  }

  return { formError: "Unsupported action." } satisfies ActionData;
}

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
          {loan.status === "repaid" && <SettledBanner loan={loan} />}
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

      {loan.status === "pending" ? (
        <p className="mt-6 rounded-lg border-2 border-dashed border-border p-6 text-center text-sm text-muted">
          This application is waiting on a decision. Approving it locks the rate
          and interest from the settings as they stand at that moment, generates
          the monthly schedule, and sends the customer an SMS.
        </p>
      ) : loan.status === "rejected" ? null : (
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
      )}
    </div>
  );
}

function MoneyPanel({ loan }: { loan: Loan }) {
  return (
    <section>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi
          icon={<Banknote size={14} />}
          label="Principal"
          value={formatGhs(loan.principal)}
        />
        <Kpi
          icon={<Percent size={14} />}
          label={`Interest at ${loan.ratePercent}%`}
          value={formatGhs(loan.interestAmount)}
        />
        <Kpi
          icon={<Receipt size={14} />}
          label="Total repayable"
          value={formatGhs(loan.totalDue)}
        />
        <Kpi
          icon={<HandCoins size={14} />}
          label="Paid"
          value={formatGhs(loan.totalRepaid)}
          tone="success"
        />
        <Kpi
          icon={<Wallet size={14} />}
          label="Still owed"
          value={formatGhs(loan.remaining)}
          tone={loan.status === "arrears" ? "danger" : undefined}
        />
      </div>

      {(loan.escalatedAt || loan.frozen) && <RatePrompt loan={loan} />}

      {loan.status === "rejected" && loan.rejectionReason && (
        <Note tone="muted">
          <span className="font-medium text-foreground">Rejected:</span>{" "}
          {loan.rejectionReason}
        </Note>
      )}
    </section>
  );
}

/**
 * What the rate ladder has done to this loan, and what the office does next.
 * Stated rather than implied: an escalated total is larger than the figure the
 * customer was quoted, and whoever is holding the counter has to explain it.
 */
function RatePrompt({ loan }: { loan: Loan }) {
  const frozen = loan.frozen;

  return (
    <div
      className={`mt-3 overflow-hidden rounded-lg border-2 ${
        frozen
          ? "border-border bg-surface-secondary"
          : "border-red-500/40 bg-red-500/5"
      }`}
    >
      <div className="flex gap-3 p-3.5">
        <span
          aria-hidden="true"
          className={`grid size-8 shrink-0 place-items-center rounded-full ${
            frozen
              ? "bg-border text-muted"
              : "bg-red-500/15 text-red-600 dark:text-red-400"
          }`}
        >
          {frozen ? <Snowflake size={16} /> : <TriangleAlert size={16} />}
        </span>

        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {frozen
              ? "Frozen — this one needs a person"
              : `The rate has climbed to ${loan.ratePercent}%`}
          </p>

          <p className="text-xs text-muted">
            {loan.escalatedAt && (
              <>
                Escalated {formatDate(loan.escalatedAt)}, charged on the
                original {formatGhs(loan.principal)} rather than the balance —
                so the {formatGhs(loan.totalDue)} above is more than the
                customer was quoted at approval.{" "}
              </>
            )}
            {frozen &&
              "The ladder is exhausted, so nothing further will be added automatically."}
          </p>
        </div>
      </div>

      {/* The instruction, kept apart from the explanation above it. */}
      <p
        className={`border-t px-3.5 py-2 text-xs ${
          frozen
            ? "border-border text-muted"
            : "border-red-500/20 text-red-600 dark:text-red-400"
        }`}
      >
        <span className="font-medium">What to do:</span>{" "}
        {frozen
          ? "Agree terms with the customer and settle it by hand — the API will not move this loan again on its own."
          : "Quote the new total before taking anything at the counter, and chase the arrears while the ladder can still climb."}
      </p>
    </div>
  );
}

/** A closed loan's verdict, sat opposite the breadcrumbs where the actions were. */
function SettledBanner({ loan }: { loan: Loan }) {
  const onTime = loan.repaidOnTime;

  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border-2 py-1.5 pl-2 pr-3.5 ${
        onTime
          ? "border-success/30 bg-success/10"
          : "border-warning/40 bg-warning/10"
      }`}
    >
      <span
        aria-hidden="true"
        className={`grid size-7 shrink-0 place-items-center rounded-full ${
          onTime
            ? "bg-success/15 text-success"
            : "bg-warning/20 text-warning-foreground dark:text-warning"
        }`}
      >
        {onTime ? <Check size={15} /> : <Clock size={15} />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight text-foreground">
          Settled{loan.closedAt ? ` ${formatDate(loan.closedAt)}` : ""}
        </span>
        <span className="block text-xs leading-tight text-muted">
          {onTime
            ? "On time — the big tier is unlocked for their next loan."
            : "Late — the big tier stays locked."}
        </span>
      </span>
    </div>
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

  // A payout larger than the balance is no longer refused: the API applies what
  // the loan owes and hands the rest back one of two ways, so only an account
  // with nothing to give is blocked.
  const [excessTo, setExcessTo] = useState<"pending-withdrawal" | "savings">(
    "pending-withdrawal",
  );

  const rows = accounts.map((account) => {
    const payout = projectedPayout(account);
    return {
      account,
      payout,
      blocked:
        payout <= 0
          ? "No payout yet — deposits don't cover the commission."
          : null,
    };
  });

  const chosen = rows.find((row) => row.account.id === selected) ?? null;
  const ready = chosen !== null && chosen.blocked === null;
  const applied = chosen ? Math.min(chosen.payout, remaining) : 0;
  const excess = chosen ? Math.max(0, chosen.payout - remaining) : 0;

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
            stops and its payout goes straight to the loan — the customer
            receives no cash now. Both happen together or neither does.
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
            <Figure label="Applied to loan" value={formatGhs(applied)} strong />
            <Figure
              label="Owed after"
              value={formatGhs(Math.max(0, remaining - applied))}
            />
            {excess > 0 && (
              <Figure
                label={
                  excessTo === "savings"
                    ? "Into their savings"
                    : "Left in the susu account"
                }
                value={formatGhs(excess)}
              />
            )}
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

        {/* Only worth asking once there is something left over to place. */}
        {excess > 0 && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-foreground">
              The {formatGhs(excess)} over
            </legend>
            <input type="hidden" name="excessTo" value={excessTo} />
            <div className="flex gap-2">
              <ExcessChoice
                selected={excessTo === "pending-withdrawal"}
                onSelect={() => setExcessTo("pending-withdrawal")}
                title="Leave it in the account"
                detail="They collect it in cash whenever they come in."
              />
              <ExcessChoice
                selected={excessTo === "savings"}
                onSelect={() => setExcessTo("savings")}
                title="Into their savings"
                detail="Credited in the same transaction, no deposit minimum."
              />
            </div>
          </fieldset>
        )}

        <p className="text-xs text-muted">
          The payout is this app's projection — deposits less one day's
          commission. The API computes its own, applies at most the{" "}
          {formatGhs(remaining)} still owed, and hands back whatever is over.
        </p>
      </Form>
    </SideDrawer>
  );
}

/** Where the money over the loan's balance goes. Two ways, both the API's. */
function ExcessChoice({
  selected,
  onSelect,
  title,
  detail,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex-1 rounded-md border-2 px-3 py-2 text-left transition-colors ${
        selected
          ? "border-success"
          : "border-border hover:border-success/50"
      }`}
    >
      <span
        className={`block text-sm ${
          selected ? "font-semibold text-foreground" : "font-medium text-muted"
        }`}
      >
        {title}
      </span>
      <span className="mt-0.5 block text-xs text-muted">{detail}</span>
    </button>
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
