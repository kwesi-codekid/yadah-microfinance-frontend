import { useEffect, useRef, useState } from "react";
import { data, Form, useNavigation, useSubmit } from "react-router";
import { Button } from "@heroui/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  HandCoins,
  Lock,
  TriangleAlert,
} from "lucide-react";
import type { Route } from "./+types/savings-account";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { DataTable, Table } from "~/components/data-table";
import { FIELD, FieldError, SelectField } from "~/components/form-fields";
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
import * as savingsApi from "~/lib/api/savings";
import * as usersApi from "~/lib/api/users";
import { PAYMENT_CHANNEL_LABELS, PAYMENT_CHANNELS } from "~/lib/channel";
import { accraToday, formatDate } from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import { formatGhs, parseGhsAmount, toAmountInput } from "~/lib/money";
import {
  closurePayout,
  hasCashedOutOn,
  readExceedsAvailable,
  SAVINGS_FEE,
  SAVINGS_MIN_BALANCE,
  SAVINGS_MIN_DEPOSIT,
  SAVINGS_TXN_TYPE_LABELS,
  withdrawalCost,
  type SavingsAccount,
  type SavingsTxnType,
} from "~/lib/savings-client";
import { readSavingsDepositForm, readWithdrawalForm } from "~/lib/savings-form";
import { isOffice, requireUser, withAuth } from "~/lib/session.server";

/**
 * One savings account, with its statement.
 *
 * The susu equivalent ([susu-account.tsx](app/routes/susu-account.tsx)) leads
 * with the cycle, because a susu account *is* a cycle and the 31 chips answer
 * every question about it. A savings account has no cycle, and this page leads
 * with nothing: the statement is the account. Everything else about the page is
 * deliberately the same shape, because it is the same job on the next product
 * along.
 *
 * There was a money panel in the slot the cycle chips occupy — balance,
 * available, and the minimum and fee that separate them — and it is gone by
 * request. The consequence worth knowing: **the balance is no longer stated
 * anywhere on this page.** It is still readable, as the `Balance after` on the
 * newest statement row, and `availableToWithdraw` still governs the withdrawal
 * form, which prints it. If the figure is wanted back, it belongs beside the
 * account number in the trail rather than as a panel.
 */

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `${loaderData?.customer.fullName ?? "Savings account"} · Savings · YADAH Dynamic Enterprise`,
    },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  // Any signed-in role may open any account — the API scopes nothing here.
  const user = await requireUser(request);
  const office = isOffice(user);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const { account } = await savingsApi.getSavingsAccount(token, params.id);
    const [txns, customer, staff] = await Promise.all([
      // 50 rather than the default 20: unlike a susu cycle this list has no
      // ceiling, so it is paged — but a page deep enough to hold a few months
      // of activity means most accounts never need a second one.
      savingsApi.listSavingsTxns(token, params.id, { limit: 50 }),
      customersApi.getCustomer(token, account.customerId),
      // Only to name who recorded each line, and only office roles may ask.
      office ? usersApi.listUsers(token, { limit: 100 }) : null,
    ]);
    return {
      account,
      txns: txns.items,
      txnTotal: txns.total,
      customer: customer.customer,
      staff: staff?.items ?? [],
    };
  }).catch(throwAsRouteError); // 404

  const staffNames: Record<string, string> = {};
  for (const member of result.staff) staffNames[member.id] = member.name;

  /**
   * Accra's calendar day, decided here rather than in the component — the page
   * renders on the server and again in the browser, and asking the clock in
   * both places draws two different "today"s either side of midnight.
   *
   * It is load-bearing here, not decoration: the API allows one cash-out per
   * Accra day, so this is what tells the withdraw and close buttons whether
   * today's has already gone.
   */
  const today = accraToday();

  return data(
    {
      account: result.account,
      txns: result.txns,
      txnTotal: result.txnTotal,
      customer: {
        id: result.customer.id,
        fullName: result.customer.fullName,
      },
      staffNames,
      canManage: office,
      today,
      /** True when a withdrawal or closure is already on today's statement. */
      cashedOutToday: hasCashedOutOn(result.txns, today),
      /**
       * Two keys, not one. Both writes are things a user might repeat on a bad
       * connection, and they are separate endpoints — sharing a key between a
       * deposit and a withdrawal would mean recording one leaves the other
       * holding a key that has already been spent.
       */
      depositKey: newIdempotencyKey(),
      withdrawalKey: newIdempotencyKey(),
    },
    { headers },
  );
}

