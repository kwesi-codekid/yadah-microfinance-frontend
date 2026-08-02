import { isPaymentChannel, type PaymentChannel } from "~/lib/channel";
import { readIdempotencyKey } from "~/lib/idempotency";
import { formatGhs, parseGhsAmount, validateGhsAmount } from "~/lib/money";
import {
  isLoanDuration,
  type LoanConfig,
  type LoanDuration,
} from "~/lib/loan-client";

function readChannel(form: FormData): PaymentChannel {
  const raw = form.get("channel");
  return isPaymentChannel(raw) ? raw : "cash";
}

export interface LoanApplicationGate {
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

  const ceiling =
    bigTierUnlocked === false ? config.smallMaxPesewas : config.bigMaxPesewas;

  const error = validateGhsAmount(raw, {
    label: "Loan amount",
    min: config.smallMinPesewas,
    max: ceiling,
  });
  if (error) fieldErrors.principal = error;

  const principal = parseGhsAmount(raw) ?? 0;

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

export function readRejectionForm(form: FormData): {
  reason: string;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const reason = String(form.get("reason") ?? "").trim();

  if (reason.length < 2) {
    fieldErrors.reason = "Say why this application is being rejected.";
  } else if (reason.length > 300) {
    fieldErrors.reason = "Keep the reason under 300 characters.";
  }

  return { reason, fieldErrors };
}

export function readRepaymentForm(
  form: FormData,
  remaining?: number,
): {
  amount: number;
  channel: PaymentChannel;
  idempotencyKey: string;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const raw = String(form.get("amount") ?? "");

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
