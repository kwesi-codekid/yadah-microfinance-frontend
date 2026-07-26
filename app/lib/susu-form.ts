import { parseGhsAmount, validateGhsAmount } from "~/lib/money";
import { isDepositChannel, type DepositChannel } from "~/lib/susu-client";

/**
 * Readers for the susu forms, collecting field errors.
 *
 * Isomorphic, the same way [customer-form.ts](app/lib/customer-form.ts) is: the
 * function the action runs is the function the browser runs to gate the submit,
 * so there is no second copy of the rules to drift out of step.
 *
 * Amounts come back as integer pesewas — the API takes nothing else.
 */

/** The 31-day ceiling on a single catch-up, from the API's request schema. */
const MAX_DAYS_COVERED = 31;

export function readOpenAccountForm(form: FormData): {
  dailyAmount: number;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  const raw = String(form.get("dailyAmount") ?? "");

  // No upper bound is invented here: the API sets none, and a ceiling picked by
  // this app would eventually refuse a legitimate account. The protection
  // against a fat-fingered `50000` for `500.00` is the confirmation step, which
  // states the amount, the 31-day total, and that neither can be changed
  // afterwards without closing the account.
  const error = validateGhsAmount(raw, { label: "Daily amount" });
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
    // The API answers 422 EXCEEDS_REMAINING for this. Same rule, same number,
    // caught before the round trip.
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

  // Deliberately *not* checked against the expected total here. The field is
  // prefilled with it and the breakdown is on screen, but the accounts can
  // change between the page rendering and the button being pressed — a new
  // account opened at the counter, one closed. Refusing on a stale total would
  // block a collection the API would have accepted, and quote a figure that is
  // no longer right. The API owns the comparison and its 422 carries the
  // authoritative total; `readAmountMismatch` unpacks it.

  const rawChannel = form.get("channel");
  const channel: DepositChannel = isDepositChannel(rawChannel)
    ? rawChannel
    : "cash";

  const idempotencyKey = readIdempotencyKey(form, fieldErrors);

  return { amount: parseGhsAmount(raw) ?? 0, channel, idempotencyKey, fieldErrors };
}

/**
 * The key comes from a hidden field the loader filled in, so a missing or
 * malformed one is a bug in this app, not something the user typed. It is still
 * checked rather than passed through: without it the API would reject the
 * request anyway, and the whole double-charge protection would be off.
 */
function readIdempotencyKey(
  form: FormData,
  fieldErrors: Record<string, string>,
): string {
  const key = String(form.get("idempotencyKey") ?? "").trim();
  if (key.length < 8 || key.length > 128) {
    fieldErrors.idempotencyKey =
      "This form went stale. Reload the page and try again.";
  }
  return key;
}
