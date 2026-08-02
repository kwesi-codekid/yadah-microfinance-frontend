import { readIdempotencyKey } from "~/lib/idempotency";
import { parseGhsAmount, validateGhsAmount } from "~/lib/money";
import {
  isDepositChannel,
  SUSU_MIN_DAILY_AMOUNT,
  type DepositChannel,
} from "~/lib/susu-client";

/** The 31-day ceiling on a single catch-up, from the API's request schema. */
const MAX_DAYS_COVERED = 31;

export function readOpenAccountForm(form: FormData): {
  dailyAmount: number;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const raw = String(form.get("dailyAmount") ?? "");

  const error = validateGhsAmount(raw, {
    label: "Daily amount",
    min: SUSU_MIN_DAILY_AMOUNT,
  });
  if (error) fieldErrors.dailyAmount = error;

  return { dailyAmount: parseGhsAmount(raw) ?? 0, fieldErrors };
}

export function readDepositForm(
  form: FormData,
  /** Days left on the cycle, so a catch-up can't be sent that the API will refuse. */
  remaining?: number,
): {
  daysCovered: number;
  channel: DepositChannel;
  idempotencyKey: string;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};

  const raw = String(form.get("daysCovered") ?? "1").trim();
  const daysCovered = Number(raw);
  // `Number("")` is 0 and `Number("1.5")` is 1.5 — neither is a day count.
  if (!Number.isInteger(daysCovered) || daysCovered < 1) {
    fieldErrors.daysCovered = "Days covered must be a whole number, at least 1.";
  } else if (daysCovered > MAX_DAYS_COVERED) {
    fieldErrors.daysCovered = `A deposit can cover at most ${MAX_DAYS_COVERED} days.`;
  } else if (remaining !== undefined && daysCovered > remaining) {
    fieldErrors.daysCovered =
      remaining === 0
        ? "This cycle is already complete."
        : `Only ${remaining} ${remaining === 1 ? "day is" : "days are"} left on this cycle.`;
  }

  const rawChannel = form.get("channel");
  const channel: DepositChannel = isDepositChannel(rawChannel)
    ? rawChannel
    : "cash";

  const idempotencyKey = readIdempotencyKey(form, fieldErrors);

  return { daysCovered, channel, idempotencyKey, fieldErrors };
}

export function readCollectAllForm(form: FormData): {
  amount: number;
  channel: DepositChannel;
  idempotencyKey: string;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const raw = String(form.get("amount") ?? "");

  const error = validateGhsAmount(raw, { label: "Amount collected" });
  if (error) fieldErrors.amount = error;

  const rawChannel = form.get("channel");
  const channel: DepositChannel = isDepositChannel(rawChannel)
    ? rawChannel
    : "cash";

  const idempotencyKey = readIdempotencyKey(form, fieldErrors);

  return { amount: parseGhsAmount(raw) ?? 0, channel, idempotencyKey, fieldErrors };
}

