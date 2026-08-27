import {
  BanknoteIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  ClipboardListIcon,
  EllipsisIcon,
  IdCardIcon,
  SearchIcon,
  UploadIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { data, Link } from "react-router";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { requireUser } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/dashboard";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Dashboard · Yadah Dynamic Enterprise" }];
}

/**
 * SAMPLE FIGURES — every number on this page is invented.
 *
 * The layout is a faithful build of a banking-operations dashboard concept,
 * with the data re-drawn from Yadah's own reporting surface so the backend
 * can wire it without guessing. The intended mapping, card by card:
 *
 *   Total Customers        portfolio.customersActive               (GET /reports/dashboard)
 *   Active Accounts        portfolio.susu.activeAccounts
 *                            + portfolio.savings.activeAccounts
 *   Pending Susu Payouts   portfolio.susu.pendingPayout.count
 *   Amount Collected       today.in.susuDeposits + today.in.savingsDeposits,
 *                            with the delta against the previous Accra day
 *   In Arrears             portfolio.loans.arrears + portfolio.hirePurchase.inArrears
 *   Collections Performance  GET /reports/collections rolled up by month —
 *                            collected (coral) against collector targets (navy)
 *   Cash Flow Analytics    today.cashIn / today.cashOut by weekday (GET /transactions totals)
 *   Portfolio Mix          portfolio.susu.valueHeld · portfolio.savings.totalBalance ·
 *                            loans.outstanding + hirePurchase.outstanding
 *   Collection Efficiency  the collected share of what fell due this period
 *                            (the CollectionsReport totals against targets)
 *   Notifications          GET /reports/loans/aging (arrears) · susu.pendingPayout
 *   Collections Reconciliation  daily match rate of collector postings vs the ledger
 *   Recent Transactions    GET /transactions, limit 5 (UnifiedTransaction rows)
 *
 * The period switch, chart hovers, search and export all work against the
 * dummy figures, so going live only means replacing the constants — the
 * interaction layer stays as it is.
 */
export async function loader({ request }: Route.LoaderArgs) {
  // The session is the gate; the header above this page carries the identity.
  const user = await requireUser(request);
  return data({ user });
}

/* ------------------------------------------------------------------ palette --- */
/* Everything reads the theme tokens, so dark mode restyles the whole page:
   the chart slots carry the reference's coral / navy / sky in light mode and
   their night steps in dark. SVG colours go through `style` (not attributes)
   because attribute values cannot resolve CSS variables. */
const CORAL = "var(--chart-1)"; // the hot series — collections, inflow
const NAVY = "var(--chart-2)"; // the dark series — lifts to periwinkle at night
const SKY = "var(--chart-3)"; // the light series
const ACCENT = "var(--brand-coral)"; // badges and deltas — constant in both themes
const FG = "var(--color-foreground)";
const MUTED = "var(--color-muted-foreground)";
const BORDER = "var(--color-border)";
/** Pinned-tooltip ink — a dark pill reads correctly on both themes. */
const TIP = "#0a0a0b";

/** The moving chart markers all slide with the same easing. */
const SLIDE = "transition-transform duration-300 ease-out motion-reduce:transition-none";

/* --------------------------------------------------------------- dummy data --- */

type PeriodKey = "month" | "last" | "year";

/** Everything the period switch swaps out in one object per period. */
const PERIODS: Record<
  PeriodKey,
  {
    label: string;
    customers: string;
    accounts: string;
    pendingPayouts: string;
    collected: string;
    /** Against the previous Accra day. */
    collectedDelta: { text: string; up: boolean };
    inArrears: string;
    inflow: string;
    outflow: string;
    efficiency: number;
    /** Susu held, savings on deposit, credit outstanding — shares of the book. */
    mix: [number, number, number];
    bookTotal: string;
    cash: { navy: number; coral: number }[];
  }
