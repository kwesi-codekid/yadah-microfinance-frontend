import { useState } from "react";
import { Link } from "react-router";
import { Skeleton } from "@heroui/react";
import { ArrowUpRight, Eye, EyeOff } from "lucide-react";
import { formatDate } from "~/lib/format";
import { CEDI, formatGhs } from "~/lib/money";
import {
  lockedBalance,
  type SavingsAccount,
  type SavingsAccountStatus,
} from "~/lib/savings-client";
import type { SusuAccount, SusuAccountStatus } from "~/lib/susu-client";

/**
 * One susu account, drawn as a card.
 *
 * Shaped like the bank card in a customer's wallet — ID-1 proportions, mark
 * top-left, hero figure across the middle — because that is the object people
 * already know how to read. What's *on* it is susu, not plastic: the hero row
 * is the daily amount (the one number that never changes and the one a
 * customer quotes), where a debit card would print a PAN nobody recites.
 *
 * The strip along the bottom edge is the point of the whole thing. A susu card
 * is a paper card with 31 boxes the collector marks off day by day; this is
 * that card at a tenth the size. It reads at arm's length — you can see a
 * half-paid cycle from across a desk without reading a figure.
 *
 * Colour carries status, never alone: the face is one of three hues from the
 * logo ring, and the status is also stated in words at the foot.
 */

const FACE: Record<SusuAccountStatus, string> = {
  // Teal — money still moving.
  active: "bg-teal-dark",
  // The brand orange, darkened: the cycle is full and the payout is due.
  completed: "bg-brand-dark",
  // Navy — settled and filed.
  closed: "bg-navy-dark",
};

/**
 * The faceted sheen off the reference card, in gradients rather than an image:
 * two soft highlights and two thin diagonal facets, all white at low alpha so
 * one rule works over any of the three faces. Kept under 20% — the text sits on
 * the base colour, and contrast is the base colour's job alone.
 */
const SHEEN = {
  backgroundImage: [
    "radial-gradient(120% 120% at 82% 8%, rgba(255,255,255,0.20), transparent 55%)",
    "radial-gradient(100% 100% at 8% 92%, rgba(255,255,255,0.10), transparent 60%)",
    "linear-gradient(112deg, transparent 38%, rgba(255,255,255,0.09) 41%, transparent 47%)",
    "linear-gradient(112deg, transparent 58%, rgba(255,255,255,0.06) 61%, transparent 68%)",
  ].join(","),
};

const LABEL = "text-[10px] font-heading font-bold uppercase tracking-[0.14em]";

