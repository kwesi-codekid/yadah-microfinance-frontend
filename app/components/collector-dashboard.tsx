import {
  BanknoteIcon,
  CoinsIcon,
  EllipsisIcon,
  HandCoinsIcon,
  MapPinIcon,
  RouteIcon,
  ScaleIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  PRODUCT_LABELS,
  channelLabel,
  collectPath,
  entryPath,
  stopPath,
  type CollectorDay,
  type CollectorRound,
} from "~/lib/collectors";
import {
  formatAccraDate,
  formatAccraDateTime,
  formatCedisCompact,
  formatCount,
  formatPesewas,
} from "~/lib/format";
import { varianceKind, type Reconciliation } from "~/lib/reconciliation";
import { cn } from "~/lib/utils";

/**
 * The dashboard a collector gets: the same page as the office's — a KPI row,
 * two columns of cards, a gauge, the things needing attention, a table — but
 * every figure on it is about *their* day and *their* handovers, because
 * those are the only reads the API allows them. Nothing here is a
 * branch-wide number.
 *
 * Fed by three calls the collector may make: today's round, today's takings,
 * and their own reconciliation history over the last thirty days.
 */

export interface CollectorDashboardData {
  day: CollectorDay | null;
  round: CollectorRound | null;
  /** The collector's own days, newest first, over the trailing window. */
  history: Reconciliation[];
  /** Accra day, `YYYY-MM-DD`. */
  today: string;
  /** How many days back `history` reaches. */
  windowDays: number;
  generatedAt: string;
}

/* ------------------------------------------------------------------ palette --- */
const CORAL = "var(--chart-1)";
const NAVY = "var(--chart-2)";
const SKY = "var(--chart-3)";
const FG = "var(--color-foreground)";
const MUTED = "var(--color-muted-foreground)";
const BORDER = "var(--color-border)";

const gh = (pesewas: number) => `GH₵${formatCedisCompact(pesewas)}`;

/* --------------------------------------------------------------------- page --- */

