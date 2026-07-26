import { useState } from "react";
import { Link } from "react-router";
import { Skeleton } from "@heroui/react";
import { ArrowUpRight, Eye, EyeOff } from "lucide-react";
import { formatDate } from "~/lib/format";
import { CEDI, formatGhs } from "~/lib/money";
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
        "group relative flex aspect-[1.586] flex-col justify-between overflow-hidden rounded-2xl p-4 text-white shadow-sm",
        "transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        FACE[account.status],
      ].join(" ")}
    >
      <div aria-hidden="true" className="absolute inset-0" style={SHEEN} />

      <Link
        to={`/susu/${account.id}`}
        aria-label={`Susu account ${ref}, ${formatGhs(account.dailyAmount)} daily, ${account.depositsCount} of ${account.cycleTarget} days paid, ${account.status}. View details.`}
        className="absolute inset-0 z-10 rounded-2xl outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
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
          <p className="truncate font-sen text-3xl font-semibold tabular-nums">
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
  return <Skeleton className="aspect-[1.586] w-full rounded-2xl" />;
}
