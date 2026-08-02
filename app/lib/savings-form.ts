import { isPaymentChannel, type PaymentChannel } from "~/lib/channel";
import { readIdempotencyKey } from "~/lib/idempotency";
import { formatGhs, parseGhsAmount, validateGhsAmount } from "~/lib/money";
import { SAVINGS_MIN_DEPOSIT } from "~/lib/savings-client";

function readChannel(form: FormData): PaymentChannel {
  const raw = form.get("channel");
  return isPaymentChannel(raw) ? raw : "cash";
}

export function readOpenSavingsForm(form: FormData): {
  /** Undefined when the field was left blank — the account opens empty. */
  initialDeposit?: number;
  channel: PaymentChannel;
  idempotencyKey: string;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const raw = String(form.get("initialDeposit") ?? "").trim();

  if (!raw) {
    return {
      initialDeposit: undefined,
      channel: readChannel(form),
      idempotencyKey: readIdempotencyKey(form, fieldErrors),
      fieldErrors,
    };
  }

  const error = validateGhsAmount(raw, {
    label: "Opening deposit",
    min: SAVINGS_MIN_DEPOSIT,
  });
  if (error) fieldErrors.initialDeposit = error;

  return {
    initialDeposit: parseGhsAmount(raw) ?? 0,
    channel: readChannel(form),
    idempotencyKey: readIdempotencyKey(form, fieldErrors),
    fieldErrors,
  };
}

export function readSavingsDepositForm(form: FormData): {
  amount: number;
  channel: PaymentChannel;
  idempotencyKey: string;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const raw = String(form.get("amount") ?? "");

  const error = validateGhsAmount(raw, {
    label: "Amount",
    min: SAVINGS_MIN_DEPOSIT,
  });
  if (error) fieldErrors.amount = error;

  return {
    amount: parseGhsAmount(raw) ?? 0,
    channel: readChannel(form),
    idempotencyKey: readIdempotencyKey(form, fieldErrors),
    fieldErrors,
  };
}

export function readWithdrawalForm(
  form: FormData,
  available?: number,
): {
  amount: number;
  idempotencyKey: string;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const raw = String(form.get("amount") ?? "");

  const error = validateGhsAmount(raw, { label: "Amount" });
  if (error) fieldErrors.amount = error;

  const amount = parseGhsAmount(raw) ?? 0;
  if (!error && available !== undefined && amount > available) {
    fieldErrors.amount =
      available === 0
        ? "Nothing can be withdrawn — the balance is at the minimum."
        : `Only ${formatGhs(available)} can be withdrawn.`;
  }

  return {
    amount,
    idempotencyKey: readIdempotencyKey(form, fieldErrors),
    fieldErrors,
  };
}
