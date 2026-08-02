import { useState } from "react";
import { Link } from "react-router";
import { Skeleton } from "@heroui/react";
import { Eye, EyeOff } from "lucide-react";
import { formatDate } from "~/lib/format";
import { CEDI, formatGhs } from "~/lib/money";
import {
  type SavingsAccount,
  type SavingsAccountStatus,
} from "~/lib/savings-client";
import type { SusuAccount, SusuAccountStatus } from "~/lib/susu-client";

const FACE: Record<SusuAccountStatus, string> = {
  // Teal — money still moving.
  active: "bg-teal-dark",
  // The brand red, darkened: the cycle is full and the payout is due.
  completed: "bg-brand-dark",
  // Navy — settled and filed.
  closed: "bg-navy-dark",
};

export const SHEEN = {
  backgroundImage: [
    "radial-gradient(120% 120% at 82% 8%, rgba(255,255,255,0.20), transparent 55%)",
    "radial-gradient(100% 100% at 8% 92%, rgba(255,255,255,0.10), transparent 60%)",
    "linear-gradient(112deg, transparent 38%, rgba(255,255,255,0.09) 41%, transparent 47%)",
    "linear-gradient(112deg, transparent 58%, rgba(255,255,255,0.06) 61%, transparent 68%)",
  ].join(","),
};

const LABEL = "text-xs font-heading font-bold uppercase tracking-[0.14em]";

function CardChip() {
  return (
    <span
      aria-hidden="true"
      className="relative block h-[26px] w-[38px] shrink-0 overflow-hidden rounded-[5px] ring-1 ring-black/15"
      style={{ backgroundImage: "linear-gradient(150deg,#f6da85,#d9a531 48%,#b07f28)" }}
    >
      <span className="absolute inset-[3px] rounded-[3px] ring-1 ring-black/20" />
      <span className="absolute inset-x-[3px] top-1/2 h-px -translate-y-1/2 bg-black/25" />
      <span className="absolute inset-y-[3px] left-1/2 w-px -translate-x-1/2 bg-black/25" />
    </span>
  );
}

/** The contactless-payment mark. Decorative. */
function Contactless() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className="text-white/75"
    >
      <path d="M6 8.5a8 8 0 0 1 0 7" />
      <path d="M10 6a13 13 0 0 1 0 12" />
      <path d="M14 4a18 18 0 0 1 0 16" />
    </svg>
  );
}

function NetworkMark() {
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center">
      <span className="size-5 rounded-full bg-brand" />
      <span className="-ml-2.5 size-5 rounded-full bg-gold mix-blend-screen" />
    </span>
  );
}

function CardNumber({ number }: { number: string }) {
  return (
    <span className="flex items-center gap-3 font-sen text-sm font-semibold tabular-nums tracking-[0.08em]">
      <span className="text-white/45">••••</span>
      <span className="text-white/45">••••</span>
      <span className="text-white/95">{number}</span>
    </span>
  );
}

