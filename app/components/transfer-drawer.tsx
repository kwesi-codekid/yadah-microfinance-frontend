import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "@heroui/react";
import {
  Coins,
  HandCoins,
  LoaderCircle,
  Package,
  PiggyBank,
} from "lucide-react";
import { FIELD, FieldError } from "~/components/form-fields";
import { TextInput } from "~/components/inputs";
import { ConfirmModal } from "~/components/modals";
import { SideDrawer } from "~/components/side-drawer";
import { notify } from "~/components/toast";
import type { ApiFailure } from "~/lib/api/client";
import { formatGhs, parseGhsAmount, toAmountInput } from "~/lib/money";
import { SAVINGS_FEE } from "~/lib/savings-client";
import type {
  TransferEndpoint,
  TransferSourceInfo,
} from "~/lib/transfer-client";

const ICONS = {
  susu: Coins,
  savings: PiggyBank,
  loan: HandCoins,
  "hire-purchase": Package,
} as const;

type Destinations = { destinations: TransferEndpoint[]; transferKey: string };

type TransferResult = {
  ok?: boolean;
  message?: string;
  formError?: string;
  fieldErrors?: Record<string, string>;
  failure?: ApiFailure;
};

/**
 * Moves money out of the account whose row it was opened from. The source is
 * settled by that row, so only the destination and the amount are asked for.
 */