export function CollectorDashboard({ data }: { data: CollectorDashboardData }) {
  const { day, round, history, today, windowDays, generatedAt } = data;

  const stopsLeft = round ? round.totals.customers - round.totals.customersDone : 0;
  const takenToday = day ? day.susu.amount + day.savings.amount : 0;
  const depositsToday = day ? day.susu.count + day.savings.count : 0;

  const awaitingCount = history.filter((r) => r.status === "declared").length;
  const reconciled = history.filter((r) => r.status === "reconciled");
  const expectedSum = reconciled.reduce((s, r) => s + r.expectedAmount, 0);
  const receivedSum = reconciled.reduce((s, r) => s + (r.receivedAmount ?? 0), 0);
  const accuracy = expectedSum > 0 ? (receivedSum / expectedSum) * 100 : null;

  const notices = noticesFor(day, round, history, today);
  const entries = day ? [...day.entries].sort((a, b) => (a.at < b.at ? 1 : -1)) : [];
  const nextStops = round ? round.stops.filter((s) => !s.done).slice(0, 5) : [];

  return (
    <div className="min-h-full bg-background px-5 pt-1 pb-5 text-foreground sm:px-8">
      {/* ------------------------------------------------------- KPI row --- */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Stat
          value={round ? gh(round.totals.stillDueTotal) : "—"}
          label="Still Due Today"
          icon={CoinsIcon}
          tint={4}
          hint={round ? `${formatCount(stopsLeft)} stop${stopsLeft === 1 ? "" : "s"} to visit` : "Could not read the round"}
        />
        <Stat
          value={day ? gh(takenToday) : "—"}
          label="Collected Today"
          icon={BanknoteIcon}
          tint={1}
          hint={day ? `${formatCount(depositsToday)} deposit${depositsToday === 1 ? "" : "s"} · susu and savings` : "Could not read the day"}
        />
        <Stat
          value={day ? gh(day.cashTotal) : "—"}
          label="Cash To Hand Over"
          icon={HandCoinsIcon}
          tint={2}
          hint="Cash only — mobile money never touches your hands"
        />
        <Stat
          value={round ? `${formatCount(round.totals.customersDone)}/${formatCount(round.totals.customers)}` : "—"}
          label="Stops Paid"
          icon={RouteIcon}
          tint={3}
          hint={round ? `${formatCount(round.totals.susuAccounts)} susu account${round.totals.susuAccounts === 1 ? "" : "s"} on the round` : undefined}
        />
        <Stat
          value={formatCount(awaitingCount)}
          label="Awaiting Office Count"
          icon={ScaleIcon}
          tint={awaitingCount > 0 ? 4 : 3}
          hint={`Handovers declared, not yet counted · last ${windowDays} days`}
        />
      </div>

      {/* ----------------------------------------------------- two columns --- */}
      <div className="mt-4 grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.66fr)_minmax(0,1fr)]">
        {/* left column */}
        <div className="flex flex-col gap-4">
          <Card
            title="Your Collections"
            detailTo="/reconciliation"
            note={`What the system recorded you taking in cash each day against what the office counted when you handed it over. Days not yet counted show recorded only. Last ${windowDays} days.`}
          >
            <HistoryChart history={history} today={today} windowDays={windowDays} />
          </Card>

          <Card
            title="Next On Your Round"
            detailTo="/susu"
            top
            note={
              round && round.stops.length > 0
                ? "Who still owes a susu deposit today, biggest first. Collecting takes one cash amount across every account the customer holds."
                : undefined
            }
          >
            {!round ? (
              <Unavailable what="today's round" />
            ) : nextStops.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {round.stops.length === 0
                  ? "Nobody on your round has an open susu account, so nothing is due today."
                  : "Everyone on your round has paid today. Cash up when you are ready."}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {[...nextStops]
                  .sort((a, b) => b.totalStillDue - a.totalStillDue)
                  .map((stop) => (
                    <li key={stop.customerId} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <Link
                          to={stopPath(stop)}
                          className="text-[13px] font-semibold underline-offset-4 hover:underline"
                        >
                          {stop.customerName}
                        </Link>
                        <p className="truncate text-[10.5px] text-muted-foreground">
                          {stop.phone}
                          {(stop.ghanaPostGps || stop.residentialAddress) && (
                            <>
                              {" · "}
                              <MapPinIcon className="inline size-3" />{" "}
                              {stop.ghanaPostGps || stop.residentialAddress}
                            </>
                          )}
                        </p>
                      </div>
                      <span className="tabular text-[13px] font-bold">{formatPesewas(stop.totalStillDue)}</span>
                      <Link
                        to={collectPath(stop)}
                        className="rounded-full bg-primary px-3.5 py-1.5 text-[11px] font-medium text-primary-foreground transition-transform duration-150 hover:scale-[1.03] motion-reduce:transition-none"
                      >
                        Collect
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </div>

        {/* right column */}
        <div className="flex flex-col gap-4">
          <Card
            title="Handover Accuracy"
            centered
            plain
            note={
              accuracy === null
                ? `None of your days in the last ${windowDays} have been counted by the office yet, so there is nothing to measure.`
                : `Of ${formatPesewas(expectedSum)} the system recorded you taking in cash on counted days, the office confirmed ${formatPesewas(receivedSum)}.`
            }
          >
            <Gauge percent={accuracy} />
          </Card>

          <Card title="Needs your attention" plain top>
            {notices.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                Nothing is waiting on you. The round is paid, the cash is declared, and
                every handover has been counted.
              </p>
            ) : (
              <div className="space-y-5">
                {notices.map((n) => (
                  <Notice key={n.key} notice={n} />
                ))}
              </div>
            )}
          </Card>

          <Card
            title="Cash Handover"
            detailTo="/reconciliation"
            note="What the office will expect from today. Declare once the round is done and the cash is counted."
          >
            {!day ? (
              <Unavailable what="today's takings" />
            ) : (
              <HandoverPanel day={day} />
            )}
          </Card>
        </div>
      </div>

      {/* --------------------------------------------------- today's table --- */}
      <div className="mt-4">
        <Card title="Today's Deposits" detailTo="/susu/summary" top>
          {!day ? (
            <Unavailable what="today's deposits" />
          ) : entries.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Nothing recorded yet today.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10.5px] tracking-wider text-muted-foreground uppercase">
                    <th className="py-2 pr-3 font-medium">Customer</th>
                    <th className="py-2 pr-3 font-medium">Account</th>
                    <th className="hidden py-2 pr-3 font-medium sm:table-cell">Product</th>
                    <th className="hidden py-2 pr-3 font-medium md:table-cell">Channel</th>
                    <th className="hidden py-2 pr-3 font-medium md:table-cell">Time</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.slice(0, 8).map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-0">
                      <td className="py-2.5 pr-3 font-semibold">
                        <Link to={entryPath(e)} className="underline-offset-4 hover:underline">
                          {e.customerName}
                        </Link>
                      </td>
                      <td className="tabular py-2.5 pr-3 text-muted-foreground">#{e.accountNumber}</td>
                      <td className="hidden py-2.5 pr-3 sm:table-cell">{PRODUCT_LABELS[e.product]}</td>
                      <td className="hidden py-2.5 pr-3 md:table-cell">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                            e.channel === "cash" ? "bg-cash-in-subtle text-cash-in" : "bg-info-subtle text-info",
                          )}
                        >
                          {channelLabel(e.channel)}
                        </span>
                      </td>
                      <td className="tabular hidden py-2.5 pr-3 text-muted-foreground md:table-cell">
                        {formatAccraDateTime(e.at).split(", ")[1] ?? ""}
                      </td>
                      <td className="tabular py-2.5 text-right font-bold">{formatPesewas(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {entries.length > 8 && (
                <p className="mt-2 text-[10.5px] text-muted-foreground">
                  Showing 8 of {formatCount(entries.length)} — the full day is on the summary.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Your own figures, read at {formatAccraDateTime(generatedAt)}. Money is shown in
        cedis; every amount is held as pesewas.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- notices --- */

interface NoticeSpec {
  key: string;
  severity: "critical" | "warning" | "info";
  title: string;
  body: string;
  meta: string;
  to: string;
  action: string;
}

/**
 * The conditions a collector can actually act on, worst first. Not the
 * office's alerts — those are branch-wide and refused to a collector — but
 * the same shape, so the card reads the same on both dashboards.
 */
function noticesFor(
  day: CollectorDay | null,
  round: CollectorRound | null,
  history: Reconciliation[],
  today: string,
): NoticeSpec[] {
  const out: NoticeSpec[] = [];

  const shortDays = history.filter(
    (r) => r.status === "reconciled" && varianceKind(r.variance) === "short",
  );
  if (shortDays.length > 0) {
    const total = shortDays.reduce((s, r) => s + Math.abs(r.variance ?? 0), 0);
    out.push({
      key: "short",
      severity: "critical",
      title: "Days that came up short",
      body: "The office counted less than the system recorded you taking. Each gap is on your record; open the day to see the reason noted.",
      meta: `${formatCount(shortDays.length)} ${shortDays.length === 1 ? "day" : "days"} · ${formatPesewas(total)}`,
      to: "/reconciliation?variance=1",
      action: "See the gaps",
    });
  }

  if (day && day.cashTotal > 0 && !day.reconciliation) {
    out.push({
      key: "declare",
      severity: "warning",
      title: "Today's cash is not declared",
      body: "Declare what you are handing over once the round is done. The office counts it against what the system recorded.",
      meta: `${formatPesewas(day.cashTotal)} in cash`,
      to: "/reconciliation/declare",
      action: "Declare cash",
    });
  }

  const awaiting = history.filter((r) => r.status === "declared" && r.accraDay !== today);
  if (awaiting.length > 0) {
    out.push({
      key: "awaiting",
      severity: "info",
      title: "Handovers awaiting the office count",
      body: "You have declared these days; the office has not counted them yet. Nothing for you to do but worth knowing.",
      meta: `${formatCount(awaiting.length)} ${awaiting.length === 1 ? "day" : "days"}`,
      to: "/reconciliation?status=declared",
      action: "See them",
    });
  }

  if (round && round.totals.customers - round.totals.customersDone > 0) {
    const left = round.totals.customers - round.totals.customersDone;
    out.push({
      key: "round",
      severity: "info",
      title: "Stops still to visit",
      body: "Customers on your round whose susu deposit for today has not been recorded by anyone.",
      meta: `${formatCount(left)} ${left === 1 ? "stop" : "stops"} · ${formatPesewas(round.totals.stillDueTotal)} due`,
      to: "/susu",
      action: "Open the susu book",
    });
  }

  return out;
}

const SEVERITY_ACCENT: Record<NoticeSpec["severity"], string> = {
  critical: "var(--danger)",
  warning: "var(--warning)",
  info: SKY,
};

function Notice({ notice }: { notice: NoticeSpec }) {
  return (
    <div className="border-l-2 pl-3" style={{ borderColor: SEVERITY_ACCENT[notice.severity] }}>
      <p className="text-[13px] font-semibold">{notice.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{notice.body}</p>
      <p className="mt-1 text-[10.5px] font-medium text-muted-foreground">{notice.meta}</p>
      <Link
        to={notice.to}
        className="mt-2.5 inline-block rounded-full bg-primary px-3.5 py-1.5 text-[11px] font-medium text-primary-foreground transition-transform duration-150 hover:scale-[1.03] motion-reduce:transition-none"
      >
        {notice.action}
      </Link>
    </div>
  );
}

/* ---------------------------------------------------------------- handover --- */

function HandoverPanel({ day }: { day: CollectorDay }) {
  const r = day.reconciliation;
  return (
    <div>
      <dl className="grid grid-cols-3 gap-3">
        {[
          ["Susu", day.susu.amount],
          ["Savings", day.savings.amount],
          ["Cash in hand", day.cashTotal],
        ].map(([label, amount]) => (
          <div key={label as string}>
            <dt className="text-[10.5px] text-muted-foreground">{label}</dt>
            <dd className="tabular text-[15px] font-bold">{formatPesewas(amount as number)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          {r ? (
            <>
              Declared <span className="font-medium text-foreground">{formatPesewas(r.declaredAmount)}</span>
              {r.status === "reconciled" ? " · counted by the office" : " · awaiting the office count"}
            </>
          ) : day.cashTotal > 0 ? (
            "Not declared yet."
          ) : (
            "Nothing in cash yet today."
          )}
        </p>
        {r ? (
          <Link
            to={`/reconciliation/${r.id}`}
            className="rounded-full border border-border bg-card px-3 py-1 text-[10.5px] font-medium"
          >
            Open the day
          </Link>
        ) : (
          <Link
            to="/reconciliation/declare"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[11px] font-medium text-primary-foreground"
          >
            <ScaleIcon className="size-3" />
            Declare cash
          </Link>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- chart --- */

const CX0 = 42;
const CX1 = 632;
const CY0 = 12;
const CY1 = 188;

interface DayBar {
  key: string;
  label: string;
  recorded: number;
  counted: number | null;
}

/**
 * Recorded cash per day against what the office counted, as paired bars —
 * the same idea as the office's Collections Performance chart, over the
 * collector's own days. A day without a handover draws empty rather than
 * being skipped, so a gap in the row reads as the day off it was.
 */
function HistoryChart({
  history,
  today,
  windowDays,
}: {
  history: Reconciliation[];
  today: string;
  windowDays: number;
}) {
  const byDay = new Map(history.map((r) => [r.accraDay, r]));
  const days: DayBar[] = [];
  const [y, m, d] = today.split("-").map(Number);
  for (let i = windowDays - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - 1, d - i));
    const key = dt.toISOString().slice(0, 10);
    const r = byDay.get(key);
    days.push({
      key,
      label: String(dt.getUTCDate()),
      recorded: r?.expectedAmount ?? 0,
      counted: r?.status === "reconciled" ? (r.receivedAmount ?? 0) : null,
    });
  }

  const [focus, setFocus] = useState(days.length - 1);
  const max = niceCeil(Math.max(1, ...days.map((p) => Math.max(p.recorded, p.counted ?? 0))));
  const n = days.length;
  const slot = (CX1 - CX0) / n;
  const bw = Math.max(3, slot * 0.28);
  const sy = (v: number) => CY1 - (v / max) * (CY1 - CY0);
  const at = days[focus];
  const hasAny = days.some((p) => p.recorded > 0);

  if (!hasAny) {
    return (
      <p className="py-10 text-center text-xs text-muted-foreground">
        No handover in the last {windowDays} days. Once you declare a day it appears here,
        and the office's count fills in beside it.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[10.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2 rounded-sm" style={{ background: CORAL }} /> Recorded by the system
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2 rounded-sm" style={{ background: NAVY }} /> Counted by the office
        </span>
        <span className="ml-auto font-medium text-foreground">
          {formatAccraDate(`${at.key}T12:00:00Z`)} · {formatPesewas(at.recorded)}
          {at.counted !== null && ` → ${formatPesewas(at.counted)}`}
        </span>
      </div>
      <svg viewBox="0 0 640 210" className="h-auto w-full overflow-visible" role="img" aria-label="Your collections by day">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={CX0} x2={CX1} y1={sy(max * t)} y2={sy(max * t)} strokeWidth="1" style={{ stroke: BORDER }} />
            <text x={CX0 - 6} y={sy(max * t) + 3} textAnchor="end" fontSize="9" style={{ fill: MUTED }}>
              {formatCedisCompact(max * t)}
            </text>
          </g>
        ))}
        {days.map((p, i) => {
          const x = CX0 + i * slot + slot / 2;
          const dim = i !== focus;
          return (
            <g key={p.key} onMouseEnter={() => setFocus(i)} style={{ cursor: "default" }}>
              <rect x={CX0 + i * slot} y={CY0} width={slot} height={CY1 - CY0} fill="transparent" />
              <rect
                x={x - bw - 1}
                y={sy(p.recorded)}
                width={bw}
                height={CY1 - sy(p.recorded)}
                rx="1.5"
                style={{ fill: CORAL, opacity: dim ? 0.55 : 1 }}
              />
              {p.counted !== null && (
                <rect
                  x={x + 1}
                  y={sy(p.counted)}
                  width={bw}
                  height={CY1 - sy(p.counted)}
                  rx="1.5"
                  style={{ fill: NAVY, opacity: dim ? 0.55 : 1 }}
                />
              )}
              {(i % Math.ceil(n / 10) === 0 || i === n - 1) && (
                <text x={x} y={CY1 + 14} textAnchor="middle" fontSize="9" style={{ fill: i === focus ? FG : MUTED }}>
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function niceCeil(value: number): number {
  const mag = 10 ** Math.floor(Math.log10(value));
  const step = value / mag;
  const nice = step <= 1 ? 1 : step <= 2 ? 2 : step <= 5 ? 5 : 10;
  return nice * mag;
}


/* -------------------------------------------------------------------- gauge --- */

function useAnimatedNumber(target: number): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 600);
      const eased = 1 - (1 - t) ** 3;
      const v = Math.round(from + (target - from) * eased);
      shownRef.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(",")})`;
}

function Gauge({ percent }: { percent: number | null }) {
  const shown = useAnimatedNumber(percent === null ? 0 : Math.round(percent));
  const cx = 140;
  const cy = 142;
  const count = 64;
  const ticks = Array.from({ length: count }, (_, i) => {
    const deg = 180 - (i * 180) / (count - 1);
    const rad = (deg * Math.PI) / 180;
    const len = 12 + 20 * (0.5 + 0.5 * Math.sin(i * 1.7)) + 6 * (0.5 + 0.5 * Math.sin(i * 0.37));
    const r1 = 88;
    const r2 = 96 + len;
    return {
      x1: cx + r1 * Math.cos(rad),
      y1: cy - r1 * Math.sin(rad),
      x2: cx + r2 * Math.cos(rad),
      y2: cy - r2 * Math.sin(rad),
      color: lerpColor("#EE3D22", "#74A5D7", i / (count - 1)),
    };
  });

  return (
    <svg
      viewBox="0 0 280 152"
      className="mx-auto h-auto w-full max-w-80"
      role="img"
      aria-label={percent === null ? "Handover accuracy: no counted day yet" : `Handover accuracy: ${Math.round(percent)}%`}
    >
      {ticks.map((tick, i) => (
        <line
          key={i}
          x1={tick.x1}
          y1={tick.y1}
          x2={tick.x2}
          y2={tick.y2}
          stroke={percent === null ? BORDER : tick.color}
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}
      <polygon points="2,136 2,148 12,142" style={{ fill: FG }} />
      <polygon points="278,136 278,148 268,142" style={{ fill: FG }} />
      <polygon points="134,2 146,2 140,11" style={{ fill: FG }} />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="34" fontWeight="700" style={{ fill: FG }}>
        {percent === null ? "—" : `${shown}%`}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------- pieces --- */

function Card({
  title,
  detailTo,
  centered = false,
  plain = false,
  note,
  top = false,
  children,
}: {
  title: string;
  detailTo?: string;
  centered?: boolean;
  plain?: boolean;
  note?: string;
  /** Lists and tables hang from the top; a lone figure or chart sits centred. */
  top?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-56 flex-1 flex-col rounded-2xl bg-card p-4 text-card-foreground sm:p-5">
      <header className={cn("mb-4 flex flex-wrap items-center gap-2", centered ? "justify-center" : "justify-between")}>
        <h3 className="text-[15px] font-bold tracking-tight">{title}</h3>
        {!plain && detailTo && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Link to={detailTo} className="rounded-full border border-border bg-card px-3 py-1 text-[10.5px] font-medium">
              See Detail
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`More options for ${title}`}
                className="flex size-6 items-center justify-center rounded-full border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <EllipsisIcon className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={detailTo}>Open in full</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>
      <div className={cn("flex flex-1 flex-col", top ? "justify-start" : "justify-center")}>{children}</div>
      {note && <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">{note}</p>}
    </section>
  );
}

function Unavailable({ what }: { what: string }) {
  return (
    <p className="py-8 text-center text-xs text-muted-foreground">
      Could not read {what}. The rest of the page is current — reload to try this card again.
    </p>
  );
}

function Stat({
  value,
  label,
  icon: Icon,
  tint,
  hint,
}: {
  value: string;
  label: string;
  icon: LucideIcon;
  tint: 1 | 2 | 3 | 4;
  hint?: string;
}) {
  return (
    <div className="relative flex min-h-28 flex-col rounded-2xl bg-card p-4">
      <span className="absolute top-3.5 right-3.5 rounded-lg p-2" style={{ background: `var(--tint-${tint}-bg)` }}>
        <Icon className="size-4" style={{ color: `var(--tint-${tint}-fg)` }} />
      </span>
      <p
        key={value}
        className="animate-in fade-in slide-in-from-bottom-1 text-[22px] font-bold tracking-tight duration-300 motion-reduce:animate-none"
      >
        {value}
      </p>
      <p className="mt-1 pr-10 text-xs text-muted-foreground">{label}</p>
      <p className="mt-auto pt-1 text-[10px] text-muted-foreground">{hint ?? " "}</p>
    </div>
  );
}
