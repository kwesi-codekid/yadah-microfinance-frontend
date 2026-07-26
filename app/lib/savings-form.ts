import { isPaymentChannel, type PaymentChannel } from "~/lib/channel";
import { readIdempotencyKey } from "~/lib/idempotency";
import { formatGhs, parseGhsAmount, validateGhsAmount } from "~/lib/money";
import { SAVINGS_MIN_DEPOSIT } from "~/lib/savings-client";

/**
 * Readers for the savings forms, collecting field errors.
 *
 * Isomorphic, the same way [susu-form.ts](app/lib/susu-form.ts) is: the function
 * the action runs is the function the browser runs to gate the submit, so there
 * is no second copy of the rules to drift out of step.
 *
 * Amounts come back as integer pesewas — the API takes nothing else.
 */

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

  // Blank is a real answer here, unlike every other amount field in the app:
  // `initialDeposit` is optional and an account may be opened with nothing in
  // it. Only a value that was actually typed gets validated.
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

  // The floor is the API's own (`minimum: 1000`). No ceiling: a savings balance
  // has nothing to fill up, so any limit invented here would eventually refuse
  // a deposit the API would have taken.
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
  /**
   * The account's `availableToWithdraw`, so a request the API would refuse with
   * 422 EXCEEDS_AVAILABLE can be caught before the round trip. Optional: the
   * action doesn't re-fetch the account just to repeat a check the API owns.
   */
  available?: number,
): {
  amount: number;
  idempotencyKey: string;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const raw = String(form.get("amount") ?? "");

  // A withdrawal has no minimum of its own — the API takes `minimum: 1`. What
  // bounds it is what's available, which already has the GHS 50 floor and the
  // GHS 10 fee taken out of it.
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
