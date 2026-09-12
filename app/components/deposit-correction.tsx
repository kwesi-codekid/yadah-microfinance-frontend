import { SendIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { useFetcher } from "react-router";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { formatAmount, parseCedis, toCedisInput } from "~/lib/format";
import {
  checkCorrectionReason,
  checkDepositAmount,
  type SusuAccount,
} from "~/lib/susu";
import { cn } from "~/lib/utils";

/**
 * Correcting a susu deposit, from wherever one is on screen.
 *
 * Two pages offer it — the account's own page and the business-wide ledger —
 * and the office's door and the counter's door differ only in what is posted:
 * the office corrects outright, anyone else asks and gives a reason. So there
 * is one set of dialogs, and each page's action answers what they post. The
 * intents and fields posted from here are the contract both actions honour:
 *
 *   correct-deposit     accountId, depositId, amount
 *   propose-correction  accountId, depositId, amount, reason
 *   approve-correction  correctionId
 *   reject-correction   correctionId, reason
 *   cancel-correction   correctionId
 */

/**
 * A correction somebody asked for on a deposit and the office has not yet
 * answered. The deposit's own figure is still what the ledger says.
 */
export interface PendingCorrection {
  id: string;
  amount: number;
  days: number;
  reason: string;
  requestedBy: string;
  /** Asked for by whoever is looking, so they may take it back. */
  mine: boolean;
}

/** What both pages' actions answer with. Closing the dialogs is the page's. */
export interface CorrectionOutcome {
  ok: boolean;
  message: string;
  /** `AMOUNT_MISMATCH` and friends carry figures worth showing. */
  details?: Record<string, unknown>;
}

type Fetcher = ReturnType<typeof useFetcher<CorrectionOutcome>>;

/** The deposit as the correction needs it. */
export interface CorrectableDeposit {
  id: string;
  amount: number;
  daysCovered: number;
  /** Created by an internal transfer. The API will not let these be edited. */
  transfer: boolean;
  pending: PendingCorrection | null;
}

/** Whether the account still takes corrections at all. */
export function isCorrectableAccount(
  account: Pick<SusuAccount, "status">,
): boolean {
  return account.status === "active" || account.status === "completed";
}

/**
 * Why this deposit cannot be corrected, or null when it can. Said the way the
 * branch would say it — the clerk needs to know what to do instead, not which
 * endpoint refused. The API refuses the same four things with a 422; this
 * only says so before the round trip.
 */
export function whyNotCorrectable(
  deposit: Pick<CorrectableDeposit, "id" | "transfer" | "pending">,
  newestId: string | null,
  open: boolean,
): string | null {
  if (deposit.pending) {
    return `A correction to GH₵ ${formatAmount(deposit.pending.amount)} is already waiting on this deposit.`;
  }
  if (deposit.transfer) {
    return "This came from a transfer between accounts. Correct it on the transfer, not here.";
  }
  if (!open) return "This account is closed, so its deposits are final.";
  if (deposit.id !== newestId) {
    return "Only the newest deposit can be corrected. Remove the ones after it first.";
  }
  return null;
}

/**
 * The amount, and — when the reader is asking rather than deciding — the
 * reason the office decides on. Posts and stays open; the page closes it
 * when its action answers well, the same way it closes every other dialog.
 */
export function CorrectDepositDialog({
  open,
  onOpenChange,
  account,
  deposit,
  asking,
  fetcher,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: SusuAccount;
  deposit: Pick<CorrectableDeposit, "id" | "amount" | "daysCovered">;
  /** The counter asking, as opposed to the office correcting outright. */
  asking: boolean;
  fetcher: Fetcher;
}) {
  const [amount, setAmount] = useState(toCedisInput(deposit.amount));
  const [why, setWhy] = useState("");

  // Fresh each time it opens: the deposit's own figure in the box, and no
  // reason left over from the last time.
  useEffect(() => {
    if (!open) return;
    setAmount(toCedisInput(deposit.amount));
    setWhy("");
  }, [open, deposit.amount]);

  const pesewas = parseCedis(amount);
  // The corrected amount has to sit on a day boundary too, and the cycle it is
  // re-derived into is the one *without* this deposit in it.
  const issue =
    pesewas == null
      ? "Enter an amount."
      : checkDepositAmount(
          {
            ...account,
            depositsCount: account.depositsCount - deposit.daysCovered,
          },
          pesewas,
        );
  const whyIssue = asking ? checkCorrectionReason(why) : null;
  const busy = fetcher.state !== "idle";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {asking
              ? "Ask the office to correct the deposit"
              : "Correct the deposit"}
          </DialogTitle>
          <DialogDescription>
            {asking
              ? "Nothing changes until the office approves. When it does, the days covered and the cycle count are worked out again from the new amount."
              : "A data-entry fix. The days covered and the cycle count are worked out again from the new amount."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label
            htmlFor="correct-amount"
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            Amount · GH₵
          </Label>
          <Input
            id="correct-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={issue ? true : undefined}
            className="tabular"
          />
          <p
            className={cn(
              "text-xs",
              issue ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {issue ??
              `${pesewas! / account.dailyAmount} day${pesewas! / account.dailyAmount === 1 ? "" : "s"} at GH₵ ${formatAmount(account.dailyAmount)}.`}
          </p>
        </div>

        {asking && (
          <div className="space-y-1.5">
            <Label
              htmlFor="correct-why"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Why
            </Label>
            <Textarea
              id="correct-why"
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Counted three notes, there were two…"
            />
            {whyIssue && why.length > 0 && (
              <p className="text-xs text-destructive">{whyIssue}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={Boolean(issue) || Boolean(whyIssue) || busy}
            onClick={() =>
              fetcher.submit(
                asking
                  ? {
                      intent: "propose-correction",
                      accountId: account.id,
                      depositId: deposit.id,
                      amount,
                      reason: why.trim(),
                    }
                  : {
                      intent: "correct-deposit",
                      accountId: account.id,
                      depositId: deposit.id,
                      amount,
                    },
                { method: "post" },
              )
            }
          >
            {asking ? (
              <>
                <SendIcon />
                Send for approval
              </>
            ) : (
              "Save correction"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Deciding what was asked. One dialog, three verdicts: the office applies or
 * declines, the asker takes back. Which one is the page's choice, made from
 * whichever menu offered it.
 */
export function DecideCorrectionDialog({
  deciding,
  onOpenChange,
  pending,
  currentAmount,
  fetcher,
}: {
  deciding: "approve" | "reject" | "cancel" | null;
  onOpenChange: (open: boolean) => void;
  pending: PendingCorrection;
  /** What the deposit says now — what it stays at if the answer is no. */
  currentAmount: number;
  fetcher: Fetcher;
}) {
  const [verdict, setVerdict] = useState("");

  useEffect(() => {
    if (deciding === "reject") setVerdict("");
  }, [deciding]);

  const busy = fetcher.state !== "idle";

  return (
    <AlertDialog open={deciding !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {deciding === "approve"
              ? "Apply this correction?"
              : deciding === "reject"
                ? "Decline this correction?"
                : "Take the request back?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {deciding === "approve" ? (
              <>
                The deposit becomes GH₵ {formatAmount(pending.amount)} —{" "}
                {pending.days} day{pending.days === 1 ? "" : "s"} — from GH₵{" "}
                {formatAmount(currentAmount)}. The cycle count moves with it,
                and {pending.requestedBy} is told.
              </>
            ) : deciding === "reject" ? (
              <>
                The deposit stays at GH₵ {formatAmount(currentAmount)}.{" "}
                {pending.requestedBy} reads the reason.
              </>
            ) : (
              <>
                Nothing changes. The deposit stays at GH₵{" "}
                {formatAmount(currentAmount)} and can be asked about again.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {deciding === "reject" && (
          <div className="space-y-1.5">
            <Label
              htmlFor="decline-why"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Why
            </Label>
            <Textarea
              id="decline-why"
              value={verdict}
              onChange={(e) => setVerdict(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="The customer confirmed three days…"
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              deciding === "reject" &&
                "bg-destructive text-white hover:bg-destructive/90",
            )}
            disabled={
              busy ||
              (deciding === "reject" && Boolean(checkCorrectionReason(verdict)))
            }
            onClick={() =>
              fetcher.submit(
                deciding === "approve"
                  ? { intent: "approve-correction", correctionId: pending.id }
                  : deciding === "reject"
                    ? {
                        intent: "reject-correction",
                        correctionId: pending.id,
                        reason: verdict.trim(),
                      }
                    : { intent: "cancel-correction", correctionId: pending.id },
                { method: "post" },
              )
            }
          >
            {deciding === "approve"
              ? "Apply"
              : deciding === "reject"
                ? "Decline"
                : "Take it back"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
