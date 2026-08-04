import { useEffect, useRef, useState } from "react";
import { data, Form, Link, useNavigation, useSubmit } from "react-router";
import { Button } from "@heroui/react";
import {
  Ban,
  Banknote,
  HandCoins,
  Package,
  PackageX,
  Percent,
  Receipt,
  RotateCcw,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import type { Route } from "./+types/hp-agreement-detail";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { DataTable, Table } from "~/components/data-table";
import { FIELD, FieldError, SelectField } from "~/components/form-fields";
import { HpStatusPill } from "~/components/hp-status";
import { TextInput, TextareaInput } from "~/components/inputs";
import { Kpi } from "~/components/kpi";
import { ConfirmModal } from "~/components/modals";
import { SideDrawer } from "~/components/side-drawer";
import { notify } from "~/components/toast";
import {
  throwAsRouteError,
  toApiFailure,
  type ApiFailure,
} from "~/lib/api/client";
import * as customersApi from "~/lib/api/customers";
import * as hpApi from "~/lib/api/hire-purchase";
import { PAYMENT_CHANNEL_LABELS, PAYMENT_CHANNELS } from "~/lib/channel";
import { formatDate, formatDateTime } from "~/lib/format";
import {
  HP_CHANNELS,
  isOpenAgreement,
  newIdempotencyKey,
  paidPercent,
  readAgreementPayload,
  readHpAmount,
  redemptionOpen,
  type HpAgreement,
} from "~/lib/hp-client";
import {
  formatCell,
  labelOf,
  type Row,
} from "~/lib/report-shape";
import { formatGhs, parseGhsAmount, toAmountInput } from "~/lib/money";
import { requireOffice, withAuth } from "~/lib/session.server";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `${loaderData?.customerName ?? "Agreement"} · Hire purchase · YADAH Dynamic Enterprise`,
    },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOffice(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const payload = await hpApi.getHpAgreement(token, params.id);
    const { agreement, payments } = readAgreementPayload(payload);
    if (!agreement) {
      throw new Response("Agreement not found", { status: 404 });
    }

    // The list rows name their customer; the detail may not.
    const customer = agreement.customerName
      ? null
      : await customersApi
          .getCustomer(token, agreement.customerId)
          .catch(() => null);

    return {
      agreement,
      payments,
      customerName:
        agreement.customerName ?? customer?.customer.fullName ?? "Unnamed customer",
    };
  }).catch(throwAsRouteError); // 404

  return data(
    {
      ...result,
      paymentKey: newIdempotencyKey(),
      redeemKey: newIdempotencyKey(),
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
    return data<ActionData>(result, { headers });
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const failure = toApiFailure(error);

    const required = readHpAmount(failure.details, "required");
    if (required !== null) {
      return data<ActionData>({
        intent,
        fieldErrors: {
          amount: `The deposit is ${formatGhs(required)} exactly — half the price, and the API takes nothing else.`,
        },
        failure,
      });
    }

    const remaining = readHpAmount(failure.details, "remaining");
    if (remaining !== null) {
      return data<ActionData>({
        intent,
        fieldErrors: {
          amount: `Only ${formatGhs(remaining)} is still owed. An agreement can't be overpaid.`,
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
      "This agreement has already been decided — someone got there first.",
    AGREEMENT_NOT_OPEN:
      "This agreement isn't open, so no payment can be recorded against it.",
    INVALID_TRANSITION:
      "That isn't a step this agreement can take from where it stands.",
    REDEMPTION_WINDOW_LAPSED:
      "The month to redeem has passed. The item can only be forfeited now.",
    REDEMPTION_WINDOW_OPEN:
      "The customer still has time to redeem, so it can't be forfeited yet.",
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
  const channelRaw = String(form.get("channel") ?? "cash");
  const channel = HP_CHANNELS.includes(channelRaw as (typeof HP_CHANNELS)[number])
    ? (channelRaw as (typeof HP_CHANNELS)[number])
    : "cash";
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");

  if (intent === "deposit" || intent === "payment") {
    const amount = parseGhsAmount(String(form.get("amount") ?? ""));
    if (amount === null || amount <= 0) {
      return { intent, fieldErrors: { amount: "Enter the cash taken." } };
    }
    if (idempotencyKey.length < 8) {
      return { intent, formError: "Reload the page and try again." };
    }

    const result =
      intent === "deposit"
        ? await hpApi.recordHpDeposit(token, id, {
            amount,
            idempotencyKey,
            channel,
          })
        : await hpApi.recordHpPayment(token, id, {
            amount,
            idempotencyKey,
            channel,
          });

    if (result.replayed) {
      return {
        ok: true,
        intent,
        message: "Already recorded — this is the same payment, not a second one.",
      };
    }

    if (intent === "deposit") {
      return {
        ok: true,
        intent,
        message: `Deposit taken. The item can be released, and ${formatGhs(result.agreement.remaining)} is left to pay.`,
      };
    }

    return {
      ok: true,
      intent,
      message:
        result.agreement.status === "closed-completed"
          ? `Settled with ${formatGhs(amount)}. The item is theirs.`
          : `Recorded ${formatGhs(amount)}. ${formatGhs(result.agreement.remaining)} still owed.`,
    };
  }

  if (intent === "reject") {
    const reason = String(form.get("reason") ?? "").trim();
    if (reason.length < 2 || reason.length > 300) {
      return {
        intent,
        fieldErrors: { reason: "Say why, in 2–300 characters." },
      };
    }
    await hpApi.rejectHpAgreement(token, id, { reason });
    return { ok: true, intent, message: "Rejected — the item is back in stock." };
  }

  if (intent === "mark-arrears") {
    await hpApi.markHpArrears(token, id);
    return {
      ok: true,
      intent,
      message: "Flagged as in arrears. The warning SMS has been sent.",
    };
  }

  if (intent === "repossess") {
    const reason = String(form.get("reason") ?? "").trim();
    if (reason.length < 2 || reason.length > 300) {
      return {
        intent,
        fieldErrors: { reason: "Say why, in 2–300 characters." },
      };
    }
    const { agreement } = await hpApi.repossessHpAgreement(token, id, { reason });
    return {
      ok: true,
      intent,
      message: agreement.redemptionDeadline
        ? `Repossessed. They have until ${formatDate(agreement.redemptionDeadline)} to redeem it.`
        : "Repossessed. The redemption window has started.",
    };
  }

  if (intent === "redeem") {
    if (idempotencyKey.length < 8) {
      return { intent, formError: "Reload the page and try again." };
    }
    const result = await hpApi.redeemHpAgreement(token, id, {
      idempotencyKey,
      channel,
    });
    return {
      ok: true,
      intent,
      message: result.replayed
        ? "Already redeemed — this is the same payment, not a second one."
        : `Redeemed with ${formatGhs(result.agreement.totalPaid)} paid in all. The item is theirs.`,
    };
  }

  if (intent === "forfeit") {
    const restockPrice = parseGhsAmount(String(form.get("sellingPrice") ?? ""));
    const restockCost = parseGhsAmount(String(form.get("costPrice") ?? ""));
    const wantsRestock = form.get("restock") === "on";

    if (wantsRestock && (restockPrice === null || restockCost === null)) {
      return {
        intent,
        fieldErrors: {
          sellingPrice: "Both prices are needed to put it back on the shelf.",
        },
      };
    }

    await hpApi.forfeitHpAgreement(token, id, {
      restock:
        wantsRestock && restockPrice !== null && restockCost !== null
          ? {
              name: String(form.get("name") ?? "").trim() || undefined,
              costPrice: restockCost,
              sellingPrice: restockPrice,
            }
          : undefined,
    });
    return {
      ok: true,
      intent,
      message: wantsRestock
        ? "Forfeited, and the item is back in stock as used."
        : "Forfeited. The item and the payments stay with Yadah.",
    };
  }

  return { formError: "Unsupported action." };
}

export default function HpAgreementDetail({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { agreement, payments, customerName, paymentKey, redeemKey } = loaderData;
  const [paying, setPaying] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [repossessing, setRepossessing] = useState(false);
  const [forfeiting, setForfeiting] = useState(false);

  const open = isOpenAgreement(agreement.status);
  const pending = agreement.status === "pending";
  const repossessed = agreement.status === "repossessed";
  // The API decides for real; this only shapes what the page offers.
  const canRedeem = repossessed && redemptionOpen(agreement, new Date());

  useEffect(() => {
    if (actionData?.ok) {
      notify.success(actionData.message ?? "Done.");
      setPaying(false);
      setRejecting(false);
      setRepossessing(false);
      setForfeiting(false);
    } else if (actionData?.formError) {
      notify.error(actionData.formError);
    }
    if (actionData?.failure)
      console.error("[hire-purchase] request failed:", actionData.failure);
  }, [actionData]);

  return (
    <div className="mx-auto w-full px-6 py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs
          items={[
            { label: "Hire purchase", to: "/hire-purchase" },
            { label: customerName, to: `/customers/${agreement.customerId}` },
            { label: agreement.item.name },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          {pending && (
            <>
              <Button
                type="button"
                size="sm"
                className="min-h-9 rounded-md bg-success px-3"
                onPress={() => setPaying(true)}
              >
                <HandCoins size={14} />
                Take the deposit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                className="min-h-9 rounded-md px-3"
                onPress={() => setRejecting(true)}
              >
                <Ban size={14} />
                Reject
              </Button>
            </>
          )}

          {open && (
            <>
              <Button
                type="button"
                size="sm"
                className="min-h-9 rounded-md bg-success px-3"
                onPress={() => setPaying(true)}
              >
                <HandCoins size={14} />
                Record payment
              </Button>
              {agreement.status === "active" && (
                <IntentButton intent="mark-arrears" label="Flag arrears">
                  <TriangleAlert size={14} />
                </IntentButton>
              )}
              <Button
                type="button"
                size="sm"
                variant="danger"
                className="min-h-9 rounded-md px-3"
                onPress={() => setRepossessing(true)}
              >
                <PackageX size={14} />
                Repossess
              </Button>
            </>
          )}

          {repossessed && (
            <>
              {canRedeem && (
                <RedeemButton
                  agreement={agreement}
                  idempotencyKey={redeemKey}
                />
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-9 rounded-md border-2 border-border px-3"
                onPress={() => setForfeiting(true)}
              >
                <Package size={14} />
                Forfeit
              </Button>
            </>
          )}
        </div>
      </div>

      <section>
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <HpStatusPill agreement={agreement} />
          <p className="text-xs text-muted">
            Signed {formatDate(agreement.createdAt)}
            {agreement.itemReleasedAt &&
              ` · released ${formatDate(agreement.itemReleasedAt)}`}
            {agreement.redemptionDeadline &&
              ` · redeem by ${formatDate(agreement.redemptionDeadline)}`}
            {agreement.closedAt && ` · closed ${formatDate(agreement.closedAt)}`}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi
            icon={<Package size={14} />}
            label="Price"
            value={formatGhs(agreement.item.sellingPrice)}
          />
          <Kpi
            icon={<Banknote size={14} />}
            label="Deposit"
            value={formatGhs(agreement.depositRequired)}
          />
          <Kpi
            icon={<Percent size={14} />}
            label={`Financed at ${agreement.interestRatePercent}%`}
            value={formatGhs(agreement.financedAmount)}
          />
          <Kpi
            icon={<Receipt size={14} />}
            label="Paid"
            value={formatGhs(agreement.totalPaid)}
            tone="success"
          />
          <Kpi
            icon={<Wallet size={14} />}
            label="Still owed"
            value={formatGhs(agreement.remaining)}
            tone={agreement.status === "in-arrears" ? "danger" : undefined}
          />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-border">
            <span
              className="block h-full rounded-full bg-success transition-all"
              style={{ width: `${paidPercent(agreement)}%` }}
            />
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted">
            {paidPercent(agreement)}% paid
          </span>
        </div>

        {agreement.repossessionReason && (
          <Note tone="danger" icon={<PackageX size={13} />}>
            Repossessed
            {agreement.repossessedAt
              ? ` ${formatDate(agreement.repossessedAt)}`
              : ""}
            : {agreement.repossessionReason}
            {agreement.redemptionDeadline &&
              ` The customer may redeem it by paying the whole balance before ${formatDate(agreement.redemptionDeadline)}; after that it can be forfeited.`}
          </Note>
        )}

        {agreement.rejectionReason && (
          <Note tone="muted">
            <span className="font-medium text-foreground">Rejected:</span>{" "}
            {agreement.rejectionReason}
          </Note>
        )}

        {pending && (
          <Note tone="muted" icon={<Package size={13} />}>
            The item stays on the shelf until the {formatGhs(agreement.depositRequired)}{" "}
            deposit is paid — that is what releases it.
          </Note>
        )}
      </section>

      {payments.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
            Payments
          </h2>
          <PaymentsTable rows={payments} />
        </section>
      )}

      <PaymentDrawer
        key={paymentKey}
        isOpen={paying}
        agreement={agreement}
        idempotencyKey={paymentKey}
        mode={pending ? "deposit" : "payment"}
        fieldErrors={
          actionData?.intent === "deposit" || actionData?.intent === "payment"
            ? actionData.fieldErrors
            : undefined
        }
        onClose={() => setPaying(false)}
      />

      <ReasonDrawer
        isOpen={rejecting}
        onClose={() => setRejecting(false)}
        intent="reject"
        title="Reject this agreement"
        submitLabel="Reject"
        blurb="The item goes back into stock and the customer is told why."
        fieldErrors={
          actionData?.intent === "reject" ? actionData.fieldErrors : undefined
        }
      />

      <ReasonDrawer
        isOpen={repossessing}
        onClose={() => setRepossessing(false)}
        intent="repossess"
        title="Repossess the item"
        submitLabel="Repossess"
        blurb="Payments made so far are kept. The customer then has exactly one month to redeem it by paying the whole remaining balance."
        fieldErrors={
          actionData?.intent === "repossess" ? actionData.fieldErrors : undefined
        }
      />

      <ForfeitDrawer
        isOpen={forfeiting}
        agreement={agreement}
        onClose={() => setForfeiting(false)}
        fieldErrors={
          actionData?.intent === "forfeit" ? actionData.fieldErrors : undefined
        }
      />
    </div>
  );
}

/** A one-click POST for the actions that need no input. */
function IntentButton({
  intent,
  label,
  children,
}: {
  intent: string;
  label: string;
  children: React.ReactNode;
}) {
  const navigation = useNavigation();

  return (
    <Form method="post">
      <input type="hidden" name="intent" value={intent} />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="min-h-9 rounded-md border-2 border-border px-3"
        isDisabled={navigation.state === "submitting"}
      >
        {children}
        {label}
      </Button>
    </Form>
  );
}

/** Redeeming pays the whole balance, so the amount is the API's to compute. */
function RedeemButton({
  agreement,
  idempotencyKey,
}: {
  agreement: HpAgreement;
  idempotencyKey: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Form method="post" ref={formRef}>
        <input type="hidden" name="intent" value="redeem" />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="channel" value="cash" />
        <Button
          type="button"
          size="sm"
          className="min-h-9 rounded-md bg-success px-3"
          onPress={() => setConfirming(true)}
        >
          <RotateCcw size={14} />
          Redeem
        </Button>
      </Form>

      <ConfirmModal
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Redeem this item?"
        footer={
          <Button
            size="sm"
            className="rounded-md bg-success"
            onPress={() => {
              setConfirming(false);
              formRef.current?.requestSubmit();
            }}
          >
            Redeem
          </Button>
        }
      >
        <div className="space-y-3 text-sm text-muted">
          <p>
            The customer pays the whole remaining balance —{" "}
            <span className="font-medium text-foreground">
              {formatGhs(agreement.remaining)}
            </span>{" "}
            by this app's reading — and ownership transfers. The API computes the
            exact figure itself.
          </p>
          <p>Count the cash before confirming; this can't be reversed.</p>
        </div>
      </ConfirmModal>
    </>
  );
}

function PaymentDrawer({
  isOpen,
  agreement,
  idempotencyKey,
  mode,
  fieldErrors,
  onClose,
}: {
  isOpen: boolean;
  agreement: HpAgreement;
  idempotencyKey: string;
  mode: "deposit" | "payment";
  fieldErrors?: Record<string, string>;
  onClose: () => void;
}) {
  const navigation = useNavigation();
  const submit = useSubmit();
  const submitting = navigation.state === "submitting";
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);

  const exact = mode === "deposit" ? agreement.depositRequired : null;
  const [amount, setAmount] = useState(exact ? toAmountInput(exact) : "");

  const pesewas = parseGhsAmount(amount);
  const ready = pesewas !== null && pesewas > 0;
  const settles = mode === "payment" && pesewas === agreement.remaining;

  return (
    <SideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={mode === "deposit" ? "Take the deposit" : "Record a payment"}
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
            {submitting ? "Recording…" : "Record"}
          </Button>
        </>
      }
    >
      <ConfirmModal
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Record this payment?"
        closeLabel="Back"
        className="z-60"
        footer={
          <Button
            size="sm"
            className="rounded-md bg-success"
            onPress={() => {
              setConfirming(false);
              if (formRef.current) submit(formRef.current, { method: "post" });
            }}
          >
            Record
          </Button>
        }
      >
        <div className="space-y-3 text-sm text-muted">
          <dl className="space-y-2 rounded-lg border border-border bg-background p-3">
            <Figure label="Owed now" value={formatGhs(agreement.remaining)} />
            <Figure label="Taking" value={formatGhs(pesewas ?? 0)} strong />
            <Figure
              label="Owed after"
              value={formatGhs(
                Math.max(0, agreement.remaining - (pesewas ?? 0)),
              )}
            />
          </dl>
          {mode === "deposit" && (
            <p className="rounded-lg bg-success/10 p-3 text-success">
              This releases the item — it can leave the shop once recorded.
            </p>
          )}
          {settles && (
            <p className="rounded-lg bg-success/10 p-3 text-success">
              This settles the agreement and ownership transfers.
            </p>
          )}
          <p>Count the cash before confirming — a payment can't be reversed.</p>
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
        <input type="hidden" name="intent" value={mode} />
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
              {mode === "deposit"
                ? `${formatGhs(agreement.depositRequired)} exactly — half the price, and the API takes nothing else.`
                : `${formatGhs(agreement.remaining)} still owed.`}
            </p>
            {mode === "payment" && agreement.remaining > 0 && (
              <button
                type="button"
                onClick={() => setAmount(toAmountInput(agreement.remaining))}
                className="shrink-0 text-xs font-medium text-success hover:underline"
              >
                Settle in full
              </button>
            )}
          </div>
          <FieldError message={fieldErrors?.amount} />
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

        <p className="text-xs text-muted">
          Interest is flat and was applied once at activation, so settling early
          pays the same total. Payments clear the oldest instalment first.
        </p>
      </Form>
    </SideDrawer>
  );
}

/** Reject and repossess differ only in wording — both are a reason and a POST. */
function ReasonDrawer({
  isOpen,
  onClose,
  intent,
  title,
  submitLabel,
  blurb,
  fieldErrors,
}: {
  isOpen: boolean;
  onClose: () => void;
  intent: string;
  title: string;
  submitLabel: string;
  blurb: string;
  fieldErrors?: Record<string, string>;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [reason, setReason] = useState("");
  const formId = `hp-${intent}`;
  const ready = reason.trim().length >= 2 && reason.trim().length <= 300;

  return (
    <SideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={title}
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
            type="submit"
            form={formId}
            variant="danger"
            className="rounded-md"
            isDisabled={submitting || !ready}
          >
            {submitting ? "Working…" : submitLabel}
          </Button>
        </>
      }
    >
      <Form id={formId} method="post" className="space-y-4">
        <input type="hidden" name="intent" value={intent} />
        <TextareaInput
          name="reason"
          label="Reason"
          value={reason}
          onChange={setReason}
          textareaProps={{ rows: 4, placeholder: "Why?" }}
        />
        <FieldError message={reason ? fieldErrors?.reason : undefined} />
        <p className="text-xs text-muted">{blurb} 2–300 characters.</p>
      </Form>
    </SideDrawer>
  );
}

/** Forfeiting can put the item back on the shelf, as used, at a new price. */
function ForfeitDrawer({
  isOpen,
  agreement,
  onClose,
  fieldErrors,
}: {
  isOpen: boolean;
  agreement: HpAgreement;
  onClose: () => void;
  fieldErrors?: Record<string, string>;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [restock, setRestock] = useState(false);

  return (
    <SideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Forfeit this agreement"
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
            type="submit"
            form="hp-forfeit"
            variant="danger"
            className="rounded-md"
            isDisabled={submitting}
          >
            {submitting ? "Working…" : "Forfeit"}
          </Button>
        </>
      }
    >
      <Form id="hp-forfeit" method="post" className="space-y-5">
        <input type="hidden" name="intent" value="forfeit" />

        <p className="text-sm text-muted">
          The item and the {formatGhs(agreement.totalPaid)} paid so far stay with
          Yadah for good. This is refused while the redemption window is still
          open.
        </p>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="restock"
            checked={restock}
            onChange={(event) => setRestock(event.target.checked)}
            className="size-4 rounded border-border accent-accent"
          />
          Put it back in stock, as used
        </label>

        {restock && (
          <>
            <div className="space-y-1.5">
              <TextInput
                name="name"
                label="Name on the shelf (optional)"
                defaultValue={agreement.item.name}
                inputProps={{ autoComplete: "off", className: FIELD }}
              />
              <p className="text-xs text-muted">
                Leave it as it is unless the condition needs saying.
              </p>
            </div>
            <div className="space-y-1.5">
              <TextInput
                name="costPrice"
                label="Cost price"
                inputProps={{
                  inputMode: "decimal",
                  autoComplete: "off",
                  placeholder: "0.00",
                  className: FIELD,
                }}
              />
            </div>
            <div className="space-y-1.5">
              <TextInput
                name="sellingPrice"
                label="New selling price"
                inputProps={{
                  inputMode: "decimal",
                  autoComplete: "off",
                  placeholder: "0.00",
                  className: FIELD,
                }}
              />
              <FieldError message={fieldErrors?.sellingPrice} />
              <p className="text-xs text-muted">
                A used item rarely fetches what a new one does — the office sets
                both figures.
              </p>
            </div>
          </>
        )}
      </Form>
    </SideDrawer>
  );
}

/** The payment rows, whatever columns they turn out to carry. */
function PaymentsTable({ rows }: { rows: Row[] }) {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }

  return (
    <DataTable
      columns={columns.map(labelOf)}
      ariaLabel="Payments"
      heightClass="max-h-none"
      emptyContent={{
        title: "No payments yet",
        subtext: "The first one will appear here.",
      }}
    >
      {rows.map((row, index) => (
        <Table.Row key={index} id={String(index)}>
          {columns.map((column) => (
            <Table.Cell key={column} className="px-4 py-2 text-muted">
              {formatCell(column, row[column])}
            </Table.Cell>
          ))}
        </Table.Row>
      ))}
    </DataTable>
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
