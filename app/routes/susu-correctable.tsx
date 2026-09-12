import { ApiError } from "~/api/error";
import { getAccount, listCorrections, listDeposits } from "~/api/susu";
import type { CorrectableDeposit } from "~/components/deposit-correction";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { SusuAccount } from "~/lib/susu";
import type { Route } from "./+types/susu-correctable";

/**
 * `GET /susu/:id/deposits/:depositId/correctable` — a JSON resource route
 * behind the session, so a screen that shows a deposit without its account
 * can still offer to correct it.
 *
 * The ledger is that screen. Its rows know the account and the deposit but
 * not what the correction rules need — the daily amount, whether this is the
 * newest deposit, whether a request is already waiting — so those are read
 * here, on demand, when somebody picks the item. The account page computes
 * the same things for itself from what it has already loaded.
 */

export interface Correctable {
  account: SusuAccount | null;
  deposit: CorrectableDeposit | null;
  /** The newest deposit on the account — the only one a correction may touch. */
  newestId: string | null;
  error: string | null;
}

/** A cycle stops at 31 deposits, so the whole history fits in one read. */
const ALL_DEPOSITS = 100;

export async function loader({
  request,
  params,
}: Route.LoaderArgs): Promise<Correctable> {
  const user = await requireCounter(request);

  try {
    const { data: result } = await withAuth(request, async (token) => {
      const [{ account }, deposits, corrections] = await Promise.all([
        getAccount(token, params.id),
        listDeposits(token, params.id, { limit: ALL_DEPOSITS }),
        listCorrections(token, {
          accountId: params.id,
          status: "pending",
          limit: ALL_DEPOSITS,
        }),
      ]);
      return { account, deposits, corrections };
    });

    const found = result.deposits.items.find((d) => d.id === params.depositId);
    const waiting = result.corrections.items.find(
      (c) => c.depositId === params.depositId,
    );
    const deposit: CorrectableDeposit | null = found
      ? {
          id: found.id,
          amount: found.amount,
          daysCovered: found.daysCovered,
          transfer: found.channel === "transfer",
          pending: waiting
            ? {
                id: waiting.id,
                amount: waiting.amount,
                days: waiting.days,
                reason: waiting.reason,
                requestedBy: waiting.requestedByName ?? "A teller",
                mine: waiting.requestedById === user.id,
              }
            : null,
        }
      : null;

    return {
      account: result.account,
      deposit,
      newestId: result.deposits.items[0]?.id ?? null,
      // Trashed since the ledger was drawn, or never this account's.
      error: deposit ? null : "This deposit is no longer on the account.",
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return { account: null, deposit: null, newestId: null, error: error.message };
    }
    throw error;
  }
}
