import { CheckIcon, ClockIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { formatAccraDateTime } from "~/lib/format";
import {
  AGREEMENT_STATUS_LABELS,
  type AgreementStatus,
} from "~/lib/hire-purchase";
import { cn } from "~/lib/utils";

/**
 * The redemption window, and the lifecycle it sits inside.
 *
 * A repossession starts a clock: `redemptionDeadline` is the repossession plus
 * exactly one month, and until it passes the customer can have the item back by
 * paying the full remaining balance. Once it passes, the agreement can be
 * forfeited and the item is Yadah's. The API refuses a forfeit while the window
 * is open and refuses a redemption after it, so the clock is not decoration —
 * it decides which of two irreversible actions is available.
 *
 * That is why it is drawn as a countdown rather than as a date. "14 March" is a
 * fact; "6 days left" is the thing anyone actually needs to know, and the one
 * that changes what they do today.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A live count of what is left.
 *
 * Rendered as the deadline itself until the component mounts, then swapped for
 * the countdown. Server time and browser time are never the same instant, and a
 * countdown rendered on both would be a hydration mismatch on every page load —
 * so the first paint is the one thing both sides agree on.
 *
 * It ticks once a minute. A month-long window does not need seconds, and a
 * per-second re-render on every row of a listing is a cost with nothing behind
 * it.
 */
export function RedemptionCountdown({
  deadline,
  compact = false,
  className,
}: {
  deadline: string;
  /** The one-line form, for a table row. */
  compact?: boolean;
  className?: string;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, []);

  const at = Date.parse(deadline);
  const left = now === null ? null : at - now;
  const lapsed = left !== null && left <= 0;

  const text =
    left === null
      ? `Until ${formatAccraDateTime(deadline)}`
      : lapsed
        ? "Window lapsed"
        : `${humanise(left)} left to redeem`;

  if (compact) {
    return (
      <p
        className={cn(
          "tabular mt-0.5 text-xs",
          lapsed ? "text-danger" : "text-warning",
          className,
        )}
      >
        {text}
      </p>
    );
  }

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3",
        lapsed ? "border-danger/40 bg-danger/10" : "border-warning/40 bg-warning/10",
        className,
      )}
    >
      {lapsed ? (
        <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-danger" />
      ) : (
        <ClockIcon className="mt-0.5 size-5 shrink-0 text-warning" />
      )}
      <div className="min-w-0 space-y-0.5">
        <p
          className={cn(
            "tabular font-heading text-lg font-bold tracking-tight",
            lapsed ? "text-danger" : "text-warning",
          )}
        >
          {text}
        </p>
        <p className="text-sm text-muted-foreground">
          {lapsed
            ? "The customer can no longer redeem. The agreement can be forfeited, and the item restocked as used at a price the office sets."
            : "Paying the full remaining balance before this returns the item to the customer. A forfeit is refused until it passes."}
        </p>
        <p className="text-xs text-muted-foreground">
          Deadline: {formatAccraDateTime(deadline)}
        </p>
      </div>
    </div>
  );
}

/** `6 days`, `18 hours`, `42 minutes` — one unit, the largest that fits. */
function humanise(ms: number): string {
  if (ms >= DAY) {
    const days = Math.floor(ms / DAY);
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (ms >= HOUR) {
    const hours = Math.floor(ms / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const minutes = Math.max(1, Math.floor(ms / MINUTE));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/* --------------------------------------------------------------- lifecycle --- */

type Step = { key: string; label: string; hint: string };

/**
 * The path an agreement takes: signed, deposit paid and item released,
 * instalments, and then one of four endings.
 *
 * The endings are not steps on the same line — an agreement that was
 * repossessed did not pass through "completed" — so the last stop is named
 * after whichever ending this agreement actually reached, and coloured by
 * whether the customer kept the item.
 */
const STEPS: Step[] = [
  { key: "signed", label: "Signed", hint: "A unit is reserved and the prices are fixed." },
  { key: "released", label: "Item released", hint: "The 50% deposit landed." },
  { key: "paying", label: "Instalments", hint: "Flat interest, applied once at activation." },
  { key: "closed", label: "Closed", hint: "" },
];

/** How far along a status is, and how the last stop should read. */
function positionOf(status: AgreementStatus): {
  reached: number;
  ending: "kept" | "lost" | "none";
  endingLabel: string;
} {
  switch (status) {
    case "pending":
      return { reached: 0, ending: "none", endingLabel: "Closed" };
    case "rejected":
      return { reached: 0, ending: "lost", endingLabel: "Rejected" };
    case "active":
      return { reached: 2, ending: "none", endingLabel: "Closed" };
    case "in-arrears":
      return { reached: 2, ending: "none", endingLabel: "Closed" };
    case "repossessed":
      return { reached: 2, ending: "none", endingLabel: "Repossessed" };
    case "closed-completed":
      return { reached: 3, ending: "kept", endingLabel: "Paid off" };
    case "closed-redeemed":
      return { reached: 3, ending: "kept", endingLabel: "Redeemed" };
    case "closed-forfeited":
      return { reached: 3, ending: "lost", endingLabel: "Forfeited" };
    default:
      return { reached: 0, ending: "none", endingLabel: "Closed" };
  }
}

export function LifecycleStrip({
  status,
  className,
}: {
  status: AgreementStatus;
  className?: string;
}) {
  const { reached, ending, endingLabel } = positionOf(status);
  const repossessed = status === "repossessed";

  return (
    <ol
      className={cn("flex flex-wrap items-stretch gap-2 sm:flex-nowrap", className)}
      aria-label={`Agreement lifecycle — currently ${AGREEMENT_STATUS_LABELS[status]}`}
    >
      {STEPS.map((step, index) => {
        const last = index === STEPS.length - 1;
        const done = index < reached;
        const here = index === reached;
        const label = last ? endingLabel : step.label;

        const tone = last
          ? ending === "kept"
            ? "success"
            : ending === "lost"
              ? "danger"
              : repossessed
                ? "danger"
                : "pending"
          : done || here
            ? "success"
            : "pending";

        return (
          <li
            key={step.key}
            aria-current={here ? "step" : undefined}
            className={cn(
              "flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg border px-3 py-2",
              tone === "success" && "border-success/40 bg-success/10",
              tone === "danger" && "border-danger/40 bg-danger/10",
              tone === "pending" && "border-dashed border-border bg-muted/30",
              here && "ring-2 ring-ring/40",
            )}
          >
            <span className="flex items-center gap-1.5">
              {done && !last ? (
                <CheckIcon className="size-3.5 shrink-0 text-success" />
              ) : (
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    tone === "success" && "bg-success",
                    tone === "danger" && "bg-danger",
                    tone === "pending" && "bg-muted-foreground/40",
                  )}
                />
              )}
              <span
                className={cn(
                  "truncate text-sm font-medium",
                  tone === "pending" && "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </span>
            {(here || (last && ending !== "none")) && step.hint && (
              <span className="text-xs text-muted-foreground">{step.hint}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
