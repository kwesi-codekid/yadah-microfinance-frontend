import { X } from "lucide-react";

import { formatDate, formatMonth } from "~/lib/format";
import { formatGhs } from "~/lib/money";
import {
  buildCycleCalendar,
  WEEKDAYS,
  type CalendarDay,
  type CalendarMonth,
} from "~/lib/susu-calendar";
import {
  cyclePercent,
  type SusuAccount,
  type SusuDeposit,
} from "~/lib/susu-client";

export function CycleChips({
  account,
  deposits,
  selectedSeq = null,
  onSelectSeq,
  onClearFilter,
}: {
  account: SusuAccount;
  /** Every deposit on the cycle — `limit: 100`, same as the calendar wants. */
  deposits: SusuDeposit[];
  selectedSeq?: number | null;
  onSelectSeq?: (seq: number) => void;
  onClearFilter?: () => void;
}) {
  const filtering = selectedSeq != null;
  const bySeq = new Map<number, SusuDeposit>();
  for (const deposit of deposits) {
    for (let seq = deposit.seqStart; seq <= deposit.seqEnd; seq += 1) {
      bySeq.set(seq, deposit);
    }
  }

  const hasCatchUp = deposits.some((deposit) => deposit.daysCovered > 1);

  const runs: { key: string; label: string; span: number }[] = [];
  for (let seq = 1; seq <= account.cycleTarget; seq += 1) {
    const deposit = bySeq.get(seq);
    const key = deposit ? deposit.createdAt.slice(0, 7) : "";
    const label = deposit ? formatMonth(deposit.createdAt) : "Not yet";
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.span += 1;
    else runs.push({ key, label, span: 1 });
  }

  const columns = {
    gridTemplateColumns: `repeat(${account.cycleTarget}, minmax(0, 1fr))`,
  };

  return (
    <div className="rounded-lg border-2 border-border bg-surface p-3">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
        <p className="text-sm font-semibold tabular-nums text-foreground">
          Day {account.depositsCount} of {account.cycleTarget}
        </p>
        <p className="text-xs tabular-nums text-muted">
          {formatGhs(account.totalDeposited)} saved
        </p>

        <ul className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <ChipKey className="border-success bg-success" label="Paid" />
          {/* Only worth explaining the dashed chips when there are some. */}
          {hasCatchUp && (
            <ChipKey
              className="border-dashed border-success bg-success/20"
              label="Catch-up"
            />
          )}
          <ChipKey
            className="border-transparent bg-background"
            label="Not yet"
          />
        </ul>

        {filtering && onClearFilter && (
          <button
            type="button"
            onClick={onClearFilter}
            className="flex items-center gap-1 rounded border border-success px-1.5 py-0.5 text-xs font-medium text-success transition hover:bg-success hover:text-success-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            <X size={11} />
            Clear
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-184">
          <ul className="mb-1 grid gap-1" style={columns}>
            {runs.map((run) => (
              <li
                key={run.key || "unpaid"}
                style={{ gridColumn: `span ${run.span}` }}
                className="truncate border-l-2 border-border pl-1.5 text-xs font-bold uppercase tracking-wide text-muted"
              >
                {run.label}
              </li>
            ))}
          </ul>

          <ul className="grid gap-1" style={columns}>
        {Array.from({ length: account.cycleTarget }, (_, index) => {
          const seq = index + 1;
          const deposit = bySeq.get(seq);
          const catchUp = deposit ? deposit.daysCovered > 1 : false;
          const picked = seq === selectedSeq;

          const face = deposit
            ? catchUp
              ? "border-dashed border-success bg-success/20 text-foreground"
              : "border-success bg-success text-success-foreground"
            : "border-transparent bg-background text-muted";

          const dimmed = filtering && !picked ? "opacity-35" : "";
          const ringed = picked ? "ring-2 ring-accent" : "";

          const spoken = deposit
            ? `Day ${seq}: paid ${formatDate(deposit.createdAt)}${
                catchUp
                  ? `, one of ${deposit.daysCovered} days covered together`
                  : ""
              }`
            : `Day ${seq}: not yet paid`;

          const chip = `flex w-full items-center justify-center rounded-full border-2 py-0.5 text-xs font-semibold tabular-nums transition-opacity ${face} ${dimmed} ${ringed}`;

          if (!deposit || !onSelectSeq) {
            return (
              <li key={seq} className="min-w-0">
                <span title={spoken} className={chip}>
                  <span aria-hidden="true">{seq}</span>
                  <span className="sr-only">{spoken}</span>
                </span>
              </li>
            );
          }

          return (
            <li key={seq} className="min-w-0">
              <button
                type="button"
                aria-pressed={picked}
                title={`${spoken}. Click to show this day only.`}
                onClick={() => onSelectSeq(seq)}
                className={`${chip} cursor-pointer hover:ring-2 hover:ring-accent/50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent`}
              >
                <span aria-hidden="true">{seq}</span>
                <span className="sr-only">{spoken}. Show this day only.</span>
              </button>
            </li>
          );
        })}
        </ul>
        </div>
      </div>
    </div>
  );
}

/** One swatch in the key, shaped like the chips it explains. */
function ChipKey({ className, label }: { className: string; label: string }) {
  return (
    <li className="flex items-center gap-1">
      <span
        aria-hidden="true"
        className={`inline-block h-3 w-5 rounded-full border-2 ${className}`}
      />
      {label}
    </li>
  );
}

export function CycleCalendar({
  account,
  deposits,
  today,
}: {
  account: SusuAccount;
  deposits: SusuDeposit[];
  /** Accra's date, `YYYY-MM-DD`, from the loader — see `buildCycleCalendar`. */
  today: string;
}) {
  const { months, omitted } = buildCycleCalendar(account, deposits, today);
  const hasCatchUp = deposits.some((deposit) => deposit.daysCovered > 1);

  return (
    <div className="space-y-4">

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {months.map((month) => (
          <Month key={month.key} month={month} />
        ))}
      </div>

      {omitted > 0 && (
        <p className="text-xs text-muted">
          {omitted} earlier {omitted === 1 ? "month" : "months"} not shown — the
          statement below has every deposit.
        </p>
      )}

      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
        <Key className="border-success bg-success" label="Paid" />
        {/* Only worth explaining the dashed cells when there are some. */}
        {hasCatchUp && (
          <Key
            className="border-dashed border-success bg-success/25"
            label="Catch-up — one visit covering several days"
          />
        )}
        <Key className="border-accent bg-surface ring-2 ring-accent" label="Today" />
        <Key
          className="border-border bg-surface"
          label="Opened or closed"
          dot
        />
      </ul>
    </div>
  );
}

function Month({ month }: { month: CalendarMonth }) {
  return (
    <section className="rounded-xl border-2 border-border bg-surface p-3">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-heading text-sm font-semibold text-foreground">
          {month.label}
        </h3>
        {month.daysPaid > 0 && (
          <p className="text-xs tabular-nums text-muted">
            {month.daysPaid} {month.daysPaid === 1 ? "day" : "days"} ·{" "}
            {formatGhs(month.amount)}
          </p>
        )}
      </header>

      <table className="w-full table-fixed border-separate border-spacing-1">
        <caption className="sr-only">
          Deposits in {month.label}, by day
        </caption>
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th
                key={weekday.long}
                scope="col"
                className="pb-1 text-xs font-bold uppercase tracking-wide text-muted"
              >
                <abbr title={weekday.long} className="no-underline">
                  {weekday.short}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {month.weeks.map((week) => (
            <tr key={week[0]?.date}>
              {week.map((day) => (
                <td key={day.date} className="p-0 align-top">
                  <Day day={day} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Day({ day }: { day: CalendarDay }) {
  if (!day.inMonth) return <div aria-hidden="true" className="aspect-square" />;

  const paid = day.deposits.length > 0;

  const face = paid
    ? // A catch-up is the same money, so it keeps the same colour — the dashed
      day.hasCatchUp
      ? "border-dashed border-success bg-success/25 font-semibold text-foreground"
      : "border-success bg-success font-semibold text-success-foreground"
    : day.withinCycle
      ? "border-border bg-surface text-muted"
      : // Before the account existed, or after it stopped taking money.
        "border-transparent text-muted/40";

  const spoken = paid
    ? `${formatDate(day.date)}: paid ${formatGhs(day.amount)}${
        day.daysCovered > 1 ? `, covering ${day.daysCovered} days` : ""
      }`
    : day.withinCycle
      ? `${formatDate(day.date)}: nothing paid`
      : formatDate(day.date);

  return (
    <div
      title={[
        spoken,
        day.isOpenedOn ? "Account opened" : null,
        day.isClosedOn ? "Account closed" : null,
        day.isToday ? "Today" : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      className={[
        "relative flex aspect-square flex-col items-center justify-center rounded-lg border-2 text-xs tabular-nums transition-colors",
        face,
        day.isToday ? "ring-2 ring-accent" : "",
      ].join(" ")}
    >
      <span aria-hidden="true">{day.dayOfMonth}</span>
      {day.daysCovered > 1 && (
        <span
          aria-hidden="true"
          className="absolute right-0.5 top-0.5 text-xs font-bold leading-none"
        >
          ×{day.daysCovered}
        </span>
      )}
      {/* The two days that aren't deposits but are still events. */}
      {(day.isOpenedOn || day.isClosedOn) && (
        <span
          aria-hidden="true"
          className="absolute bottom-1 size-1 rounded-full bg-current opacity-60"
        />
      )}
      <span className="sr-only">{spoken}</span>
    </div>
  );
}

/** One swatch in the key under the calendar. */
function Key({
  className,
  label,
  dot,
}: {
  className: string;
  label: string;
  dot?: boolean;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={`relative inline-block size-3.5 rounded-sm border-2 ${className}`}
      >
        {dot && (
          <span className="absolute inset-x-0 bottom-0 mx-auto size-1 rounded-full bg-muted" />
        )}
      </span>
      {label}
    </li>
  );
}

export function CycleBar({ account }: { account: SusuAccount }) {
  const percent = cyclePercent(account);

  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuenow={account.depositsCount}
        aria-valuemin={0}
        aria-valuemax={account.cycleTarget}
        aria-label={`${account.depositsCount} of ${account.cycleTarget} days paid`}
      >
        <div
          className={`h-full rounded-full ${percent >= 100 ? "bg-brand" : "bg-success"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted">
        {account.depositsCount}/{account.cycleTarget}
      </span>
    </div>
  );
}

/** Status pill, shared by the account list and the account detail header. */
export function StatusPill({ account }: { account: SusuAccount }) {
  const tone =
    account.status === "active"
      ? "bg-success/15 text-success"
      : account.status === "completed"
        ? "bg-brand/15 text-brand-dark dark:text-brand-light"
        : "bg-muted/15 text-muted";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${tone}`}
    >
      {account.status}
    </span>
  );
}
