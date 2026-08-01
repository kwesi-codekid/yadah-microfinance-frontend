import { isPaymentChannel, type PaymentChannel } from "~/lib/channel";
import { readIdempotencyKey } from "~/lib/idempotency";
import { formatGhs, parseGhsAmount, validateGhsAmount } from "~/lib/money";
import {
  isLoanDuration,
  type LoanConfig,
  type LoanDuration,
} from "~/lib/loan-client";

/**
 * Readers for the loan forms, collecting field errors.
 *
 * Isomorphic, the same way [susu-form.ts](app/lib/susu-form.ts) and
 * [savings-form.ts](app/lib/savings-form.ts) are: the function the action runs
 * is the function the browser runs to gate the submit, so there is no second
 * copy of the rules to drift out of step.
 *
 * Amounts come back as integer pesewas — the API takes nothing else.
 */

function readChannel(form: FormData): PaymentChannel {
  const raw = form.get("channel");
  return isPaymentChannel(raw) ? raw : "cash";
}

/* ------------------------------------------------------------------ *
 * Application
 * ------------------------------------------------------------------ */

export interface LoanApplicationGate {
  /**
   * `bigTierUnlocked` from the eligibility summary. When false, a principal
   * above the small tier's ceiling is refused with 422 `BIG_TIER_LOCKED` — so
   * the bound the form enforces is the *small* ceiling, not the big one.
   *
   * Undefined means "not known here": the check is skipped and the API answers
   * instead. Only the API's word is authoritative either way.
   */
  bigTierUnlocked?: boolean;
}

export function readLoanApplicationForm(
  form: FormData,
  config: LoanConfig,
  { bigTierUnlocked }: LoanApplicationGate = {},
): {
  principal: number;
  durationMonths: LoanDuration;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const raw = String(form.get("principal") ?? "");

  // The ceiling is whichever tier this customer can actually reach. Validating
  // against the big one for a customer without the big tier would let the form
  // submit a principal the API is certain to refuse — and `BIG_TIER_LOCKED`
  // names no field, so the message would land in a banner rather than on the
  // input that caused it.
  const ceiling =
    bigTierUnlocked === false ? config.smallMaxPesewas : config.bigMaxPesewas;

  const error = validateGhsAmount(raw, {
    label: "Loan amount",
    min: config.smallMinPesewas,
    max: ceiling,
  });
  if (error) fieldErrors.principal = error;

  const principal = parseGhsAmount(raw) ?? 0;

  // A second, more specific message for the one case the bounds above make
  // indistinguishable from "too much": the amount is within the product's range
  // but above what this customer has unlocked.
  if (
    !error &&
    bigTierUnlocked === false &&
    principal > config.smallMaxPesewas
  ) {
    fieldErrors.principal = `The big tier needs a previous small loan repaid on time. ${formatGhs(config.smallMaxPesewas)} is the most this customer can borrow.`;
  }

  const rawDuration = form.get("durationMonths");
  if (!isLoanDuration(rawDuration)) {
    fieldErrors.durationMonths = "Choose 3, 6 or 12 months.";
  }
  const durationMonths = (
    isLoanDuration(rawDuration) ? Number(rawDuration) : 3
  ) as LoanDuration;

  return { principal, durationMonths, fieldErrors };
}

/* ------------------------------------------------------------------ *
 * The decision
 * ------------------------------------------------------------------ */

export function readRejectionForm(form: FormData): {
  reason: string;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const reason = String(form.get("reason") ?? "").trim();

  // The API's own bounds (2–300). A rejection reason is read later by whoever
  // fields the customer's question about it, so an empty one is worse than
  // useless — but the floor is the API's two characters rather than a longer
  // one invented here.
  if (reason.length < 2) {
    fieldErrors.reason = "Say why this application is being rejected.";
  } else if (reason.length > 300) {
    fieldErrors.reason = "Keep the reason under 300 characters.";
  }

  return { reason, fieldErrors };
}

/* ------------------------------------------------------------------ *
 * Repayment
 * ------------------------------------------------------------------ */