export function AccountCard({ account }: { account: SusuAccount }) {
  // Balances start hidden — these cards are read at a counter with whoever is
  // next in the queue standing behind. Per card rather than per page: one
  // switch that bares every figure on screen is the one you forget to put back.
  const [showBalance, setShowBalance] = useState(false);
  /**
   * The account's own number, six digits, printed in full.
   *
   * This used to be the last four of the `id`, masked like a card number
   * because a 24-char hex string is not something anyone can read down a
   * phone. The API now issues a real `accountNumber`, so there is nothing left
   * to invent or hide — a customer quoting it is the only way to look an
   * account up (`GET /susu/accounts?accountNumber=`), which makes showing it
   * whole the point rather than a leak.
   */
  const ref = account.accountNumber;

  // Bottom-right: whatever the account's own state makes worth knowing. An
  // active cycle is counting days; a closed one has already paid out.
  const closing =
    account.status === "closed"
      ? {
          label: "Paid out",
          // Money, so it answers to the same toggle as the balance — hiding
          // one and printing the other would make the toggle a decoration.
          value: !showBalance
            ? `${CEDI}••••`
            : account.payoutAmount != null
              ? formatGhs(account.payoutAmount)
              : "—",
        }
      : account.status === "completed"
        ? { label: "Cycle full", value: `${account.cycleTarget} days` }
        : {
            label: "Day",
            value: `${account.depositsCount} / ${account.cycleTarget}`,
          };

  return (
    /* An `article` with the link stretched across it, rather than a card that
       *is* a link: the balance toggle is a button, and a button inside an
       anchor is neither valid nor operable. The overlay takes the whole face,
       so the card still behaves like one big target — the toggle simply sits
       above it. */
    <article
      className={[
        "group relative flex aspect-[1.586] flex-col justify-between overflow-hidden rounded-lg p-4 text-white shadow-sm",
        "transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        FACE[account.status],
      ].join(" ")}
    >
      <div aria-hidden="true" className="absolute inset-0" style={SHEEN} />

      <Link
        to={`/susu/${account.id}`}
        aria-label={`Susu account ${ref}, ${formatGhs(account.dailyAmount)} daily, ${account.depositsCount} of ${account.cycleTarget} days paid, ${account.status}. View details.`}
        className="absolute inset-0 z-10 rounded-lg outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
      />

      {/* Everything above the sheen. */}
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="font-heading text-sm font-extrabold tracking-tight">
            YADAH
          </p>
          <p className={`${LABEL} mt-0.5 text-white/70`}>Susu · {ref}</p>
        </div>
        <span className="flex items-center gap-1 text-xs font-medium text-white/80 transition-colors group-hover:text-white">
          View details
          <ArrowUpRight
            size={14}
            className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 motion-reduce:group-hover:translate-y-0"
          />
        </span>
      </div>

      {/* The hero: what the account is worth, in the slot a debit card gives
          its number. Sized so it reads from across a desk — this is the one
          figure anybody walks up to the counter to ask for. */}
      <div className="relative">
        <p className={`${LABEL} text-white/60`}>Saved</p>
        <div className="mt-0.5 flex items-center gap-2">
          {/* Truncated rather than wrapped: a freak amount should clip inside
              the card's proportions, not push the strip off the bottom edge.
              The dots run to about the width of a four-figure balance, so
              revealing one barely moves the row. */}
          <p className="truncate font-sen text-xl font-semibold tabular-nums">
            {showBalance ? formatGhs(account.totalDeposited) : `${CEDI}••••••`}
          </p>
          <button
            type="button"
            // Above the stretched link, or the click navigates instead.
            className="relative z-20 flex size-8 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
            aria-pressed={showBalance}
            aria-label={showBalance ? "Hide balance" : "Show balance"}
            onClick={() => setShowBalance((prev) => !prev)}
          >
            {showBalance ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <div className="relative space-y-2.5">
        {/* Three stats, small: the daily amount is down here rather than gone,
            because a customer running two cycles at once tells them apart by
            it — same name, same month, different amount. */}
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className={`${LABEL} text-white/60`}>Daily</p>
            <p className="font-sen text-xs tabular-nums text-white/90">
              {formatGhs(account.dailyAmount)}
            </p>
          </div>
          <div>
            <p className={`${LABEL} text-white/60`}>
              {account.status === "closed" ? "Closed" : "Opened"}
            </p>
            <p className="font-sen text-xs tabular-nums text-white/90">
              {formatDate(
                account.status === "closed" && account.closedAt
                  ? account.closedAt
                  : account.openedAt,
              )}
            </p>
          </div>
          <div className="text-right">
            <p className={`${LABEL} text-white/60`}>{closing.label}</p>
            <p className="font-sen text-xs font-semibold tabular-nums">
              {closing.value}
            </p>
          </div>
        </div>

        <TickStrip account={account} />
      </div>
    </article>
  );
}

/**
 * The 31 boxes of a paper susu card, as one strip.
 *
 * Discrete ticks rather than a progress bar because the thing being counted is
 * discrete — a customer pays whole days, and "23 marks" is what they'd count
 * on the card in their pocket. Decorative to a screen reader: the card's own
 * aria-label already gives the count.
 */
function TickStrip({ account }: { account: SusuAccount }) {
  return (
    <div aria-hidden="true" className="flex gap-0.5">
      {Array.from({ length: account.cycleTarget }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-xs ${
            i < account.depositsCount ? "bg-white/90" : "bg-white/20"
          }`}
        />
      ))}
    </div>
  );
}

/** Placeholder at the card's exact proportions, so the grid doesn't jump. */
export function AccountCardSkeleton() {
  return <Skeleton className="aspect-[1.586] w-full rounded-lg" />;
}

/* ------------------------------------------------------------------ *
 * Savings
 * ------------------------------------------------------------------ */

/**
 * Two more hues from the same logo ring, so a savings card is told from a susu
 * card at a glance without reading either. Leaf green for an open account, and
 * the same navy susu uses for closed — a settled account is a settled account
 * whichever product it was.
 */
const SAVINGS_FACE: Record<SavingsAccountStatus, string> = {
  active: "bg-leaf",
  closed: "bg-navy-dark",
};

/**
 * One savings account, drawn as a card.
 *
 * Deliberately the same object as `AccountCard` — ID-1 proportions, mark
 * top-left, hero figure across the middle, three stats and a strip along the
 * bottom edge — because the two sit in one grid on the customer's accounts page
 * and a different shape would read as a different app.
 *
 * What differs is what the parts *mean*, and that follows the product:
 *
 * - The hero is the **balance**, where susu's is what has been saved into a
 *   cycle. Both answer "what is in this?", which is what the slot is for.
 * - The strip is not 31 boxes — there is no cycle to count. It splits the
 *   balance into what can be withdrawn and what the GHS 50 minimum and the
 *   GHS 10 fee hold back, which is the savings equivalent of the question susu
 *   answers with marked days: how much of this is really mine today?
 */
export function SavingsCard({ account }: { account: SavingsAccount }) {
  // Balances start hidden — same reasoning as the susu card: these are read at
  // a counter with whoever is next in the queue standing behind.
  const [showBalance, setShowBalance] = useState(false);
  const ref = account.accountNumber;
  const closed = account.status === "closed";

  return (
    <article
      className={[
        "group relative flex aspect-[1.586] flex-col justify-between overflow-hidden rounded-lg p-4 text-white shadow-sm",
        "transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        SAVINGS_FACE[account.status],
      ].join(" ")}
    >
      <div aria-hidden="true" className="absolute inset-0" style={SHEEN} />

      <Link
        to={`/savings/${account.id}`}
        aria-label={`Savings account ${ref}, balance ${formatGhs(account.balance)}, ${formatGhs(account.availableToWithdraw)} available to withdraw, ${account.status}. View details.`}
        className="absolute inset-0 z-10 rounded-lg outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
      />

      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="font-heading text-sm font-extrabold tracking-tight">
            YADAH
          </p>
          {/* Ten digits, not six. Printed whole for the same reason the susu
              number is: quoting it is how an account gets looked up. */}
          <p className={`${LABEL} mt-0.5 text-white/70`}>Savings · {ref}</p>
        </div>
        <span className="flex items-center gap-1 text-xs font-medium text-white/80 transition-colors group-hover:text-white">
          View details
          <ArrowUpRight
            size={14}
            className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 motion-reduce:group-hover:translate-y-0"
          />
        </span>
      </div>

      <div className="relative">
        <p className={`${LABEL} text-white/60`}>Balance</p>
        <div className="mt-0.5 flex items-center gap-2">
          <p className="truncate font-sen text-xl font-semibold tabular-nums">
            {showBalance ? formatGhs(account.balance) : `${CEDI}••••••`}
          </p>
          <button
            type="button"
            className="relative z-20 flex size-8 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
            aria-pressed={showBalance}
            aria-label={showBalance ? "Hide balance" : "Show balance"}
            onClick={() => setShowBalance((prev) => !prev)}
          >
            {showBalance ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <div className="relative space-y-2.5">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className={`${LABEL} text-white/60`}>Available</p>
            {/* Money, so it answers to the same toggle as the balance above —
                hiding one and printing the other makes the toggle a
                decoration. A closed account has nothing available, and saying
                "₵0.00" invites the question of why. */}
            <p className="font-sen text-xs tabular-nums text-white/90">
              {closed
                ? "—"
                : showBalance
                  ? formatGhs(account.availableToWithdraw)
                  : `${CEDI}••••`}
            </p>
          </div>
          <div>
            <p className={`${LABEL} text-white/60`}>
              {closed ? "Closed" : "Opened"}
            </p>
            <p className="font-sen text-xs tabular-nums text-white/90">
              {formatDate(
                closed && account.closedAt ? account.closedAt : account.openedAt,
              )}
            </p>
          </div>
          <div className="text-right">
            <p className={`${LABEL} text-white/60`}>Status</p>
            <p className="font-sen text-xs font-semibold capitalize tabular-nums">
              {account.status}
            </p>
          </div>
        </div>

        <AvailableStrip account={account} />
      </div>
    </article>
  );
}

/**
 * The balance split in two: what a withdrawal could take today, and what the
 * minimum balance and the fee hold back.
 *
 * Continuous rather than the susu card's discrete ticks, because what it
 * measures is continuous — a proportion of an amount, not a count of days.
 * Decorative to a screen reader: the card's own aria-label already gives both
 * figures.
 *
 * An empty account has nothing to divide and draws as an empty track, which is
 * the truth rather than a bar at 0% of nothing.
 */
function AvailableStrip({ account }: { account: SavingsAccount }) {
  const locked = lockedBalance(account);
  const percent =
    account.balance > 0
      ? Math.round((account.availableToWithdraw / account.balance) * 100)
      : 0;

  return (
    <div aria-hidden="true" className="flex h-1.5 gap-0.5 overflow-hidden">
      <span
        className="rounded-xs bg-white/90 transition-[width] duration-300 motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
      <span
        className={`flex-1 rounded-xs ${locked > 0 ? "bg-white/25" : "bg-white/10"}`}
      />
    </div>
  );
}
