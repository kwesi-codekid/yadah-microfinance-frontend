import { useEffect, useRef, useState } from "react";
import { data, Form, useNavigation, useSubmit } from "react-router";
import { Button } from "@heroui/react";
import { HandCoins, Lock, TriangleAlert, X } from "lucide-react";
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
  cycleTargetAmount,
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
  // Any signed-in role may open any account — the API no longer scopes
  // collectors to their own customers.
  const user = await requireUser(request);
  const office = isOffice(user);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const { account } = await susuApi.getSusuAccount(token, params.id);
    const [deposits, customer, staff] = await Promise.all([
      // 100, not the default 20: a cycle is at most 31 deposits, so one page
      // always holds the lot and the grid is never drawn with holes in it.
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
      /**
       * Accra's calendar day, decided here rather than in the component. The
       * calendar renders on the server and again in the browser, and asking
       * the clock in both places draws two different "today"s either side of
       * midnight — a hydration mismatch on someone else's machine.
       */
      today: accraToday(),
      /**
       * Minted here, per page load, and carried in a hidden field — see
       * `newIdempotencyKey`. A retry of the same submit reuses it and the API
       * replays the original deposit instead of taking the money twice; a
       * successful submit revalidates this loader, so the *next* deposit gets a
       * fresh key and is correctly treated as new.
       */
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

  // Recording a deposit is the collector's job — the API checks it is their own
  // customer. Closing an account pays cash out, and is office-only.
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

    // 422 EXCEEDS_REMAINING carries the days actually left. Put it on the field
    // that is wrong, with the real number, rather than in a banner that only
    // says the request failed.
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
    // No `remaining` passed here: the browser gates the field against the count
    // it already has on screen, and the API owns the authoritative check —
    // re-fetching the account just to repeat it would be a round trip that
    // could still be stale by the time the deposit lands.
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

  /**
   * Statement filter: one cycle position, picked by clicking its chip.
   *
   * Component state rather than a search param, which is what the rest of the
   * app's filters use, for two reasons specific to this page:
   *
   * - There is nothing to ask the server. `listSusuDeposits` takes only `page`
   *   and `limit`, and the loader already pulls the whole cycle — at most 31
   *   rows — so every deposit is in hand and filtering is an array filter.
   * - A search param navigates, which revalidates this loader, which remints
   *   `idempotencyKey`. The deposit drawer is keyed on it, so filtering while
   *   the drawer was open would remount it and bin whatever was typed.
   */
  const [seq, setSeq] = useState<number | null>(null);
  const filtering = seq !== null;

  function clearFilter() {
    setSeq(null);
  }

  // A chip asks for one position, and one position belongs to exactly one
  // deposit — the catch-up that covered it, if that is what paid it.
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
    // Only a recorded deposit closes the drawer. A rejected one leaves it open
    // with the message on the field it belongs to — closing on failure would
    // throw away what was typed and hide why it wouldn't go through.
    if (actionData?.ok && actionData.intent === "deposit") setRecording(false);
  }, [actionData]);

  return (
    <div className="mx-auto w-full px-6 py-8">
      {/* The trail replaces the heading block and the row of links under it:
          every one of those was a way back to the customer or their other
          accounts, which is what a breadcrumb is. The account number is the
          last crumb because it is what a customer quotes — the `id` in the URL
          means nothing to anyone. */}
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
          {/* Collectors record deposits too — any collector, on any account —
              so this is gated on the account, not the role. */}
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

      {/* Only an active account takes deposits. A completed cycle is full and
          a closed one is paid out — offering the form on either would be
          offering a button the API refuses.

          Mounted whether or not it is open, so the panel can animate out as
          well as in. Keyed on the idempotency key, which the loader remints on
          every revalidation: a recorded deposit therefore resets the day count
          and the channel, while a rejected one — same key, same mount — keeps
          what was typed. */}
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

      {/* The cycle leads: one panel about four rows deep, so the state of the
          account and the first few deposits land on the same screen. The month
          grid this replaced was two or three cards tall, which is what pushed
          the statement below the fold and sent it above the cycle in the first
          place — at this height the ordering can go back to the way it reads:
          where the cycle stands, then the deposits that got it there. */}
      {/* No visible heading: the panel opens with "Day 12 of 31", which says
          what a "Cycle" label would have said and says it with the numbers in
          it. The label stays on the section for screen readers, which get no
          such hint from the layout. */}
      <section aria-label="Cycle">
        <CycleChips
          account={account}
          deposits={deposits}
          selectedSeq={seq}
          // A toggle: clicking the day already isolated clears the filter,
          // so the chip that turned the statement down to one row is also
          // the way back — without hunting for the Clear button.
          onSelectSeq={(next) =>
            setSeq((prev) => (prev === next ? null : next))
          }
        />

        {/* Hidden for now — put this line back to show it again. */}
        {/* <MoneyCard account={account} /> */}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">
            Transaction history
          </h2>

          {/* The way out, for anyone who doesn't guess that clicking the lit
              chip again is the other one. */}
          {filtering && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-8 rounded-md"
              onPress={clearFilter}
            >
              <X size={14} />
              Clear
            </Button>
          )}
        </div>

        {/* Said only while it applies: which day is showing, and how much of
            the statement it is hiding. */}
        {filtering && (
          <p className="mb-2 text-xs text-muted">
            Showing {visible.length} of {deposits.length} deposits — day {seq}{" "}
            of the cycle.
          </p>
        )}

        <DataTable
          columns={["Date", "Days", "Amount", "Channel", "Recorded by"]}
          ariaLabel="Deposit history"
          // No filtered-empty case to handle: only a paid chip is clickable,
          // and the position it names always belongs to exactly one deposit.
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
                {/* A catch-up covers a range — showing `12–15` rather than `4`
                    is what lets a statement be reconciled against the grid. */}
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