/** The eye toggle that bares the money figure. Sits above the stretched link. */
function BalanceToggle({
  shown,
  onToggle,
}: {
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      // Above the stretched link, or the click navigates instead.
      className="relative z-20 flex size-8 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
      aria-pressed={shown}
      aria-label={shown ? "Hide balance" : "Show balance"}
      onClick={onToggle}
    >
      {shown ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  );
}

export function AccountCard({
  account,
  holderName,
}: {
  account: SusuAccount;
  holderName?: string;
}) {
  const [showBalance, setShowBalance] = useState(false);
  const ref = account.accountNumber;
  const holder = (holderName ?? "").trim();

  const trailing =
    account.status === "closed"
      ? "Closed"
      : `Day ${account.depositsCount} / ${account.cycleTarget}`;

  return (
    <article
      className={[
        "group relative flex aspect-[1.586] flex-col justify-between overflow-hidden rounded-md p-5 text-white shadow-md",
        "transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-xl motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        FACE[account.status],
      ].join(" ")}
    >
      <div aria-hidden="true" className="absolute inset-0" style={SHEEN} />

      <Link
        to={`/susu/${account.id}`}
        aria-label={`Susu account ${ref}, ${formatGhs(account.dailyAmount)} daily, ${account.depositsCount} of ${account.cycleTarget} days paid, ${account.status}. View details.`}
        className="absolute inset-0 z-10 rounded-2xl outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
      />

      {/* Top: chip + contactless, and the wordmark. */}
      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <CardChip />
          <Contactless />
        </div>
        <p className="font-heading text-sm font-extrabold tracking-tight">
          YADAH
        </p>
      </div>

      {/* Hero: the balance, in the slot a card gives its biggest figure. */}
      <div className="relative">
        <p className={`${LABEL} text-white/55`}>Saved</p>
        <div className="mt-1 flex items-center gap-2">
          <p className="truncate font-sen text-[27px] font-semibold leading-none tabular-nums">
            {showBalance ? formatGhs(account.totalDeposited) : `${CEDI}••••••`}
          </p>
          <BalanceToggle
            shown={showBalance}
            onToggle={() => setShowBalance((p) => !p)}
          />
        </div>
      </div>

      <div className="relative space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <CardNumber number={ref} />
          <span className="font-sen text-xs font-semibold tabular-nums text-white/80">
            {trailing}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate font-heading text-xs font-bold uppercase tracking-[0.06em]">
            {holder || "YADAH Susu"}
          </p>
          <NetworkMark />
        </div>
      </div>
    </article>
  );
}

/** Placeholder at the card's exact proportions, so the grid doesn't jump. */
export function AccountCardSkeleton() {
  return <Skeleton className="aspect-[1.586] w-full rounded-2xl" />;
}

const SAVINGS_FACE: Record<SavingsAccountStatus, string> = {
  active: "bg-navy",
  closed: "bg-navy-dark",
};

export function SavingsCard({
  account,
  holderName,
}: {
  account: SavingsAccount;
  holderName?: string;
}) {
  const [showBalance, setShowBalance] = useState(false);
  const ref = account.accountNumber;
  const closed = account.status === "closed";
  const holder = (holderName ?? "").trim();

  return (
    <article
      className={[
        "group relative flex aspect-[1.586] flex-col justify-between overflow-hidden rounded-md p-5 text-white shadow-md",
        "transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-xl motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        SAVINGS_FACE[account.status],
      ].join(" ")}
    >
      <div aria-hidden="true" className="absolute inset-0" style={SHEEN} />

      <Link
        to={`/savings/${account.id}`}
        aria-label={`Savings account ${ref}, balance ${formatGhs(account.balance)}, ${formatGhs(account.availableToWithdraw)} available to withdraw, ${account.status}. View details.`}
        className="absolute inset-0 z-10 rounded-2xl outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
      />

      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <CardChip />
          <Contactless />
        </div>
        <p className="font-heading text-sm font-extrabold tracking-tight">
          YADAH
        </p>
      </div>

      <div className="relative">
        <p className={`${LABEL} text-white/55`}>Balance</p>
        <div className="mt-1 flex items-center gap-2">
          <p className="truncate font-sen text-[27px] font-semibold leading-none tabular-nums">
            {showBalance ? formatGhs(account.balance) : `${CEDI}••••••`}
          </p>
          <BalanceToggle
            shown={showBalance}
            onToggle={() => setShowBalance((p) => !p)}
          />
        </div>
      </div>

      <div className="relative space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <CardNumber number={ref} />
          <span className="font-sen text-xs font-semibold tabular-nums text-white/80">
            {formatDate(
              closed && account.closedAt ? account.closedAt : account.openedAt,
            )}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate font-heading text-xs font-bold uppercase tracking-[0.06em]">
            {holder || "YADAH Savings"}
          </p>
          <NetworkMark />
        </div>
      </div>
    </article>
  );
}