export function readRepaymentForm(
  form: FormData,
  /**
   * The loan's `remaining`, so a payment the API would refuse with 422
   * `EXCEEDS_BALANCE` is caught before the round trip. Optional: the action
   * doesn't re-fetch the loan to repeat a check the API owns.
   */
  remaining?: number,
): {
  amount: number;
  channel: PaymentChannel;
  idempotencyKey: string;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const raw = String(form.get("amount") ?? "");

  // No minimum of its own — the API takes `minimum: 1`. What bounds a repayment
  // is what is still owed, and unlike a savings withdrawal there is no fee
  // between the two: the ceiling is exactly `remaining`.
  const error = validateGhsAmount(raw, { label: "Amount" });
  if (error) fieldErrors.amount = error;

  const amount = parseGhsAmount(raw) ?? 0;
  if (!error && remaining !== undefined && amount > remaining) {
    fieldErrors.amount = `Only ${formatGhs(remaining)} is still owed. A loan can't be overpaid.`;
  }

  return {
    amount,
    channel: readChannel(form),
    idempotencyKey: readIdempotencyKey(form, fieldErrors),
    fieldErrors,
  };
}

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

/** Whole percents, 1–100, as the API declares them. */
function readPercent(
  form: FormData,
  name: string,
  label: string,
  fieldErrors: Record<string, string>,
): number {
  const raw = String(form.get(name) ?? "").trim();
  if (!raw) {
    fieldErrors[name] = `Enter the ${label.toLowerCase()}.`;
    return 0;
  }
  // Whole numbers only: the API's type is `integer`, so `12.5` would be
  // rejected as a validation error naming a field the user can't see.
  if (!/^\d+$/.test(raw)) {
    fieldErrors[name] = `${label} must be a whole percentage.`;
    return 0;
  }
  const value = Number(raw);
  if (value < 1 || value > 100) {
    fieldErrors[name] = `${label} must be between 1 and 100.`;
  }
  return value;
}

function readPesewas(
  form: FormData,
  name: string,
  label: string,
  fieldErrors: Record<string, string>,
): number {
  const raw = String(form.get(name) ?? "");
  const error = validateGhsAmount(raw, { label });
  if (error) fieldErrors[name] = error;
  return parseGhsAmount(raw) ?? 0;
}

/**
 * The whole config, read back off the form.
 *
 * `PUT /loans/config` replaces the object rather than patching it — every field
 * is required — so this reads all six even when one was changed, and the form
 * has to render all six prefilled for that to be safe.
 */
export function readLoanConfigForm(form: FormData): {
  config: LoanConfig;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};

  const config: LoanConfig = {
    ratePercent3: readPercent(form, "ratePercent3", "3-month rate", fieldErrors),
    ratePercent6: readPercent(form, "ratePercent6", "6-month rate", fieldErrors),
    ratePercent12: readPercent(
      form,
      "ratePercent12",
      "12-month rate",
      fieldErrors,
    ),
    smallMinPesewas: readPesewas(
      form,
      "smallMinPesewas",
      "Smallest loan",
      fieldErrors,
    ),
    smallMaxPesewas: readPesewas(
      form,
      "smallMaxPesewas",
      "Small tier ceiling",
      fieldErrors,
    ),
    bigMaxPesewas: readPesewas(
      form,
      "bigMaxPesewas",
      "Big tier ceiling",
      fieldErrors,
    ),
  };

  // Ordering the API does not check but the product cannot survive: a small
  // ceiling under the minimum leaves the small tier empty, and a big ceiling
  // under the small one leaves the big tier unreachable. Both would be accepted
  // and would then refuse every application with `PRINCIPAL_OUT_OF_RANGE`.
  if (
    !fieldErrors.smallMinPesewas &&
    !fieldErrors.smallMaxPesewas &&
    config.smallMaxPesewas <= config.smallMinPesewas
  ) {
    fieldErrors.smallMaxPesewas =
      "The small tier's ceiling has to be above its minimum.";
  }
  if (
    !fieldErrors.smallMaxPesewas &&
    !fieldErrors.bigMaxPesewas &&
    config.bigMaxPesewas <= config.smallMaxPesewas
  ) {
    fieldErrors.bigMaxPesewas =
      "The big tier's ceiling has to be above the small tier's.";
  }

  return { config, fieldErrors };
}