/**
 * Record one day, or several at once for a customer catching up on days they
 * missed. No amount field: the API multiplies the account's fixed daily amount
 * by the days covered, so an amount here would be a number the collector could
 * get wrong and the server would ignore.
 *
 * A drawer rather than a card on the page: collecting is a thing you do to this
 * account, not part of reading it, and the form sat between the calendar and
 * the statement — two views of the same deposits — pushing them apart on every
 * visit, including the ones where nobody was collecting.
 */
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

  // The same reader the action runs, run here against the typed value — so the
  // rule that rejects "0", "1.5" or more days than the cycle has left is
  // written once and enforced on both sides.
  const probe = new FormData();
  probe.set("daysCovered", days);
  probe.set("idempotencyKey", idempotencyKey);
  const { fieldErrors: liveErrors } = readDepositForm(probe, left);
  const dayCount = Number(days);
  const total = Number.isInteger(dayCount) ? dayCount * account.dailyAmount : 0;
  const ready = Object.keys(liveErrors).length === 0;

  // The footer sits outside the form the drawer scrolls, so the submit button
  // points back at it by id.
  const formId = "record-deposit";

  /**
   * Send it, without going through the form's own submit event.
   *
   * `submit(formElement)` reads the form's fields and navigates directly; a
   * `requestSubmit()` here would fire `onSubmit` again, which is the thing that
   * opened this confirmation in the first place, and the two would bounce off
   * each other forever.
   */
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
          {/* Opens the confirmation rather than submitting. Money is being
              taken from someone standing at the counter, and a deposit is not
              undoable — the API has no reversal, only a second deposit. */}
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
        // The modal's backdrop and the drawer's panel are both `z-50`, so
        // which one paints on top comes down to DOM order — the modal portals
        // to the end of `body` and wins, but only by accident of where React
        // Aria mounts it. Stated outright instead: this opens *over* the
        // drawer that summoned it.
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

      {/* `onSubmit` is intercepted so that Enter in the day field asks for
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
              // No autofocus: the field already says 1, which is what most
              // deposits are, and focusing it pops a phone's keypad over the
              // drawer for a value nobody was going to change.
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

        {/* What the button is about to take, in figures, above it rather than
            on it — a collector counting cash into a drawer is reading this,
            not the label. */}
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
  // The API flags this case on closure; saying so beforehand is what stops a
  // teller promising a payout that turns out to be nothing.
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

/**
 * What the cycle is worth, and what closing it would pay.
 *
 * Currently not rendered — the call site in the page above is commented out.
 * Kept whole rather than deleted because nothing about it is wrong: every
 * figure here is either stored on the account or derived from the daily
 * amount, so bringing it back is uncommenting one line.
 */
function MoneyCard({ account }: { account: SusuAccount }) {
  const left = remainingDeposits(account);
  const closed = account.status === "closed";

  return (
    <Card title="Money">
      <dl className="space-y-3">
        <Figure
          label="Saved so far"
          value={formatGhs(account.totalDeposited)}
          strong
        />
        <Figure label="Full cycle" value={formatGhs(cycleTargetAmount(account))} />
        {left > 0 && (
          <Figure
            label="Still to collect"
            value={formatGhs(left * account.dailyAmount)}
          />
        )}

        {closed ? (
          <>
            <Figure
              label="Commission kept"
              value={formatGhs(account.commissionAmount ?? 0)}
            />
            <Figure
              label="Paid out"
              value={formatGhs(account.payoutAmount ?? 0)}
              strong
            />
            <Figure label="Closed" value={formatDate(account.closedAt)} />
          </>
        ) : (
          <>
            {/* The two numbers every withdrawal conversation starts with.
                Commission is one day's deposit whatever day they leave on, so
                both are knowable before anyone commits. */}
            <Figure
              label="Commission at closure"
              value={formatGhs(account.dailyAmount)}
            />
            <Figure
              label="Payout if closed today"
              value={formatGhs(projectedPayout(account))}
              strong
            />
          </>
        )}
      </dl>
    </Card>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border-2 border-border bg-surface p-5">
      <h2 className="mb-4 text-xs font-bold uppercase tracking-wide text-muted">
        {title}
      </h2>
      {children}
    </section>
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
