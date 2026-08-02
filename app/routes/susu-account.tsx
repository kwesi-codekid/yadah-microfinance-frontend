import { useEffect, useRef, useState } from "react";
import { data, Form, useNavigation, useSubmit } from "react-router";
import { Button } from "@heroui/react";
import { HandCoins, Lock, TriangleAlert } from "lucide-react";
import type { Route } from "./+types/susu-account";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { DataTable, Table } from "~/components/data-table";
import { FIELD, FieldError, SelectField } from "~/components/form-fields";
import { TextInput } from "~/components/inputs";
import { ConfirmModal } from "~/components/modals";
import { SideDrawer } from "~/components/side-drawer";
import { CycleChips } from "~/components/susu-cycle";
import { notify } from "~/components/toast";
import {
  throwAsRouteError,
  toApiFailure,
  type ApiFailure,
} from "~/lib/api/client";
import * as customersApi from "~/lib/api/customers";
import * as susuApi from "~/lib/api/susu";
import * as usersApi from "~/lib/api/users";
import { accraToday, formatDate } from "~/lib/format";
import { formatGhs } from "~/lib/money";
import { readDepositForm } from "~/lib/susu-form";
import {
  DEPOSIT_CHANNEL_LABELS,
  DEPOSIT_CHANNELS,
  newIdempotencyKey,
  projectedPayout,
  readExceedsRemaining,
  remainingDeposits,
  type SusuAccount,
} from "~/lib/susu-client";
import { isOffice, requireUser, withAuth } from "~/lib/session.server";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `${loaderData?.customer.fullName ?? "Susu account"} · Susu · YADAH Dynamic Enterprise`,
    },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const office = isOffice(user);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const { account } = await susuApi.getSusuAccount(token, params.id);
    const [deposits, customer, staff] = await Promise.all([
      susuApi.listSusuDeposits(token, params.id, { limit: 100 }),
      customersApi.getCustomer(token, account.customerId),
      // Only to name who recorded each deposit, and only office roles may ask.
      office ? usersApi.listUsers(token, { limit: 100 }) : null,
    ]);
    return {
      account,
      deposits: deposits.items,
      customer: customer.customer,
      staff: staff?.items ?? [],
    };
  }).catch(throwAsRouteError); // 404

  const staffNames: Record<string, string> = {};
  for (const member of result.staff) staffNames[member.id] = member.name;

  return data(
    {
      account: result.account,
      deposits: result.deposits,
      customer: {
        id: result.customer.id,
        fullName: result.customer.fullName,
      },
      staffNames,
      canManage: office,
      today: accraToday(),
      idempotencyKey: newIdempotencyKey(),
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

  if (intent === "close" && !isOffice(user)) {
    return data<ActionData>({
      intent,
      formError: "Only office staff can close an account.",
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

    const remaining = readExceedsRemaining(failure.details);
    if (remaining !== null) {
      return data<ActionData>({
        intent,
        fieldErrors: {
          daysCovered:
            remaining === 0
              ? "This cycle is already complete."
              : `Only ${remaining} ${remaining === 1 ? "day is" : "days are"} left on this cycle.`,
        },
        failure,
      });
    }

    return data<ActionData>({
      intent,
      formError:
        failure.status === 0
          ? "Something went wrong. Please try again."
          : failure.status === 409 && intent === "deposit"
            ? // The key is still in the form, so pressing the button again
              // cannot double-record — it either lands or replays.
              "Someone recorded a deposit at the same moment. Try again."
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
  if (intent === "deposit") {
    const { daysCovered, channel, idempotencyKey, fieldErrors } =
      readDepositForm(form);
    if (Object.keys(fieldErrors).length)
      return { intent, fieldErrors } satisfies ActionData;

    const result = await susuApi.recordSusuDeposit(token, id, {
      daysCovered,
      channel,
      idempotencyKey,
    });

    if (result.replayed) {
      return {
        ok: true,
        intent,
        message:
          "Already recorded — this is the same deposit, not a second one.",
      } satisfies ActionData;
    }

    const covered =
      result.deposit.daysCovered > 1
        ? ` covering ${result.deposit.daysCovered} days`
        : "";
    const completed =
      result.account.status === "completed"
        ? " That completes the 31-day cycle."
        : "";
    return {
      ok: true,
      intent,
      message: `Recorded ${formatGhs(result.deposit.amount)}${covered}. Day ${result.account.depositsCount} of ${result.account.cycleTarget}.${completed}`,
    } satisfies ActionData;
  }

  if (intent === "close") {
    const result = await susuApi.closeSusuAccount(token, id);
    return {
      ok: true,
      intent,
      message: result.flagged
        ? `Closed. Payout ${formatGhs(result.payout)} — flagged: the deposits did not cover the ${formatGhs(result.commission)} commission.`
        : `Closed. Pay out ${formatGhs(result.payout)} (commission ${formatGhs(result.commission)}).`,
    } satisfies ActionData;
  }

  return { formError: "Unsupported action." } satisfies ActionData;
}

export default function SusuAccountDetail({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    account,
    deposits,
    customer,
    staffNames,
    canManage,
    idempotencyKey,
  } = loaderData;
  const closed = account.status === "closed";
  const [recording, setRecording] = useState(false);

  const [seq, setSeq] = useState<number | null>(null);
  const filtering = seq !== null;

  function clearFilter() {
    setSeq(null);
  }

  const visible =
    seq === null
      ? deposits
      : deposits.filter(
          (deposit) => deposit.seqStart <= seq && seq <= deposit.seqEnd,
        );

  useEffect(() => {
    if (actionData?.ok) notify.success(actionData.message ?? "Done.");
    else if (actionData?.formError) notify.error(actionData.formError);
    if (actionData?.failure)
      console.error("[susu-account] request failed:", actionData.failure);
    if (actionData?.ok && actionData.intent === "deposit") setRecording(false);
  }, [actionData]);

  return (
    <div className="mx-auto w-full px-6 py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs
          items={[
            { label: "Customers", to: "/customers" },
            { label: customer.fullName, to: `/customers/${customer.id}` },
            {
              label: "Accounts",
              to: `/customers/${customer.id}/accounts?status=all`,
            },
            { label: `Susu ${account.accountNumber}` },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          {account.status === "active" && (
            <Button
              type="button"
              size="sm"
              className="min-h-9 rounded-md bg-success px-3"
              onPress={() => setRecording(true)}
            >
              <HandCoins size={14} />
              Record deposit
            </Button>
          )}
          {canManage && !closed && (
            <CloseButton account={account} name={customer.fullName} />
          )}
        </div>
      </div>

      {account.status === "active" && (
        <DepositDrawer
          key={idempotencyKey}
          isOpen={recording}
          account={account}
          idempotencyKey={idempotencyKey}
          fieldErrors={actionData?.fieldErrors}
          onClose={() => setRecording(false)}
        />
      )}

      <section aria-label="Cycle">
        <CycleChips
          account={account}
          deposits={deposits}
          selectedSeq={seq}
          onSelectSeq={(next) =>
            setSeq((prev) => (prev === next ? null : next))
          }
          onClearFilter={clearFilter}
        />

        {/* Hidden for now — put this line back to show it again. */}
        {/* <MoneyCard account={account} /> */}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
          Transaction history
        </h2>

        {filtering && (
          <p className="mb-2 text-xs text-muted">
            Showing {visible.length} of {deposits.length} deposits — day {seq}{" "}
            of the cycle.
          </p>
        )}

        <DataTable
          columns={["Date", "Days", "Amount", "Channel", "Recorded by"]}
          ariaLabel="Deposit history"
          paginated
          resetKey={seq ?? "all"}
          emptyContent={{
            icon: <HandCoins size={20} />,
            title: "No deposits yet",
            subtext: "The first deposit will appear here.",
          }}
        >
          {visible.map((deposit) => (
            <Table.Row key={deposit.id} id={deposit.id}>
              <Table.Cell className="px-4 py-2 text-muted">
                {formatDate(deposit.createdAt)}
              </Table.Cell>
              <Table.Cell className="px-4 py-2 tabular-nums text-muted">
                {deposit.seqStart === deposit.seqEnd
                  ? deposit.seqStart
                  : `${deposit.seqStart}–${deposit.seqEnd}`}
              </Table.Cell>
              <Table.Cell className="px-4 py-2 font-medium tabular-nums text-foreground">
                {formatGhs(deposit.amount)}
              </Table.Cell>
              <Table.Cell className="px-4 py-2 text-muted">
                {DEPOSIT_CHANNEL_LABELS[deposit.channel]}
                {deposit.collectAllBatchId && (
                  <span
                    className="ml-1.5 text-xs"
                    title="Collected together with this customer's other accounts"
                  >
                    · batch
                  </span>
                )}
              </Table.Cell>
              <Table.Cell className="px-4 py-2 text-muted">
                {staffNames[deposit.collectorId] ?? (canManage ? "Unknown" : "—")}
              </Table.Cell>
            </Table.Row>
          ))}
        </DataTable>
      </section>
    </div>
  );
}

function DepositDrawer({
  isOpen,
  account,
  idempotencyKey,
  fieldErrors,
  onClose,
}: {
  isOpen: boolean;
  account: SusuAccount;
  idempotencyKey: string;
  fieldErrors?: Record<string, string>;
  onClose: () => void;
}) {
  const navigation = useNavigation();
  const submit = useSubmit();
  const submitting = navigation.state === "submitting";
  const [days, setDays] = useState("1");
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const left = remainingDeposits(account);

  const probe = new FormData();
  probe.set("daysCovered", days);
  probe.set("idempotencyKey", idempotencyKey);
  const { fieldErrors: liveErrors } = readDepositForm(probe, left);
  const dayCount = Number(days);
  const total = Number.isInteger(dayCount) ? dayCount * account.dailyAmount : 0;
  const ready = Object.keys(liveErrors).length === 0;

  const formId = "record-deposit";

  function confirmAndSend() {
    setConfirming(false);
    if (formRef.current) submit(formRef.current, { method: "post" });
  }

  return (
    <SideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Record a deposit"
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
            {submitting ? "Recording…" : "Record deposit"}
          </Button>
        </>
      }
    >
      <ConfirmModal
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Record this deposit?"
        closeLabel="Back"
        className="z-60"
        footer={
          <Button
            size="sm"
            className="rounded-md bg-success"
            onPress={confirmAndSend}
          >
            Record deposit
          </Button>
        }
      >
        <div className="space-y-3 text-sm text-muted">
          <p>
            Collecting{" "}
            <span className="font-medium text-foreground">
              {formatGhs(total)}
            </span>{" "}
            {dayCount > 1
              ? `for ${dayCount} days of this cycle.`
              : "for one day of this cycle."}
          </p>
          <dl className="space-y-2 rounded-lg border border-border bg-background p-3">
            <Figure label="Daily amount" value={formatGhs(account.dailyAmount)} />
            {dayCount > 1 && <Figure label="Days" value={`× ${dayCount}`} />}
            <Figure label="Collecting" value={formatGhs(total)} strong />
            <Figure
              label="Cycle after this"
              value={`${Math.min(account.cycleTarget, account.depositsCount + dayCount)} / ${account.cycleTarget}`}
            />
          </dl>
          <p>Count the cash before confirming — a deposit can't be reversed.</p>
        </div>
      </ConfirmModal>

      <Form
        id={formId}
        ref={formRef}
        method="post"
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) setConfirming(true);
        }}
      >
        <input type="hidden" name="intent" value="deposit" />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        <div className="space-y-1.5">
          <TextInput
            name="daysCovered"
            label="Days covered"
            value={days}
            onChange={setDays}
            inputProps={{
              type: "number",
              min: 1,
              max: left,
              step: 1,
              inputMode: "numeric",
              className: FIELD,
            }}
          />
          <p className="text-xs text-muted">
            1 for today. More to catch up on missed days — {left} left.
          </p>
          <FieldError
            message={liveErrors.daysCovered ?? fieldErrors?.daysCovered}
          />
        </div>

        <SelectField
          name="channel"
          label="Channel"
          defaultValue="cash"
          options={DEPOSIT_CHANNELS.map((channel) => ({
            value: channel,
            label: DEPOSIT_CHANNEL_LABELS[channel],
          }))}
        />

        <dl className="space-y-2 rounded-lg border-2 border-border bg-background p-3">
          <Figure label="Daily amount" value={formatGhs(account.dailyAmount)} />
          {dayCount > 1 && (
            <Figure label="Days" value={`× ${dayCount}`} />
          )}
          <Figure label="Collecting" value={formatGhs(total)} strong />
        </dl>
      </Form>
    </SideDrawer>
  );
}

/** Closing pays cash out and cannot be undone, so it asks — with the figures. */
function CloseButton({
  account,
  name,
}: {
  account: SusuAccount;
  name: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);
  const payout = projectedPayout(account);
  const shortOfCommission = account.totalDeposited < account.dailyAmount;

  return (
    <>
      <Form method="post" ref={formRef}>
        <input type="hidden" name="intent" value="close" />
        <Button
          type="button"
          size="sm"
          variant="danger"
          className="rounded-md"
          onPress={() => setConfirming(true)}
        >
          <Lock size={14} />
          Close account
        </Button>
      </Form>

      <ConfirmModal
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Close this account?"
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
            Close and pay out
          </Button>
        }
      >
        <div className="space-y-3 text-sm text-muted">
          <p>
            <span className="font-medium text-foreground">{name}</span> stops
            saving on this account and is paid out now. This cannot be undone —
            a new cycle means a new account.
          </p>
          <dl className="space-y-2 rounded-lg border border-border bg-background p-3">
            <Figure
              label="Saved"
              value={formatGhs(account.totalDeposited)}
            />
            <Figure
              label="Commission (one day)"
              value={formatGhs(account.dailyAmount)}
            />
            <Figure label="Pay out" value={formatGhs(payout)} strong />
          </dl>
          {shortOfCommission && (
            <p className="flex gap-2 rounded-lg bg-warning/15 p-3 text-warning-foreground dark:text-warning">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <span>
                The deposits don't cover the {formatGhs(account.dailyAmount)}{" "}
                commission, so there is nothing to pay out and the account will
                be flagged.
              </span>
            </p>
          )}
        </div>
      </ConfirmModal>
    </>
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