> = {
  month: {
    label: "This Month",
    customers: "1.9k",
    accounts: "2.4k",
    pendingPayouts: "14",
    collected: "GH₵9.6K",
    collectedDelta: { text: "+12.4% vs yesterday", up: true },
    inArrears: "9",
    inflow: "GH₵48.2K",
    outflow: "GH₵31.6K",
    efficiency: 93,
    mix: [38, 27, 35],
    bookTotal: "GH₵1.28M",
    cash: [
      { navy: 3, coral: 4 },
      { navy: 4, coral: 5 },
      { navy: 3, coral: 6 },
      { navy: 5, coral: 6 },
      { navy: 4, coral: 7 },
      { navy: 3, coral: 5 },
      { navy: 2, coral: 4 },
    ],
  },
  last: {
    label: "Last Month",
    customers: "1.8k",
    accounts: "2.3k",
    pendingPayouts: "9",
    collected: "GH₵8.5K",
    collectedDelta: { text: "−3.1% vs yesterday", up: false },
    inArrears: "11",
    inflow: "GH₵44.7K",
    outflow: "GH₵29.9K",
    efficiency: 89,
    mix: [40, 26, 34],
    bookTotal: "GH₵1.21M",
    cash: [
      { navy: 2, coral: 5 },
      { navy: 3, coral: 4 },
      { navy: 4, coral: 5 },
      { navy: 3, coral: 7 },
      { navy: 5, coral: 5 },
      { navy: 2, coral: 6 },
      { navy: 3, coral: 3 },
    ],
  },
  year: {
    label: "This Year",
    customers: "1.9k",
    accounts: "2.4k",
    pendingPayouts: "132",
    collected: "GH₵11.2K",
    collectedDelta: { text: "+8.7% vs yesterday", up: true },
    inArrears: "9",
    inflow: "GH₵512K",
    outflow: "GH₵387K",
    efficiency: 91,
    mix: [37, 28, 35],
    bookTotal: "GH₵1.28M",
    cash: [
      { navy: 4, coral: 5 },
      { navy: 5, coral: 6 },
      { navy: 4, coral: 7 },
      { navy: 6, coral: 7 },
      { navy: 5, coral: 8 },
      { navy: 4, coral: 6 },
      { navy: 3, coral: 5 },
    ],
  },
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Susu and savings collected per month against collector targets — the
 *  monthly roll-up of GET /reports/collections. Units are GH₵ hundreds, so
 *  660 reads as GH₵66.0K. */
const COLLECTED = [420, 350, 260, 430, 660, 320, 300, 380, 150, 230, 390, 320];
const EXPECTED = [380, 250, 340, 300, 560, 480, 420, 610, 690, 260, 480, 200];
const ghK = (v: number) => `GH₵${(v / 10).toFixed(1)}K`;

const DAYS = ["s", "m", "t", "w", "t", "f", "s"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The three books the branch's money sits in. */
const MIX_META = [
  { label: "Susu held", color: CORAL },
  { label: "Savings", color: NAVY },
  { label: "Credit out", color: SKY },
];

/** Daily match rate of collector postings against the ledger. */
const RECON_POINTS: [number, number][] = [
  [8, 92],
  [40, 58],
  [72, 96],
  [104, 36],
  [136, 98],
  [160, 66],
  [186, 40],
  [218, 88],
  [250, 52],
  [282, 78],
  [312, 58],
];
const RECON_PCT = [72, 86, 70, 94, 69, 83, 92, 74, 88, 78, 86];
const RECON_DOTS = [1, 3, 6, 8, 10];

const TRANSACTIONS = [
  {
    id: "TX-58291",
    date: "27 Aug, 09:12",
    customer: "Ama Serwaa",
    account: "SU-0142",
    type: "Susu deposit",
    dot: "var(--color-module-susu)",
    amount: "+GH₵ 250.00",
    out: false,
    status: "Completed" as const,
  },
  {
    id: "TX-58287",
    date: "27 Aug, 08:47",
    customer: "Kwame Mensah",
    account: "SV-0287",
    type: "Savings withdrawal",
    dot: "var(--color-module-savings)",
    amount: "−GH₵ 1,200.00",
    out: true,
    status: "Completed" as const,
  },
  {
    id: "TX-58280",
    date: "26 Aug, 16:03",
    customer: "Abena Osei",
    account: "LN-0051",
    type: "Loan repayment",
    dot: "var(--color-module-loans)",
    amount: "+GH₵ 860.00",
    out: false,
    status: "Completed" as const,
  },
  {
    id: "TX-58274",
    date: "26 Aug, 14:38",
    customer: "Yaw Boateng",
    account: "HP-0009",
    type: "Hire purchase payment",
    dot: "var(--color-module-hp)",
    amount: "+GH₵ 430.00",
    out: false,
    status: "Pending" as const,
  },
  {
    id: "TX-58269",
    date: "26 Aug, 11:21",
    customer: "Efua Asante",
    account: "SV-0198",
    type: "Savings deposit",
    dot: "var(--color-module-savings)",
    amount: "+GH₵ 2,000.00",
    out: false,
    status: "Completed" as const,
  },
];

/** The sample rows as a file, so Export hands over something real. */
function exportCsv(rows: typeof TRANSACTIONS) {
  const lines = [
    "Reference,Date,Customer,Account,Type,Amount,Status",
    ...rows.map((tx) =>
      [tx.id, tx.date, tx.customer, tx.account, tx.type, tx.amount, tx.status]
        .map((cell) => `"${cell}"`)
        .join(","),
    ),
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "yadah-transactions-sample.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Tween a number to its target — the gauge counts instead of snapping. */
function useAnimatedNumber(target: number): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  shownRef.current = shown;

  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(target);
      return;
    }
    const start = performance.now();
    const duration = 500;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return shown;
}

/* --------------------------------------------------------------------- page --- */

export default function Dashboard(_: Route.ComponentProps) {
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [query, setQuery] = useState("");
  const p = PERIODS[period];

  const q = query.trim().toLowerCase();
  const visibleTx = q
    ? TRANSACTIONS.filter((tx) =>
        [tx.customer, tx.account, tx.type, tx.id, tx.status]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : TRANSACTIONS;

  return (
    <div className="min-h-full bg-background px-5 pt-1 pb-5 text-foreground sm:px-8">
      {/* ------------------------------------------------------- KPI row --- */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Stat value={p.customers} label="Total Customers" icon={UsersIcon} tint={1} />
        <Stat value={p.accounts} label="Active Accounts" icon={IdCardIcon} tint={3} />
        <Stat value={p.pendingPayouts} label="Pending Susu Payouts" icon={ClipboardListIcon} tint={2} />
        <Stat
          value={p.collected}
          label="Amount Collected"
          icon={BanknoteIcon}
          tint={1}
          delta={p.collectedDelta}
        />
        <Stat value={p.inArrears} label="In Arrears" icon={CircleAlertIcon} tint={4} />
      </div>

      {/* ----------------------------------------------------- two columns --- */}
      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.66fr)_minmax(0,1fr)]">
        {/* left column */}
        <div className="space-y-4">
          <Card title="Collections Performance" detailTo="/reports/collections">
            <CollectionsChart />
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Cash Flow Analytics" detailTo="/transactions">
              <CashFlow key={period} columns={p.cash} inflow={p.inflow} outflow={p.outflow} />
            </Card>
            <Card title="Portfolio Mix" detailTo="/reports">
              <PortfolioDonut key={period} values={p.mix} total={p.bookTotal} />
            </Card>
          </div>
        </div>

        {/* right column */}
        <div className="space-y-4">
          <div className="flex justify-end gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                {p.label}
                <ChevronDownIcon className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(Object.keys(PERIODS) as PeriodKey[]).map((key) => (
                  <DropdownMenuItem key={key} onSelect={() => setPeriod(key)}>
                    {PERIODS[key].label}
                    {key === period && <CheckIcon className="ml-auto size-3.5" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              onClick={() => exportCsv(visibleTx)}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              Export
              <UploadIcon className="size-3" />
            </button>
          </div>

          <Card title="Collection Efficiency" centered plain>
            <Gauge value={p.efficiency} />
          </Card>

          <Card title="System notifications and alerts" detailTo="/reports/loans">
            <div className="space-y-5">
              <Notice
                accent={NAVY}
                title="Loans Slipping Into Arrears"
                body="3 loans crossed 30 days overdue this week — portfolio at risk is now 6.2% of the credit book."
                to="/reports/loans"
              />
              <Notice
                accent={SKY}
                title="Susu Payouts Awaiting Approval"
                body="14 completed cycles are due GH₵12.4K in payouts to their customers."
                to="/susu/summary"
              />
            </div>
          </Card>

          <Card title="Collections Reconciliation" detailTo="/reports">
            <ReconTrend />
          </Card>
        </div>
      </div>

      {/* ------------------------------------------------- transactions table --- */}
      <div className="mt-4">
        <Card
          title="Recent Transactions"
          detailTo="/transactions"
          aside={
            <label className="flex w-40 items-center gap-2 rounded-full bg-secondary px-3 py-1.5 focus-within:ring-2 focus-within:ring-ring/40 sm:w-52">
              <SearchIcon className="size-3 shrink-0 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter these rows..."
                className="w-full bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
              />
            </label>
          }
        >
          <TransactionsTable rows={visibleTx} query={query} />
        </Card>
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Sample figures — the reporting API is not connected yet, so every number
        on this page is invented.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- chrome bits --- */

/** The white card every block sits in, with the reference header row.
 *  `detailTo` makes See Detail and the ⋯ menu real doors into the module. */
function Card({
  title,
  detailTo,
  centered = false,
  plain = false,
  aside,
  children,
}: {
  title: string;
  detailTo?: string;
  /** Centered title, no buttons — the gauge card in the reference. */
  centered?: boolean;
  plain?: boolean;
  /** Extra control rendered beside the header buttons — e.g. a row filter. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-card p-4 text-card-foreground sm:p-5">
      <header
        className={cn(
          "mb-4 flex flex-wrap items-center gap-2",
          centered ? "justify-center" : "justify-between",
        )}
      >
        <h3 className="text-[15px] font-bold tracking-tight">{title}</h3>
        {!plain && detailTo && (
          <div className="flex flex-wrap items-center gap-1.5">
            {aside}
            <Link
              to={detailTo}
              className="rounded-full border border-border bg-card px-3 py-1 text-[10.5px] font-medium"
            >
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
                  <Link to={detailTo}>Open full report</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>
      {children}
    </section>
  );
}

function Stat({
  value,
  label,
  icon: Icon,
  tint,
  delta,
}: {
  value: string;
  label: string;
  icon: typeof IdCardIcon;
  /** Which avatar-tint family colours the icon square — themed in both modes. */
  tint: 1 | 2 | 3 | 4;
  /** A small reading against the previous day, coral when up, muted when down. */
  delta?: { text: string; up: boolean };
}) {
  return (
    <div className="relative rounded-2xl bg-card p-4">
      <span
        className="absolute top-3.5 right-3.5 rounded-lg p-2"
        style={{ background: `var(--tint-${tint}-bg)` }}
      >
        <Icon className="size-4" style={{ color: `var(--tint-${tint}-fg)` }} />
      </span>
      {/* keyed so a period change re-enters the number instead of snapping */}
      <p
        key={value}
        className="animate-in fade-in slide-in-from-bottom-1 text-[22px] font-bold tracking-tight duration-300 motion-reduce:animate-none"
      >
        {value}
      </p>
      <p className="mt-1 pr-10 text-xs text-muted-foreground">{label}</p>
      {delta && (
        <p
          key={delta.text}
          className="animate-in fade-in mt-1 text-[10px] font-medium duration-300 motion-reduce:animate-none"
          style={{ color: delta.up ? ACCENT : MUTED }}
        >
          {delta.up ? "▲" : "▼"} {delta.text}
        </p>
      )}
    </div>
  );
}

function Notice({
  accent,
  title,
  body,
  to,
}: {
  accent: string;
  title: string;
  body: string;
  to: string;
}) {
  return (
    <div className="border-l-2 pl-3" style={{ borderColor: accent }}>
      <p className="text-[13px] font-semibold">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
      <Link
        to={to}
        className="mt-2.5 inline-block rounded-full bg-primary px-3.5 py-1.5 text-[11px] font-medium text-primary-foreground transition-transform duration-150 hover:scale-[1.03] motion-reduce:transition-none"
      >
        Take Action
      </Link>
    </div>
  );
}

/* ------------------------------------------------------- collections chart --- */

const FX0 = 42;
const FX1 = 632;
const FY0 = 12;
const FY1 = 188;
const fx = (i: number) => FX0 + (i * (FX1 - FX0)) / (MONTHS.length - 1);
const fy = (v: number) => FY1 - (v / 800) * (FY1 - FY0);

function CollectionsChart() {
  // The pinned reading follows the pointer, month by month. May to start with,
  // as in the reference frame.
  const [focus, setFocus] = useState(4);

  const collected = COLLECTED.map((v, i) => `${fx(i)},${fy(v)}`).join(" ");
  const expected = EXPECTED.map((v, i) => `${fx(i)},${fy(v)}`).join(" ");
  const px = fx(focus);
  const py = fy(COLLECTED[focus]);
  const area = `M ${FX0} ${FY1} ${COLLECTED.map((v, i) => `L ${fx(i)} ${fy(v)}`).join(" ")} L ${FX1} ${FY1} Z`;

  const delta =
    focus > 0 ? ((COLLECTED[focus] - COLLECTED[focus - 1]) / COLLECTED[focus - 1]) * 100 : null;
  const flip = focus >= 8; // keep the tooltip inside the frame on the right edge
  const step = (FX1 - FX0) / (MONTHS.length - 1);

  return (
    <svg viewBox="0 0 640 252" className="h-auto w-full" role="img" aria-label="Collected against expected, by month">
      <defs>
        <radialGradient id="collect-glow" gradientUnits="userSpaceOnUse" cx={px} cy={py} r={130}>
          <stop offset="0%" stopColor="#F0503A" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#F0503A" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* month gridlines */}
      {MONTHS.map((_, i) => (
        <line key={i} x1={fx(i)} y1={FY0} x2={fx(i)} y2={FY1} strokeWidth="1" style={{ stroke: BORDER }} />
      ))}

      {/* y-axis, in GH₵ thousands */}
      {[0, 200, 400, 600, 800].map((v) => (
        <text key={v} x={FX0 - 12} y={fy(v) + 3} textAnchor="end" fontSize="9" style={{ fill: MUTED }}>
          {v === 0 ? "0" : `${v / 10}K`}
        </text>
      ))}

      {/* glow under the coral line, concentrated around the pinned point */}
      <path d={area} fill="url(#collect-glow)" />

      <polyline points={expected} fill="none" strokeWidth="2" strokeLinejoin="round" style={{ stroke: NAVY }} />
      <polyline points={collected} fill="none" strokeWidth="2" strokeLinejoin="round" style={{ stroke: CORAL }} />

      {/* the pinned reading — the whole group slides to the hovered month */}
      <g className={SLIDE} style={{ transform: `translate(${px}px, ${py}px)` }}>
        <line x1="0" y1="0" x2="0" y2={FY1 - py} strokeWidth="1" strokeDasharray="3 3" style={{ stroke: FG }} />
        <circle cx="0" cy="0" r="4.5" strokeWidth="2" style={{ fill: CORAL, stroke: "var(--color-card)" }} />
      </g>

      <g pointerEvents="none" className={SLIDE} style={{ transform: `translate(${px}px, 0)` }}>
        <rect x={flip ? -152 : 14} y={FY0 + 8} width="138" height="46" rx="11" fill={TIP} />
        <circle cx={(flip ? -152 : 14) + 14} cy={FY0 + 23} r="3" style={{ fill: CORAL }} />
        <text x={(flip ? -152 : 14) + 22} y={FY0 + 26} fontSize="9" fill="#B9BDC4">
          Collected <tspan fill="#fff" fontWeight="700">{ghK(COLLECTED[focus])}</tspan>
        </text>
        <circle cx={(flip ? -152 : 14) + 14} cy={FY0 + 39} r="3" style={{ fill: SKY }} />
        <text x={(flip ? -152 : 14) + 22} y={FY0 + 42} fontSize="9" fill="#B9BDC4">
          Expected <tspan fill="#fff" fontWeight="700">{ghK(EXPECTED[focus])}</tspan>
        </text>
      </g>

      {delta !== null && (
        <g pointerEvents="none" className={SLIDE} style={{ transform: `translate(${px}px, 0)` }}>
          <rect x="-22" y="148" width="44" height="17" rx="8.5" style={{ fill: ACCENT }} />
          <text x="0" y="160" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#fff">
            {delta >= 0 ? "+" : "−"}
            {Math.abs(delta).toFixed(1)}%
          </text>
        </g>
      )}

      {/* the segment bar and month labels from the reference */}
      {MONTHS.map((month, i) => (
        <g key={month + i}>
          <rect
            x={fx(i) - 16}
            y={202}
            width="32"
            height="5"
            rx="2.5"
            style={{
              fill: i === focus ? MUTED : BORDER,
              transition: "fill 200ms",
            }}
          />
          <text
            x={fx(i)}
            y={230}
            textAnchor="middle"
            fontSize="9.5"
            style={{ fill: i === focus ? FG : MUTED, transition: "fill 200ms" }}
          >
            {month}
          </text>
        </g>
      ))}

      {/* invisible hover strips, one per month */}
      {MONTHS.map((_, i) => (
        <rect
          key={`hit${i}`}
          x={fx(i) - step / 2}
          y={0}
          width={step}
          height={240}
          fill="transparent"
          onMouseEnter={() => setFocus(i)}
        />
      ))}
    </svg>
  );
}

/* ---------------------------------------------------------------- cash flow --- */

function CashFlow({
  columns,
  inflow,
  outflow,
}: {
  columns: { navy: number; coral: number }[];
  inflow: string;
  outflow: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div className="animate-in fade-in duration-300 motion-reduce:animate-none">
      <div className="mb-4 flex flex-col items-end gap-1 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: CORAL }} />
          <span className="text-muted-foreground">Inflow</span>
          <span className="font-bold">{inflow}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: NAVY }} />
          <span className="text-muted-foreground">Outflow</span>
          <span className="font-bold">{outflow}</span>
        </span>
      </div>

      <div className="flex items-start justify-between px-1" onMouseLeave={() => setHovered(null)}>
        {columns.map((col, i) => (
          <div
            key={i}
            className={cn(
              "relative flex flex-col items-center gap-1.25 transition-opacity duration-200",
              hovered !== null && hovered !== i && "opacity-40",
            )}
            onMouseEnter={() => setHovered(i)}
          >
            {hovered === i && (
              <span
                className="animate-in fade-in zoom-in-95 absolute -top-8 left-1/2 z-10 -translate-x-1/2 rounded-full px-2.5 py-1 text-[9px] font-medium whitespace-nowrap text-white duration-150 motion-reduce:animate-none"
                style={{ background: TIP }}
              >
                {DAY_NAMES[i]} · In GH₵{(col.coral * 1.35).toFixed(1)}K · Out GH₵
                {(col.navy * 1.28).toFixed(1)}K
              </span>
            )}
            {Array.from({ length: col.navy }, (_, j) => (
              <span
                key={`n${j}`}
                className="h-2.75 w-7 rounded-full"
                style={{ background: NAVY, opacity: 1 - j * 0.07 }}
              />
            ))}
            {Array.from({ length: col.coral }, (_, j) => (
              <span
                key={`c${j}`}
                className="h-2.75 w-7 rounded-full"
                style={{ background: CORAL, opacity: Math.max(0.14, 0.95 - j * 0.13) }}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="mt-3 flex justify-between px-1">
        {DAYS.map((day, i) => (
          <span key={day + i} className="w-7 text-center text-[10px] text-muted-foreground">
            {day}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- donut --- */

/** Point on a circle, angle in degrees clockwise from 12 o'clock. */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function PortfolioDonut({ values, total }: { values: [number, number, number]; total: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const cx = 100;
  const cy = 96;
  const r = 66;

  // The three books share the 270° that is not gap, in proportion — so the
  // period switch genuinely redraws the ring. Drawn credit-first from the top,
  // like the reference. Endpoint gaps are wide because the round caps grow
  // each arc back out; what survives on screen is a slim slot.
  const GAP = 30;
  const sum = values[0] + values[1] + values[2];
  const spans = values.map((v) => (270 * v) / sum);
  // display order around the ring: sky (credit), navy (savings), coral (susu)
  const order = [2, 1, 0];
  let cursor = -spans[2] / 2;
  const arcs = order.map((idx) => {
    const from = cursor;
    const to = cursor + spans[idx];
    cursor = to + GAP;
    return { idx, from, to };
  });

  const ticks = Array.from({ length: 72 }, (_, i) => {
    const [x1, y1] = polar(cx, cy, 34, i * 5);
    const [x2, y2] = polar(cx, cy, 40, i * 5);
    return [x1, y1, x2, y2] as const;
  });

  return (
    <div className="animate-in fade-in duration-300 motion-reduce:animate-none">
      <svg
        viewBox="0 0 200 196"
        className="mx-auto h-auto w-full max-w-56"
        role="img"
        aria-label={`Portfolio mix — ${total} across susu, savings and credit`}
      >
        {ticks.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="1.2" style={{ stroke: BORDER }} />
        ))}
        {arcs.map(({ idx, from, to }) => (
          <path
            key={idx}
            d={arcPath(cx, cy, r, from, to)}
            fill="none"
            strokeWidth={hovered === idx ? 28 : 24}
            strokeLinecap="round"
            className="cursor-pointer"
            style={{ stroke: MIX_META[idx].color, transition: "stroke-width 150ms" }}
            onMouseEnter={() => setHovered(idx)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
        {hovered === null ? (
          <>
            <text x={cx} y={cy + 2} textAnchor="middle" fontSize="17" fontWeight="700" style={{ fill: FG }} pointerEvents="none">
              {total}
            </text>
            <text x={cx} y={cy + 16} textAnchor="middle" fontSize="8.5" style={{ fill: MUTED }} pointerEvents="none">
              total book
            </text>
          </>
        ) : (
          <>
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize="24" fontWeight="700" style={{ fill: FG }} pointerEvents="none">
              {values[hovered]}%
            </text>
            <text x={cx} y={cy + 20} textAnchor="middle" fontSize="9" style={{ fill: MUTED }} pointerEvents="none">
              {MIX_META[hovered].label}
            </text>
          </>
        )}
      </svg>

      <div className="mt-4 flex justify-around">
        {MIX_META.map((item, i) => (
          <button
            key={item.label}
            className="cursor-pointer text-center"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(i)}
            onBlur={() => setHovered(null)}
          >
            <span className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: item.color }} />
              {item.label}
            </span>
            <span className="mt-1 block text-base font-bold">{values[i]}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- gauge --- */

function lerpColor(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(",")})`;
}

function Gauge({ value }: { value: number }) {
  const shown = useAnimatedNumber(value);
  const cx = 140;
  const cy = 142;
  const count = 64;
  const ticks = Array.from({ length: count }, (_, i) => {
    const deg = 180 - (i * 180) / (count - 1); // sweep left → right
    const rad = (deg * Math.PI) / 180;
    // A deterministic "waveform" — random lengths would tear hydration apart.
    const len = 12 + 20 * (0.5 + 0.5 * Math.sin(i * 1.7)) + 6 * (0.5 + 0.5 * Math.sin(i * 0.37));
    const r1 = 88;
    const r2 = 96 + len;
    return {
      x1: cx + r1 * Math.cos(rad),
      y1: cy - r1 * Math.sin(rad),
      x2: cx + r2 * Math.cos(rad),
      y2: cy - r2 * Math.sin(rad),
      // The gradient runs between the reference's saturated ends — bright
      // enough to hold on the dark canvas too.
      color: lerpColor("#EE3D22", "#74A5D7", i / (count - 1)),
    };
  });

  return (
    <svg viewBox="0 0 280 152" className="mx-auto h-auto w-full max-w-80" role="img" aria-label={`Collection efficiency: ${value}%`}>
      {ticks.map((tick, i) => (
        <line
          key={i}
          x1={tick.x1}
          y1={tick.y1}
          x2={tick.x2}
          y2={tick.y2}
          stroke={tick.color}
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}
      {/* the three reference markers: ends pointing in, apex pointing down */}
      <polygon points="2,136 2,148 12,142" style={{ fill: FG }} />
      <polygon points="278,136 278,148 268,142" style={{ fill: FG }} />
      <polygon points="134,2 146,2 140,11" style={{ fill: FG }} />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="34" fontWeight="700" style={{ fill: FG }}>
        {shown}%
      </text>
    </svg>
  );
}

/* ---------------------------------------------------------------- recon wave --- */

function smoothPath(pts: [number, number][]): string {
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function ReconTrend() {
  // The dashed reading slides along the wave under the pointer. Point 5 —
  // dead centre, 83% — is where the reference pins it.
  const [focus, setFocus] = useState(5);

  const line = smoothPath(RECON_POINTS);
  const area = `${line} L 312 118 L 8 118 Z`;
  const markX = RECON_POINTS[focus][0];

  return (
    <div>
      <svg
        viewBox="0 0 320 126"
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label={`Collections reconciliation trend, currently ${RECON_PCT[focus]}%`}
      >
        <defs>
          <linearGradient id="recon-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#74A5D7" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#74A5D7" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        <path d={area} fill="url(#recon-fill)" />
        <path d={line} fill="none" strokeWidth="1.5" style={{ stroke: SKY }} />

        {RECON_DOTS.map((i) => (
          <circle
            key={i}
            cx={RECON_POINTS[i][0]}
            cy={RECON_POINTS[i][1]}
            r="4"
            strokeWidth="2"
            style={{ fill: SKY, stroke: "var(--color-card)" }}
          />
        ))}

        {/* the reading slides along the wave */}
        <g className={SLIDE} style={{ transform: `translate(${markX}px, 0)` }} pointerEvents="none">
          <line x1="0" y1="28" x2="0" y2="118" strokeWidth="1" strokeDasharray="3 3" style={{ stroke: FG }} />
          <text x="0" y="18" textAnchor="middle" fontSize="15" fontWeight="700" style={{ fill: FG }}>
            {RECON_PCT[focus]}%
          </text>
          <polygon points="-4,118 4,118 0,125" style={{ fill: FG }} />
        </g>

        {/* invisible hover strips, one per reading */}
        {RECON_POINTS.map(([x], i) => (
          <rect
            key={`hit${i}`}
            x={x - 15}
            y={0}
            width={30}
            height={126}
            fill="transparent"
            onMouseEnter={() => setFocus(i)}
          />
        ))}
      </svg>

      <div className="relative mt-1.5">
        <div
          className="h-2 w-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${CORAL}, ${NAVY} 55%, ${SKY})` }}
          aria-hidden
        />
        <span
          className="absolute inset-y-0 w-0.5 bg-card transition-[left] duration-300 ease-out motion-reduce:transition-none"
          style={{ left: `calc(${((markX / 320) * 100).toFixed(1)}% - 1px)` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- transactions --- */

function TransactionsTable({
  rows,
  query,
}: {
  rows: typeof TRANSACTIONS;
  query: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-2xl text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
            <th className="pb-2.5 font-medium">Date</th>
            <th className="pb-2.5 font-medium">Customer</th>
            <th className="pb-2.5 font-medium">Account</th>
            <th className="pb-2.5 font-medium">Type</th>
            <th className="pb-2.5 text-right font-medium">Amount</th>
            <th className="pb-2.5 pl-6 font-medium">Status</th>
            <th className="pb-2.5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="py-6 text-center text-xs text-muted-foreground">
                No transactions match &ldquo;{query}&rdquo;. Clear the search to
                see all five sample rows.
              </td>
            </tr>
          )}
          {rows.map((tx) => (
            <tr
              key={tx.id}
              className="animate-in fade-in border-b border-border/60 duration-200 last:border-0 motion-reduce:animate-none"
            >
              <td className="py-3 whitespace-nowrap text-muted-foreground">{tx.date}</td>
              <td className="py-3 font-medium whitespace-nowrap">{tx.customer}</td>
              <td className="py-3 whitespace-nowrap text-muted-foreground">{tx.account}</td>
              <td className="py-3 whitespace-nowrap">
                <span className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: tx.dot }} />
                  {tx.type}
                </span>
              </td>
              <td
                className={cn(
                  "py-3 text-right font-semibold whitespace-nowrap tabular-nums",
                  tx.out ? "text-cash-out" : "text-foreground",
                )}
              >
                {tx.amount}
              </td>
              <td className="py-3 pl-6">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-medium",
                    tx.status === "Completed"
                      ? "bg-cash-in-subtle text-cash-in"
                      : "bg-danger-subtle text-danger",
                  )}
                >
                  {tx.status}
                </span>
              </td>
              <td className="py-3 pl-3 text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Actions for ${tx.id}`}
                    className="inline-flex size-6 items-center justify-center rounded-full border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <EllipsisIcon className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link to="/transactions">Open the ledger</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/customers">Open customer book</Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
