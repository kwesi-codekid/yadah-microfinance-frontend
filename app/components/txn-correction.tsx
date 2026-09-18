import {
  CheckIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SendIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  KIND_NOUNS,
  checkCorrectedAmount,
  checkCorrectionReason,
  describeCorrectedAmount,
  type CorrectionContext,
} from "~/lib/corrections";
import { formatAmount, parseCedis, toCedisInput } from "~/lib/format";
import { cn } from "~/lib/utils";

/**
 * Correcting a transaction's amount, from wherever one is on screen.
 *
 * Five pages offer it — the four record pages and the business-wide ledger —
 * and the office's door and the counter's door differ only in what is posted:
 * the office corrects outright, anyone else asks and gives a reason. So there
 * is one set of dialogs, and each page's action answers what they post. The
 * intents and fields posted from here are the contract every action honours:
 *
 *   correct-txn         kind, targetId, txnId, amount
 *   propose-correction  kind, targetId, txnId, amount, reason
 *   approve-correction  correctionId
 *   reject-correction   correctionId, reason
 *   cancel-correction   correctionId
 */

/**
 * A correction somebody asked for on an entry and the office has not yet
 * answered. The entry's own figure is still what the ledger says.
 */
export interface PendingCorrection {
  id: string;
  amount: number;
  /** Susu only: the days the asked-for amount covers. */
  units?: number;
  reason: string;
  requestedBy: string;
  /** Asked for by whoever is looking, so they may take it back. */
  mine: boolean;
}

/** What every page's action answers with. Closing the dialogs is the page's. */
export interface CorrectionOutcome {
  ok: boolean;
  message: string;
  /** `EXCEEDS_AVAILABLE` and friends carry figures worth showing. */
  details?: Record<string, unknown>;
}

type Fetcher = ReturnType<typeof useFetcher<CorrectionOutcome>>;

/**
 * Why this entry cannot be corrected, or null when it can. Said the way the
 * branch would say it — the clerk needs to know what to do instead, not which
 * endpoint refused. The API refuses the same things with a 422; this only
 * says so before the round trip.
 */
export function whyNotCorrectable({
  pending,
  locked,
  closed,
  newest,
  noun,
}: {
  pending: PendingCorrection | null;
  /** Why this entry can never be corrected — a transfer leg, a Paystack charge. */
  locked: string | null;
  /** Why the record no longer takes corrections — it is closed. */
  closed: string | null;
  newest: boolean;
  noun: string;
}): string | null {
  if (pending) {
    return `A correction to GH₵ ${formatAmount(pending.amount)} is already waiting on this ${noun}.`;
  }
  if (locked) return locked;
  if (closed) return closed;
  if (!newest) {
    return `Only the newest ${noun} can be corrected.`;
  }
  return null;
}

/**
 * The amount, and — when the reader is asking rather than deciding — the
 * reason the office decides on. Posts and stays open; the page closes it
 * when its action answers well, the same way it closes every other dialog.
 */