/**
 * Why a cash-out can't go ahead, or null when it can.
 *
 * Both rules are the API's and the API enforces them regardless — this is only
 * so the answer arrives on the click rather than after a round trip, and so it
 * arrives *at all*: with the balance panel gone, a disabled button on this page
 * has nothing next to it explaining itself. Shared by the withdraw and close
 * buttons because closing is a payout too and the daily limit counts it.
 */
function withdrawBlockedReason(
  account: SavingsAccount,
  cashedOutToday: boolean,
  { closing = false }: { closing?: boolean } = {},
): { title: string; detail: string } | null {
  if (cashedOutToday) {
    return {
      title: "Already paid out today",
      detail:
        "One withdrawal per account per calendar day, and closing counts as one. Try again tomorrow — deposits are unaffected.",
    };
  }
  // Closing releases the minimum balance, so an account sitting exactly on it
  // has nothing to withdraw and everything to pay out. Only the withdraw path
  // is blocked by this.
  if (!closing && account.availableToWithdraw === 0) {
    return {
      title: "Nothing available to withdraw",
      detail: `The balance is ${formatGhs(account.balance)}, but ${formatGhs(SAVINGS_MIN_BALANCE)} has to stay in the account and a ${formatGhs(SAVINGS_FEE)} fee comes off every withdrawal. Closing the account is the only way to take the minimum out.`,
    };
  }
  return null;
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

  // Paying in is anyone's job. Taking money out — a withdrawal or the closing
  // payout — is office-only, and the API enforces it too.
  if (intent !== "deposit" && !isOffice(user)) {
    return data<ActionData>({
      intent,
      formError: "Only office staff can pay money out.",
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

    // 422 EXCEEDS_AVAILABLE carries what could actually have been taken. Put it
    // on the field that is wrong, with the real number — a balance can look
    // ample and still refuse, because the minimum and the fee come out of it.
    const available = readExceedsAvailable(failure.details);
    if (available !== null && intent === "withdraw") {
      return data<ActionData>({
        intent,
        fieldErrors: {
          amount:
            available === 0
              ? "Nothing can be withdrawn — the balance is at the minimum."
              : `Only ${formatGhs(available)} can be withdrawn.`,
        },
        failure,
      });
    }

    return data<ActionData>({
      intent,
      formError:
        failure.status === 0
          ? "Something went wrong. Please try again."
          : failure.code === "WITHDRAWAL_LIMIT"
            ? // Not retryable today, so say what the rule is rather than
              // repeating the API's terser phrasing.
              "This account has already been paid out today. Only one withdrawal per day is allowed."
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
    const { amount, channel, idempotencyKey, fieldErrors } =
      readSavingsDepositForm(form);
    if (Object.keys(fieldErrors).length)
      return { intent, fieldErrors } satisfies ActionData;

    const result = await savingsApi.recordSavingsDeposit(token, id, {
      amount,
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

    return {
      ok: true,
      intent,
      message: `Deposited ${formatGhs(result.txn.amount)}. Balance ${formatGhs(result.account.balance)}.`,
    } satisfies ActionData;
  }

  if (intent === "withdraw") {
    // No `available` passed here: the browser gates the field against the
    // figure already on screen, and the API owns the authoritative check —
    // re-fetching the account to repeat it would be a round trip that could
    // still be stale by the time the withdrawal lands.
    const { amount, idempotencyKey, fieldErrors } = readWithdrawalForm(form);
    if (Object.keys(fieldErrors).length)
      return { intent, fieldErrors } satisfies ActionData;

    const result = await savingsApi.recordSavingsWithdrawal(token, id, {
      amount,
      idempotencyKey,
    });

    if (result.replayed) {
      return {
        ok: true,
        intent,
        message:
          "Already recorded — this is the same withdrawal, not a second one.",
      } satisfies ActionData;
    }

    return {
      ok: true,
      intent,
      message: `Pay out ${formatGhs(result.txn.amount)} (fee ${formatGhs(result.txn.fee ?? SAVINGS_FEE)}). Balance ${formatGhs(result.account.balance)}.`,
    } satisfies ActionData;
  }

  if (intent === "close") {
    const result = await savingsApi.closeSavingsAccount(token, id);
    return {
      ok: true,
      intent,
      message: result.flagged
        ? `Closed. Payout ${formatGhs(result.payout)} — flagged: the balance did not cover the ${formatGhs(result.fee)} fee.`
        : `Closed. Pay out ${formatGhs(result.payout)} (fee ${formatGhs(result.fee)}).`,
    } satisfies ActionData;
  }

  return { formError: "Unsupported action." } satisfies ActionData;
}

export default function SavingsAccountDetail({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    account,
    txns,
    txnTotal,
    customer,
    staffNames,
    canManage,
    cashedOutToday,
    depositKey,
    withdrawalKey,
  } = loaderData;
  const active = account.status === "active";
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  useEffect(() => {
    if (actionData?.ok) notify.success(actionData.message ?? "Done.");
    else if (actionData?.formError) notify.error(actionData.formError);
    if (actionData?.failure)
      console.error("[savings-account] request failed:", actionData.failure);
    // Only a recorded write closes its drawer. A rejected one stays open with
    // the message on the field it belongs to — closing on failure would throw
    // away what was typed and hide why it wouldn't go through.
    if (actionData?.ok && actionData.intent === "deposit") setDepositing(false);
    if (actionData?.ok && actionData.intent === "withdraw")
      setWithdrawing(false);
  }, [actionData]);

  return (
    <div className="mx-auto w-full px-6 py-8">
      {/* Same trail as the susu page, with the product and the quotable number
          as the last crumb — the `id` in the URL means nothing to anyone. */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs
          items={[
            { label: "Customers", to: "/customers" },
            { label: customer.fullName, to: `/customers/${customer.id}` },
            {
              label: "Accounts",
              // Back to the savings side of the list, not susu's — the product
              // is a query param now, so the way back has to name it.
              to: `/customers/${customer.id}/accounts?product=savings&status=all`,
            },
            { label: `Savings ${account.accountNumber}` },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          {/* Paying in is gated on the account, not the role — any collector
              may take a deposit. Paying out is office-only and gated on both. */}
          {active && (
            <Button
              type="button"
              size="sm"
              className="min-h-9 rounded-md bg-success px-3"
              onPress={() => setDepositing(true)}
            >
              <HandCoins size={14} />
              Record deposit
            </Button>
          )}
          {canManage && active && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-9 rounded-md px-3  border-2 border-success text-success hover:bg-success/10"
              // Never disabled. The page states neither of the two rules that
              // block a cash-out — no balance panel, no standing note — so a
              // grey button here would be grey for no visible reason, which is
              // how this page confused someone once already. The click always
              // lands and `withdrawBlockedReason` answers with a toast naming
              // the rule and the figures. The API enforces both regardless.
              onPress={() => {
                const reason = withdrawBlockedReason(account, cashedOutToday);
                if (reason) {
                  notify.warning(reason.title, {
                    description: reason.detail,
                  });
                  return;
                }
                setWithdrawing(true);
              }}
            >
              <ArrowUpRight size={14} />
              Withdraw
            </Button>
          )}
          {canManage && active && (
            <CloseButton
              account={account}
              name={customer.fullName}
              cashedOutToday={cashedOutToday}
            />
          )}
        </div>
      </div>

      {active && (
        <>
          {/* Keyed on the idempotency key, which the loader remints on every
              revalidation: a recorded write therefore resets its form, while a
              rejected one — same key, same mount — keeps what was typed. */}
          <DepositDrawer
            key={depositKey}
            isOpen={depositing}
            account={account}
            idempotencyKey={depositKey}
            fieldErrors={
              actionData?.intent === "deposit"
                ? actionData.fieldErrors
                : undefined
            }
            onClose={() => setDepositing(false)}
          />
          <WithdrawDrawer
            key={withdrawalKey}
            isOpen={withdrawing}
            account={account}
            idempotencyKey={withdrawalKey}
            fieldErrors={
              actionData?.intent === "withdraw"
                ? actionData.fieldErrors
                : undefined
            }
            onClose={() => setWithdrawing(false)}
          />
        </>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">
            Transaaction history
          </h2>
          {/* This list has no ceiling, so say when there is more of it than is
              on screen rather than implying the account started 50 lines ago. */}
          {txnTotal > txns.length && (
            <p className="text-xs text-muted">
              Showing the latest {txns.length} of {txnTotal}.
            </p>
          )}
        </div>

        <DataTable
          columns={[
            "Date",
            "Type",
            "Amount",
            "Fee",
            "Balance after",
            "Channel",
            "Recorded by",
          ]}
          ariaLabel="Savings transaction history"
          emptyContent={{
            icon: <HandCoins size={20} />,
            title: "No transactions yet",
            subtext: "The first deposit will appear here.",
          }}
        >
          {txns.map((txn) => (
            <Table.Row key={txn.id} id={txn.id}>
              {/* `accraDay` rather than slicing `createdAt`: it is the API's
                  own calendar-day field, and it is the day the one-per-day
                  withdrawal rule counts — so a row reading "25 Jul" is the
                  same 25 Jul that blocks a second cash-out. Ghana is UTC+0, so
                  the two agree today; the field says which one is meant. */}
              <Table.Cell className="px-4 py-2 text-muted">
                {formatDate(txn.accraDay)}
              </Table.Cell>
              <Table.Cell className="px-4 py-2">
                <TxnType type={txn.type} />
              </Table.Cell>
              {/* Signed, because a statement of three transaction types with an
                  unsigned amount column is a puzzle: money in and money out
                  otherwise look identical. */}
              <Table.Cell
                className={`px-4 py-2 font-medium tabular-nums ${
                  txn.type === "deposit" ? "text-success" : "text-foreground"
                }`}
              >
                {txn.type === "deposit" ? "+" : "−"}
                {formatGhs(txn.amount, { symbol: null })}
              </Table.Cell>
              <Table.Cell className="px-4 py-2 tabular-nums text-muted">
                {txn.fee ? formatGhs(txn.fee, { symbol: null }) : "—"}
              </Table.Cell>
              <Table.Cell className="px-4 py-2 tabular-nums text-muted">
                {formatGhs(txn.balanceAfter, { symbol: null })}
              </Table.Cell>
              <Table.Cell className="px-4 py-2 text-muted">
                {PAYMENT_CHANNEL_LABELS[txn.channel]}
              </Table.Cell>
              <Table.Cell className="px-4 py-2 text-muted">
                {staffNames[txn.recordedById] ?? (canManage ? "Unknown" : "—")}
              </Table.Cell>
            </Table.Row>
          ))}
        </DataTable>
      </section>
    </div>
  );
}

/** Money in and money out, told apart by more than a minus sign. */
function TxnType({ type }: { type: SavingsTxnType }) {
  const tone =
    type === "deposit"
      ? "bg-success/15 text-success"
      : type === "closure"
        ? "bg-navy/15 text-navy dark:text-navy-light"
        : "bg-brand/15 text-brand-dark dark:text-brand-light";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {type === "deposit" ? (
        <ArrowDownLeft size={12} />
      ) : type === "closure" ? (
        <Lock size={12} />
      ) : (
        <ArrowUpRight size={12} />
      )}
      {SAVINGS_TXN_TYPE_LABELS[type]}
    </span>
  );
}

/**
 * Pay in. An amount and a channel, and nothing else — a savings balance has no
 * cycle to fill, so unlike the susu drawer there is no day count and no total
 * to project.
 */
function DepositDrawer({
  isOpen,
  account,
  idempotencyKey,
  fieldErrors,
  onClose,
}: {
  isOpen: boolean;
  account: SavingsAccount;
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

  // The same reader the action runs, run here against the typed value — so the
  // GHS 10 floor is written once and enforced on both sides.
  const probe = new FormData();
  probe.set("amount", amount);
  probe.set("idempotencyKey", idempotencyKey);
  const { fieldErrors: liveErrors } = readSavingsDepositForm(probe);
  const pesewas = parseGhsAmount(amount);
  const ready = Object.keys(liveErrors).length === 0;

  const formId = "record-savings-deposit";

  // See the note on the susu deposit drawer: `submit(form)` rather than
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
        // Both this and the drawer behind it are `z-50`; see the note on the
        // susu deposit drawer. Said outright rather than left to DOM order.
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
          <dl className="space-y-2 rounded-lg border border-border bg-background p-3">
            <Figure label="Balance now" value={formatGhs(account.balance)} />
            <Figure
              label="Taking"
              value={formatGhs(pesewas ?? 0)}
              strong
            />
            <Figure
              label="Balance after"
              value={formatGhs(account.balance + (pesewas ?? 0))}
            />
          </dl>
          <p>Count the cash before confirming — a deposit can't be reversed.</p>
        </div>
      </ConfirmModal>

      {/* `onSubmit` is intercepted so Enter in the amount field asks for
          confirmation too, rather than being the one route that skips it. */}
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
        {/* The whole point of the key: this exact value survives a retry, so a
            second tap on a bad connection replays the first deposit instead of
            taking the money again. */}
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        <div className="space-y-1.5">
          <TextInput
            name="amount"
            label="Amount"
            value={amount}
            onChange={setAmount}
            inputProps={{
              // `decimal` so a phone keypad offers the point for pesewas.
              inputMode: "decimal",
              autoComplete: "off",
              placeholder: "10.00",
              className: FIELD,
            }}
          />
          <p className="text-xs text-muted">
            {formatGhs(SAVINGS_MIN_DEPOSIT)} or more.
          </p>
          {/* The typed error wins over the server's: it is about what is in the
              field now, and the server's is about what was in it last submit. */}
          <FieldError
            message={
              amount ? (liveErrors.amount ?? fieldErrors?.amount) : fieldErrors?.amount
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

        {pesewas !== null && pesewas >= SAVINGS_MIN_DEPOSIT && (
          <dl className="space-y-2 rounded-lg border-2 border-border bg-background p-3">
            <Figure label="Taking" value={formatGhs(pesewas)} strong />
          </dl>
        )}
      </Form>
    </SideDrawer>
  );
}

/**
 * Pay out.
 *
 * The amount field is **what the customer receives**, which is what they ask
 * for — but the balance falls by that plus the flat fee, and those two numbers
 * being different is the whole reason this drawer shows a breakdown. A teller
 * counting notes reads the top figure; the customer checking their balance
 * afterwards reads the bottom one.
 */
function WithdrawDrawer({
  isOpen,
  account,
  idempotencyKey,
  fieldErrors,
  onClose,
}: {
  isOpen: boolean;
  account: SavingsAccount;
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
  const available = account.availableToWithdraw;

  const probe = new FormData();
  probe.set("amount", amount);
  probe.set("idempotencyKey", idempotencyKey);
  const { fieldErrors: liveErrors } = readWithdrawalForm(probe, available);
  const pesewas = parseGhsAmount(amount);
  const valid = pesewas !== null && Object.keys(liveErrors).length === 0;

  const formId = "record-savings-withdrawal";

  // See the note on the susu deposit drawer: `submit(form)` rather than
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
      title="Withdraw"
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
            isDisabled={submitting || !valid}
            onPress={() => setConfirming(true)}
          >
            {submitting ? "Paying out…" : "Pay out"}
          </Button>
        </>
      }
    >
      {/* The heaviest confirmation on the page after closure: cash leaves the
          drawer, the fee is charged whatever happens, and it uses up the
          account's one withdrawal for the day. */}
      <ConfirmModal
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Pay out this amount?"
        closeLabel="Back"
        // Above the drawer behind it; see the note on the deposit drawer.
        className="z-60"
        footer={
          <Button
            size="sm"
            className="rounded-md bg-success"
            onPress={confirmAndSend}
          >
            Pay out
          </Button>
        }
      >
        <div className="space-y-3 text-sm text-muted">
          <p>
            Hand over{" "}
            <span className="font-medium text-foreground">
              {formatGhs(pesewas ?? 0)}
            </span>
            . The balance falls by {formatGhs(withdrawalCost(pesewas ?? 0))} —
            the payout plus the {formatGhs(SAVINGS_FEE)} fee.
          </p>
          <dl className="space-y-2 rounded-lg border border-border bg-background p-3">
            <Figure
              label="Customer receives"
              value={formatGhs(pesewas ?? 0)}
              strong
            />
            <Figure label="Fee" value={formatGhs(SAVINGS_FEE)} />
            <Figure
              label="Balance after"
              value={formatGhs(
                Math.max(0, account.balance - withdrawalCost(pesewas ?? 0)),
              )}
            />
          </dl>
          <p>
            This is the account's one withdrawal for today, and it can't be
            reversed.
          </p>
        </div>
      </ConfirmModal>

      {/* `onSubmit` is intercepted so Enter in the amount field asks for
          confirmation too, rather than being the one route that skips it. */}
      <Form
        id={formId}
        ref={formRef}
        method="post"
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) setConfirming(true);
        }}
      >
        <input type="hidden" name="intent" value="withdraw" />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        <div className="space-y-1.5">
          {/* The label goes through `TextInput`'s own prop rather than a hand
              written `<label htmlFor>`: react-aria generates the input's id, so
              a guessed one would point at nothing and the field would be
              unlabelled to a screen reader. */}
          <TextInput
            name="amount"
            label="Amount to hand over"
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
            <p className="text-xs text-muted">{formatGhs(available)} available.</p>
            {/* Filling the field beats making someone work the maximum out
                from the balance and the fee — and "all of it" is the
                commonest withdrawal there is. */}
            {available > 0 && (
              <button
                type="button"
                onClick={() => setAmount(toAmountInput(available))}
                className="text-xs font-medium text-success hover:underline"
              >
                Use maximum
              </button>
            )}
          </div>
          <FieldError
            message={
              amount ? (liveErrors.amount ?? fieldErrors?.amount) : fieldErrors?.amount
            }
          />
        </div>

        {/* The three numbers, always — not only once the amount is valid. This
            is the arithmetic someone is checking *while* they type, and a panel
            that appears at the end is one they never see. */}
        <dl className="space-y-2 rounded-lg border-2 border-border bg-background p-3">
          <Figure
            label="Customer receives"
            value={formatGhs(valid && pesewas !== null ? pesewas : 0)}
            strong
          />
          <Figure label="Fee" value={formatGhs(SAVINGS_FEE)} />
          <Figure
            label="Leaves the balance"
            value={formatGhs(
              valid && pesewas !== null ? withdrawalCost(pesewas) : 0,
            )}
          />
          <Figure
            label="Balance after"
            value={formatGhs(
              valid && pesewas !== null
                ? Math.max(0, account.balance - withdrawalCost(pesewas))
                : account.balance,
            )}
          />
        </dl>

        <p className="text-xs text-muted">
          One withdrawal per day. {formatGhs(SAVINGS_MIN_BALANCE)} has to stay in
          the account — closing it is the only way to take that out.
        </p>
      </Form>
    </SideDrawer>
  );
}

/** Closing pays the balance out and cannot be undone, so it asks — with figures. */
function CloseButton({
  account,
  name,
  cashedOutToday,
}: {
  account: SavingsAccount;
  name: string;
  cashedOutToday: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);
  const payout = closurePayout(account);
  // The API flags this case on closure; saying so beforehand is what stops a
  // teller promising a payout that turns out to be nothing.
  const shortOfFee = account.balance < SAVINGS_FEE;

  return (
    <>
      <Form method="post" ref={formRef}>
        <input type="hidden" name="intent" value="close" />
        <Button
          type="button"
          size="sm"
          variant="danger"
          className="rounded-md"
          // Same treatment as Withdraw: closing is a payout too, so the
          // one-per-day rule counts it (the API answers 409
          // WITHDRAWAL_LIMIT), and the toast is the only thing that says so.
          // `closing` exempts it from the available-balance rule — releasing
          // the minimum is precisely what closing does.
          onPress={() => {
            const reason = withdrawBlockedReason(account, cashedOutToday, {
              closing: true,
            });
            if (reason) {
              notify.warning(reason.title, { description: reason.detail });
              return;
            }
            setConfirming(true);
          }}
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
            saving on this account and is paid out now, the{" "}
            {formatGhs(SAVINGS_MIN_BALANCE)} minimum included. This cannot be
            undone.
          </p>
          <dl className="space-y-2 rounded-lg border border-border bg-background p-3">
            <Figure label="Balance" value={formatGhs(account.balance)} />
            <Figure label="Closing fee" value={formatGhs(SAVINGS_FEE)} />
            <Figure label="Pay out" value={formatGhs(payout)} strong />
          </dl>
          {shortOfFee && (
            <p className="flex gap-2 rounded-lg bg-warning/15 p-3 text-warning-foreground dark:text-warning">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <span>
                The balance doesn't cover the {formatGhs(SAVINGS_FEE)} fee, so
                there is nothing to pay out and the account will be flagged.
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
