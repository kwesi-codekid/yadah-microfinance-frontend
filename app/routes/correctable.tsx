import { ApiError } from "~/api/error";
import { listCorrections } from "~/api/corrections";
import { getAgreement } from "~/api/hire-purchase";
import { getLoan } from "~/api/loans";
import { getAccount as getSavingsAccount, listTxns } from "~/api/savings";
import { getAccount as getSusuAccount, listDeposits } from "~/api/susu";
import { toPending, type PendingCorrection } from "~/components/txn-correction";
import {
  CORRECTION_KINDS,
  type CorrectionContext,
  type CorrectionKind,
} from "~/lib/corrections";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/correctable";

/**
 * `GET /corrections/check/:kind/:targetId/:txnId` — a JSON resource route
 * behind the session, so a screen that shows a transaction without its
 * record can still offer to correct it.
 *
 * The ledger is that screen. Its rows know the record and the transaction
 * but not what the correction rules need — the daily amount, what the
 * account held before, what was still owed, whether this is the newest entry,
 * whether a request is already waiting — so those are read here, on demand,
 * when somebody picks the item. Each record page computes the same things for
 * itself from what it has already loaded.
 */

export interface Correctable {
  /** What the amount is checked against, or null when the entry cannot be read. */
  context: CorrectionContext | null;
  txn: {
    id: string;
    amount: number;
    /** Why this entry can never be corrected, or null. */
    locked: string | null;
    pending: PendingCorrection | null;
  } | null;
  /** Why the record no longer takes corrections, or null while it does. */
  closed: string | null;
  /** Whether this is the newest entry on its record — the only one a correction may touch. */
  newest: boolean;
  error: string | null;
}

/** A cycle or a page of history fits in one read at this size. */
const ONE_PAGE = 100;

const PAYSTACK = "This was paid through Paystack, so the amount is what was charged.";
const TRANSFER =
  "This came from a transfer between accounts. Correct it on the transfer, not here.";

function nothing(error: string): Correctable {
  return { context: null, txn: null, closed: null, newest: false, error };
}

export async function loader({
  request,
  params,
}: Route.LoaderArgs): Promise<Correctable> {
  const user = await requireCounter(request);
  const kind = params.kind as CorrectionKind;
  if (!CORRECTION_KINDS.includes(kind)) return nothing("Not a kind of entry that can be corrected.");
  const { targetId, txnId } = params;

  try {
    const { data } = await withAuth(request, async (token) => {
      const waiting = listCorrections(token, {
        targetId,
        status: "pending",
        limit: ONE_PAGE,
      }).then((r) => r.items.find((c) => c.txnId === txnId) ?? null);

      switch (kind) {
        case "susu-deposit": {
          const [{ account }, deposits, pending] = await Promise.all([
            getSusuAccount(token, targetId),
            listDeposits(token, targetId, { limit: ONE_PAGE }),
            waiting,
          ]);
          const found = deposits.items.find((d) => d.id === txnId);
          if (!found) return nothing("This deposit is no longer on the account.");
          const open = account.status === "active" || account.status === "completed";
          return {
            context: {
              kind,
              dailyAmount: account.dailyAmount,
              depositsCount: account.depositsCount - found.daysCovered,
              cycleTarget: account.cycleTarget,
              daysCovered: found.daysCovered,
            },
            txn: {
              id: found.id,
              amount: found.amount,
              locked:
                found.channel === "transfer"
                  ? TRANSFER
                  : found.channel === "paystack"
                    ? PAYSTACK
                    : null,
              pending: pending ? toPending(pending, user.id) : null,
            },
            closed: open ? null : "This account is closed, so its deposits are final.",
            newest: deposits.items[0]?.id === txnId,
            error: null,
          } satisfies Correctable;
        }
        case "savings-txn": {
          const [{ account }, txns, pending] = await Promise.all([
            getSavingsAccount(token, targetId),
            listTxns(token, targetId, { limit: ONE_PAGE }),
            waiting,
          ]);
          const found = txns.items.find((t) => t.id === txnId);
          if (!found) return nothing("This transaction is no longer on the account.");
          const fee = found.fee ?? 0;
          const balanceBefore =
            found.type === "deposit"
              ? found.balanceAfter - found.amount
              : found.balanceAfter + found.amount + fee;
          return {
            context:
              found.type === "closure"
                ? null
                : { kind, txnType: found.type, balanceBefore },
            txn: {
              id: found.id,
              amount: found.amount,
              locked:
                found.type === "closure"
                  ? "A closure is final. It cannot be changed from here."
                  : found.channel === "transfer"
                    ? TRANSFER
                    : found.channel === "paystack"
                      ? PAYSTACK
                      : null,
              pending: pending ? toPending(pending, user.id) : null,
            },
            closed:
              account.status === "active"
                ? null
                : "This account is closed, so its transactions are final.",
            newest: txns.items[0]?.id === txnId,
            error: null,
          } satisfies Correctable;
        }
        case "loan-repayment": {
          const [{ loan, repayments }, pending] = await Promise.all([
            getLoan(token, targetId),
            waiting,
          ]);
          const found = repayments.find((r) => r.id === txnId);
          if (!found) return nothing("This repayment is no longer on the loan.");
          const open =
            loan.status === "active" || loan.status === "arrears" || loan.status === "repaid";
          return {
            context: { kind, remainingBefore: loan.remaining + found.amount },
            txn: {
              id: found.id,
              amount: found.amount,
              locked:
                found.source === "susu-closure"
                  ? "This was paid by closing a susu account. It cannot be changed on its own."
                  : found.source === "transfer"
                    ? TRANSFER
                    : found.channel === "paystack"
                      ? PAYSTACK
                      : null,
              pending: pending ? toPending(pending, user.id) : null,
            },
            closed: open ? null : `This loan is ${loan.status}, so nothing on it can change.`,
            newest: repayments[0]?.id === txnId,
            error: null,
          } satisfies Correctable;
        }
        case "hp-payment": {
          const [{ agreement, payments }, pending] = await Promise.all([
            getAgreement(token, targetId),
            waiting,
          ]);
          const found = (payments ?? []).find((p) => p.id === txnId);
          if (!found) return nothing("This payment is no longer on the agreement.");
          const open =
            agreement.status === "active" ||
            agreement.status === "in-arrears" ||
            agreement.status === "closed-completed";
          return {
            context: { kind, remainingBefore: agreement.remaining + found.amount },
            txn: {
              id: found.id,
              amount: found.amount,
              locked:
                found.type === "deposit"
                  ? "The deposit is fixed by the agreement — exactly half the agreed price."
                  : found.type === "redemption"
                    ? "A redemption is the whole remaining balance. It cannot be changed."
                    : found.channel === "transfer"
                      ? TRANSFER
                      : found.channel === "paystack"
                        ? PAYSTACK
                        : null,
              pending: pending ? toPending(pending, user.id) : null,
            },
            closed: open
              ? null
              : `This agreement is ${agreement.status}, so nothing on it can change.`,
            newest: (payments ?? [])[0]?.id === txnId,
            error: null,
          } satisfies Correctable;
        }
      }
    });
    return data;
  } catch (error) {
    if (error instanceof ApiError) return nothing(error.message);
    throw error;
  }
}