export function CorrectTxnDialog({
  open,
  onOpenChange,
  context,
  targetId,
  txn,
  asking,
  fetcher,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the amount is checked against; carries the kind. */
  context: CorrectionContext;
  targetId: string;
  txn: { id: string; amount: number };
  /** The counter asking, as opposed to the office correcting outright. */
  asking: boolean;
  fetcher: Fetcher;
}) {
  const [amount, setAmount] = useState(toCedisInput(txn.amount));
  const [why, setWhy] = useState("");
  const noun = KIND_NOUNS[context.kind];

  // Fresh each time it opens: the entry's own figure in the box, and no
  // reason left over from the last time.
  useEffect(() => {
    if (!open) return;
    setAmount(toCedisInput(txn.amount));
    setWhy("");
  }, [open, txn.amount]);

  const pesewas = parseCedis(amount);
  const issue = checkCorrectedAmount(context, pesewas);
  const whyIssue = asking ? checkCorrectionReason(why) : null;
  const busy = fetcher.state !== "idle";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {asking
              ? `Ask the office to correct the ${noun}`
              : `Correct the ${noun}`}
          </DialogTitle>
          <DialogDescription>
            {asking
              ? "Nothing changes until the office approves. When it does, everything built on this figure is worked out again from the new amount."
              : "A data-entry fix. Everything built on this figure is worked out again from the new amount."}
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
              (pesewas != null ? describeCorrectedAmount(context, pesewas) : "")}
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
                      kind: context.kind,
                      targetId,
                      txnId: txn.id,
                      amount,
                      reason: why.trim(),
                    }
                  : {
                      intent: "correct-txn",
                      kind: context.kind,
                      targetId,
                      txnId: txn.id,
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
  /** What the entry says now — what it stays at if the answer is no. */
  currentAmount: number;
  fetcher: Fetcher;
}) {
  const [verdict, setVerdict] = useState("");

  useEffect(() => {
    if (deciding === "reject") setVerdict("");
  }, [deciding]);

  const busy = fetcher.state !== "idle";
  const days =
    pending.units !== undefined
      ? ` — ${pending.units} day${pending.units === 1 ? "" : "s"} —`
      : ""

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
                The figure becomes GH₵ {formatAmount(pending.amount)}
                {days} from GH₵ {formatAmount(currentAmount)}. Everything built
                on it moves with it, and {pending.requestedBy} is told.
              </>
            ) : deciding === "reject" ? (
              <>
                The figure stays at GH₵ {formatAmount(currentAmount)}.{" "}
                {pending.requestedBy} reads the reason.
              </>
            ) : (
              <>
                Nothing changes. The figure stays at GH₵{" "}
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

/** A pending request as the pages hand it to the dialogs. */
export function toPending(
  c: {
    id: string;
    amount: number;
    units?: number;
    reason: string;
    requestedById: string;
    requestedByName?: string;
  },
  viewerId: string,
): PendingCorrection {
  return {
    id: c.id,
    amount: c.amount,
    ...(c.units !== undefined ? { units: c.units } : {}),
    reason: c.reason,
    requestedBy: c.requestedByName ?? "A teller",
    mine: c.requestedById === viewerId,
  };
}

/**
 * The ⋯ menu on one transaction row, on every record page.
 *
 * Every row carries the menu, including the ones that cannot be changed — an
 * actions column that is blank on all but one row reads as broken. The state
 * decides whether the items are usable, not whether the trigger exists. The
 * office corrects outright and decides what a teller asked; anyone else at the
 * counter asks. A waiting request explains itself in the menu, so the office
 * decides from here without opening anything.
 *
 * `before` and `after` are the page's own items — a receipt above, the trash
 * below — so each page keeps what is particular to it while the correction
 * reads the same everywhere.
 */
export function TxnRowMenu({
  txn,
  context,
  targetId,
  pending,
  blocked,
  canDecide,
  fetcher,
  before,
  after,
  srLabel,
}: {
  txn: { id: string; amount: number };
  /** What the amount is checked against; null when the entry can never change. */
  context: CorrectionContext | null;
  targetId: string;
  pending: PendingCorrection | null;
  /** Why the correction is unavailable, or null when it is not. */
  blocked: string | null;
  /** The office. Everyone else here is the counter asking. */
  canDecide: boolean;
  fetcher: Fetcher;
  before?: ReactNode;
  after?: ReactNode;
  srLabel: string;
}) {
  const editable = blocked === null && context !== null;
  const [correcting, setCorrecting] = useState(false);
  const [deciding, setDeciding] = useState<
    "approve" | "reject" | "cancel" | null
  >(null);
  const asking = !canDecide;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setCorrecting(false);
      setDeciding(null);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
          >
            <MoreHorizontalIcon />
            <span className="sr-only">{srLabel}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {before}
          {/* A waiting request explains itself below; anything else that
              blocks a correction is said here. */}
          {blocked && !pending && (
            <>
              <DropdownMenuLabel className="max-w-64 font-normal text-wrap text-muted-foreground">
                {blocked}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}
          {pending && (
            <>
              <DropdownMenuLabel className="max-w-64 font-normal text-wrap">
                <span className="block">
                  {pending.requestedBy} asks for GH₵{" "}
                  {formatAmount(pending.amount)}
                  {pending.units !== undefined &&
                    ` — ${pending.units} day${pending.units === 1 ? "" : "s"}`}
                  .
                </span>
                <span className="block text-muted-foreground">
                  {pending.reason}
                </span>
              </DropdownMenuLabel>
              {canDecide && (
                <>
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setDeciding("approve");
                    }}
                  >
                    <CheckIcon />
                    Apply the correction
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={(e) => {
                      e.preventDefault();
                      setDeciding("reject");
                    }}
                  >
                    <XIcon />
                    Decline the correction
                  </DropdownMenuItem>
                </>
              )}
              {/* The asker's to take back, or the office's to tidy away.
                  Another teller's request is not theirs to touch. */}
              {(pending.mine || canDecide) && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setDeciding("cancel");
                  }}
                >
                  <Undo2Icon />
                  Take the request back
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            disabled={!editable}
            onSelect={(e) => {
              e.preventDefault();
              setCorrecting(true);
            }}
          >
            <PencilIcon />
            {asking ? "Ask to correct the amount" : "Correct the amount"}
          </DropdownMenuItem>
          {after}
        </DropdownMenuContent>
      </DropdownMenu>

      {context && (
        <CorrectTxnDialog
          open={correcting}
          onOpenChange={setCorrecting}
          context={context}
          targetId={targetId}
          txn={txn}
          asking={asking}
          fetcher={fetcher}
        />
      )}

      {pending && (
        <DecideCorrectionDialog
          deciding={deciding}
          onOpenChange={(o) => !o && setDeciding(null)}
          pending={pending}
          currentAmount={txn.amount}
          fetcher={fetcher}
        />
      )}
    </>
  );
}
