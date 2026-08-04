import type { ApiFailure } from "~/lib/api/client";
import * as hpApi from "~/lib/api/hire-purchase";
import * as loansApi from "~/lib/api/loans";
import * as savingsApi from "~/lib/api/savings";
import * as susuApi from "~/lib/api/susu";
import * as transfersApi from "~/lib/api/transfers";
import { isOpenAgreement } from "~/lib/hp-client";
import { isOpenLoan } from "~/lib/loan-client";
import { formatGhs, parseGhsAmount } from "~/lib/money";
import {
  readTransferTarget,
  TRANSFER_ERRORS,
  type TransferEndpoint,
  type TransferSource,
} from "~/lib/transfer-client";

export type TransferActionData = {
  ok?: boolean;
  intent?: string;
  message?: string;
  formError?: string;
  fieldErrors?: Record<string, string>;
};

/**
 * Everything a customer holds that a transfer can land on. `exclude` drops the
 * source account, which would otherwise offer to send money to itself.
 */
export async function loadTransferDestinations(
  token: string,
  customerId: string,
  exclude?: string,
): Promise<TransferEndpoint[]> {
  const [susu, savings, loans, agreements] = await Promise.all([
    susuApi.listSusuAccounts(token, { customerId, limit: 100 }),
    savingsApi.listSavingsAccounts(token, {
      customerId,
      status: "active",
      limit: 100,
    }),
    loansApi.listLoans(token, { customerId, limit: 100 }),
    hpApi.listHpAgreements(token, { customerId, limit: 100 }),
  ]);

  const targets: TransferEndpoint[] = [];

  for (const account of susu.items) {
    // A closed cycle takes nothing, and one awaiting payout is on its way out.
    if (account.status === "closed" || account.status === "pending-payout")
      continue;
    targets.push({
      key: `susu:${account.id}`,
      kind: "susu",
      title: `Susu ${account.accountNumber}`,
      detail: `${account.depositsCount}/${account.cycleTarget} paid`,
      amount: 0,
    });
  }

  for (const account of savings.items) {
    targets.push({
      key: `savings:${account.id}`,
      kind: "savings",
      title: `Savings ${account.accountNumber}`,
      detail: `${formatGhs(account.balance)} balance · no deposit minimum`,
      amount: 0,
    });
  }

  for (const loan of loans.items) {
    if (!isOpenLoan(loan.status)) continue;
    targets.push({
      key: `loan:${loan.id}`,
      kind: "loan",
      title: `Loan ${formatGhs(loan.principal)}`,
      detail: `${formatGhs(loan.remaining)} still owed`,
      amount: loan.remaining,
    });
  }

  for (const agreement of agreements.items) {
    if (!isOpenAgreement(agreement.status)) continue;
    targets.push({
      key: `hire-purchase:${agreement.id}`,
      kind: "hire-purchase",
      title: agreement.item.name,
      detail: `${formatGhs(agreement.remaining)} still owed`,
      amount: agreement.remaining,
    });
  }

  return exclude ? targets.filter((target) => target.key !== exclude) : targets;
}

/**
 * Sends money out of the account the drawer is standing on. Throws `ApiError`
 * on rejection so `withAuth` can still renew an expired token; the route's
 * catch passes the failure to `readTransferFailure`.
 */
export async function runTransferIntent({
  token,
  from,
  form,
}: {
  token: string;
  from: TransferSource;
  form: FormData;
}): Promise<TransferActionData> {
  const intent = "transfer";
  const to = readTransferTarget(String(form.get("to") ?? ""));
  const amountRaw = String(form.get("amount") ?? "").trim();
  // Blank is meaningful: it sends everything, which is how a whole cycle moves.
  const amount = amountRaw ? parseGhsAmount(amountRaw) : undefined;
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");

  const fieldErrors: Record<string, string> = {};
  if (!to) fieldErrors.to = "Choose where it goes.";
  if (amountRaw && (amount === null || amount === undefined || amount <= 0))
    fieldErrors.amount = "That isn't an amount.";
  if (idempotencyKey.length < 8)
    fieldErrors.to = "Reload the page and try again.";
  if (Object.keys(fieldErrors).length) return { intent, fieldErrors };

  const { transfer, replayed } = await transfersApi.createTransfer(token, {
    from,
    to: to!,
    amount: amount ?? undefined,
    idempotencyKey,
  });

  const fee = transfer.fee > 0 ? ` after a ${formatGhs(transfer.fee)} fee` : "";
  const pending =
    transfer.excessPending > 0
      ? ` ${formatGhs(transfer.excessPending)} was more than it could take and stays in the susu account.`
      : "";

  return {
    ok: true,
    intent,
    message: replayed
      ? "Already done — this is the same transfer, not a second one."
      : `${formatGhs(transfer.amountCredited)} moved${fee}.${pending}`,
  };
}

/** The transfer errors worth rewording, sorted into the field they belong to. */
export function readTransferFailure(
  failure: ApiFailure,
): TransferActionData | null {
  const known = TRANSFER_ERRORS[failure.code];
  if (!known) return null;

  const onAmount =
    failure.code === "EXCEEDS_AVAILABLE" ||
    failure.code === "EXCEEDS_PAYOUT" ||
    failure.code === "EXCEEDS_REMAINING" ||
    failure.code === "AMOUNT_MISMATCH";

  return onAmount
    ? { intent: "transfer", fieldErrors: { amount: known } }
    : { intent: "transfer", formError: known };
}