export function TransferDrawer({
  isOpen,
  onClose,
  customerId,
  customerName,
  source,
}: {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  customerName: string;
  source: TransferSourceInfo;
}) {
  const options = useFetcher<Destinations>();
  const sending = useFetcher<TransferResult>();
  const formRef = useRef<HTMLFormElement>(null);

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  // The fetcher keeps its last answer, which is not this opening's answer.
  const [showResult, setShowResult] = useState(false);

  // One load per opening, which is also what mints a fresh idempotency key.
  useEffect(() => {
    if (!isOpen) return;
    setTo("");
    setAmount("");
    setShowResult(false);
    const params = new URLSearchParams({ customerId, exclude: source.key });
    options.load(`/transfers/destinations?${params}`);
    // `options` is stable enough to leave out; including it reloads endlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, customerId, source.key]);

  const result = showResult ? sending.data : undefined;
  useEffect(() => {
    if (result?.ok) {
      notify.success(result.message ?? "Transferred.");
      onClose();
    } else if (result?.formError) {
      notify.error(result.formError);
    }
    if (result?.failure)
      console.error("[transfer] request failed:", result.failure);
    // `onClose` is a fresh closure each render; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const loading = options.state === "loading";
  const submitting = sending.state !== "idle";
  const destinations = options.data?.destinations ?? [];
  const transferKey = options.data?.transferKey ?? "";

  const target = destinations.find((entry) => entry.key === to) ?? null;
  const pesewas = parseGhsAmount(amount);
  const moving = source.partial ? (pesewas ?? 0) : source.amount;
  const ready =
    target !== null &&
    transferKey.length >= 8 &&
    (!source.partial || (pesewas !== null && pesewas > 0));

  function confirmAndSend() {
    setConfirming(false);
    if (!formRef.current) return;
    setShowResult(true);
    sending.submit(formRef.current, {
      method: "post",
      action: "/transfers/new",
    });
  }

  return (
    <SideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Transfer"
      width="w-[420px] max-w-full"
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
            {submitting
              ? "Moving…"
              : `Transfer ${moving > 0 ? formatGhs(moving) : ""}`}
          </Button>
        </>
      }
    >
      <ConfirmModal
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Move this money?"
        closeLabel="Back"
        className="z-60"
        footer={
          <Button
            size="sm"
            className="rounded-md bg-success"
            onPress={confirmAndSend}
          >
            Transfer
          </Button>
        }
      >
        <div className="space-y-3 text-sm text-muted">
          <p>
            <span className="font-medium text-foreground">{source.title}</span> →{" "}
            <span className="font-medium text-foreground">{target?.title}</span>
          </p>
          <dl className="space-y-2 rounded-lg border border-border bg-background p-3">
            <Figure label="Taken from this account" value={formatGhs(moving)} />
            {source.kind === "savings" && (
              <Figure label="Withdrawal fee" value={formatGhs(SAVINGS_FEE)} />
            )}
            {target && target.amount > 0 && moving > target.amount && (
              <Figure
                label="More than it can take"
                value={formatGhs(moving - target.amount)}
              />
            )}
          </dl>
          {target && target.amount > 0 && moving > target.amount && (
            <p>
              {target.title} takes {formatGhs(target.amount)} — what it still
              owes. The rest stays in the susu account for {customerName} to
              collect.
            </p>
          )}
          {source.kind === "susu" && !source.partial && (
            <p>
              This stops the susu account. It can't be reopened — a new cycle
              means a new account.
            </p>
          )}
          <p>{customerName} gets one SMS covering the whole move.</p>
        </div>
      </ConfirmModal>

      <sending.Form
        ref={formRef}
        method="post"
        action="/transfers/new"
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) setConfirming(true);
        }}
      >
        <input type="hidden" name="idempotencyKey" value={transferKey} />
        <input type="hidden" name="from" value={source.key} />
        <input type="hidden" name="to" value={to} />

        <p className="rounded-lg bg-surface-secondary px-3 py-2 text-xs text-muted">
          Sending from{" "}
          <span className="font-medium text-foreground">{source.title}</span> —{" "}
          {customerName}.
        </p>

        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-foreground">
            Send it to
          </legend>

          {loading ? (
            <p className="flex items-center gap-2 rounded-lg border-2 border-dashed border-border p-4 text-xs text-muted">
              <LoaderCircle size={14} className="animate-spin text-success" />
              Reading what {customerName} holds…
            </p>
          ) : destinations.length === 0 ? (
            <p className="rounded-lg border-2 border-dashed border-border p-4 text-center text-xs text-muted">
              Nothing to send to. A loan or agreement has to be open to take a
              payment, and a susu or savings account has to be running.
            </p>
          ) : (
            <ul className="space-y-2">
              {destinations.map((entry) => {
                const Icon = ICONS[entry.kind];
                return (
                  <li key={entry.key}>
                    <button
                      type="button"
                      aria-pressed={to === entry.key}
                      onClick={() => setTo(entry.key)}
                      className={`flex w-full items-start gap-2.5 rounded-lg border-2 p-3 text-left transition-colors ${
                        to === entry.key
                          ? "border-success"
                          : "border-border hover:border-success/50"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-muted"
                      >
                        <Icon size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="truncate font-medium text-foreground">
                            {entry.title}
                          </span>
                          {entry.amount > 0 && (
                            <span className="shrink-0 tabular-nums text-foreground">
                              {formatGhs(entry.amount)}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {entry.detail}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <FieldError message={result?.fieldErrors?.to} />
        </fieldset>

        {source.partial ? (
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
                Up to {formatGhs(source.amount)} from this account.
                {source.kind === "savings" &&
                  ` A ${formatGhs(SAVINGS_FEE)} withdrawal fee comes out on top, and this counts as the day's one withdrawal.`}
              </p>
              {source.amount > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(toAmountInput(source.amount))}
                  className="shrink-0 text-xs font-medium text-success hover:underline"
                >
                  Send it all
                </button>
              )}
            </div>
            <FieldError message={result?.fieldErrors?.amount} />
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="rounded-lg bg-surface-secondary px-3 py-2 text-xs text-muted">
              A running cycle moves in one piece: sending it stops the account,
              keeps one day's commission, and sends the whole{" "}
              <span className="font-medium text-foreground">
                {formatGhs(source.amount)}
              </span>
              . No amount to choose.
            </p>
            <FieldError message={result?.fieldErrors?.amount} />
          </div>
        )}
      </sending.Form>
    </SideDrawer>
  );
}

/** One label/figure pair. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="shrink-0 text-sm tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
