import {
  ArrowRightLeftIcon,
  CoinsIcon,
  HandCoinsIcon,
  PiggyBankIcon,
  Undo2Icon,
  WalletIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  data,
  Link,
  Outlet,
  useFetcher,
  useLocation,
  useNavigation,
  useSubmit,
} from "react-router";
import { toast } from "sonner";

import {
  getCommissionSummary,
  listCommissionMoves,
  listCommissions,
  undoCommissionMove,
} from "~/api/commissions";
import { ApiError } from "~/api/error";
import { FilterRail, RailFrame } from "~/components/filter-rail";
import {
  DayRangeChip,
  DayRangeFilter,
  FilterBar,
  FilterChip,
  ListingFooter,
  SearchBox,
} from "~/components/listing";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  accountPath,
  COMMISSION_REASON_LABELS,
  COMMISSION_SOURCE_LABELS,
  COMMISSION_SOURCES,
  type Commission,
  type CommissionMove,
  type CommissionSource,
} from "~/lib/commissions";
import { formatAccraDate, formatPesewas } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/commissions";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Commission · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = {
  title: "Commission account",
};

const PAGE_SIZE = 10;

/** The rail's views: every entry, one source, or the moves out. */
type View = "all" | CommissionSource | "moves";
const VIEWS: readonly View[] = ["all", ...COMMISSION_SOURCES, "moves"];

interface Filters {
  view: View;
  q: string;
  from: string;
  to: string;
}

function readFilters(url: URL): Filters {
  const view = url.searchParams.get("view") as View | null;
  return {
    view: view && VIEWS.includes(view) ? view : "all",
    q: url.searchParams.get("q")?.trim() ?? "",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.view !== "all") p.set("view", f.view);
  if (f.q && f.view !== "moves") p.set("q", f.q);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (page > 1) p.set("page", String(page));
  return p;
}

function hrefFor(f: Filters, page = 1): string {
  const s = queryFor(f, page).toString();
  return s ? `/commissions?${s}` : "/commissions";
}

/**
 * `GET /commissions` — Yadah's commission account.
 *
 * Susu commission, savings fees and loan processing fees land here as they
 * are earned, taken out of the cash account the money physically sits in.
 * Office staff move it on to a cash account of their choosing; until then it
 * is shown apart, so nobody mistakes it for a customer's money or counts it
 * twice.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);
  const filters = readFilters(url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const range = { from: filters.from || undefined, to: filters.to || undefined };

  const { data: result, headers } = await withAuth(request, async (token) => {
    const [summary, entries, moves] = await Promise.all([
      getCommissionSummary(token),
      listCommissions(token, {
        ...range,
        q: filters.q || undefined,
        source: filters.view === "all" || filters.view === "moves" ? undefined : filters.view,
        page: filters.view === "moves" ? 1 : page,
        limit: filters.view === "moves" ? 1 : PAGE_SIZE,
      }),
      listCommissionMoves(token, {
        ...range,
        page: filters.view === "moves" ? page : 1,
        limit: filters.view === "moves" ? PAGE_SIZE : 1,
      }),
    ]);
    return { summary, entries, moves };
  });

  return data(
    {
      filters,
      page,
      summary: result.summary,
      entries: result.entries.items,
      entriesTotal: result.entries.total,
      totals: result.entries.totals,
      moves: result.moves.items,
      movesTotal: result.moves.total,
      movedInRange: result.moves.totalAmount,
    },
    { headers },
  );
}

/** Opening the move drawer does not re-read the book underneath it. */
export const shouldRevalidate = drawerParentShouldRevalidate;

interface ActionResult {
  ok: boolean;
  message: string;
}

/** Undoing a move, from its row. Moving is the drawer. */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  if (form.get("intent") !== "undo" || !id) {
    return data<ActionResult>({ ok: false, message: "Unknown action." }, { status: 400 });
  }
  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      undoCommissionMove(token, id, "Undone from the commission page"),
    );
    return data<ActionResult>(
      {
        ok: true,
        message: `${formatPesewas(result.move.amount)} is back in the commission account.`,
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data<ActionResult>({ ok: false, message: error.message }, { status: error.status });
    }
    throw error;
  }
}

/* -------------------------------------------------------------------- page --- */

export default function Commissions({ loaderData }: Route.ComponentProps) {
  const {
    filters,
    page,
    summary,
    entries,
    entriesTotal,
    totals,
    moves,
    movesTotal,
    movedInRange,
  } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const { search } = useLocation();
  const fetcher = useFetcher<ActionResult>();
  const [undoing, setUndoing] = useState<CommissionMove | null>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) toast.success(fetcher.data.message);
    else toast.error(fetcher.data.message);
  }, [fetcher.state, fetcher.data]);

  const busy =
    navigation.state === "loading" && navigation.location?.pathname === "/commissions";

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), { replace: true, preventScrollReset: true });

  const showingMoves = filters.view === "moves";
  const ranged = Boolean(filters.from || filters.to);
  const narrowed = Boolean((filters.q && !showingMoves) || ranged);

  // Amounts rather than counts beside each view: the question here is how
  // much, and the rail answers it before anything is opened.
  const sections = [
    {
      label: "Earned",
      items: [
        {
          key: "all",
          label: (
            <RailLabel
              name="Everything"
              amount={COMMISSION_SOURCES.reduce((sum, s) => sum + totals.bySource[s], 0)}
            />
          ),
          icon: CoinsIcon,
          to: hrefFor({ ...filters, view: "all" }),
        },
        ...COMMISSION_SOURCES.map((s) => ({
          key: s,
          label: <RailLabel name={COMMISSION_SOURCE_LABELS[s]} amount={totals.bySource[s]} />,
          icon: s === "susu" ? HandCoinsIcon : s === "savings-fee" ? PiggyBankIcon : WalletIcon,
          to: hrefFor({ ...filters, view: s }),
        })),
      ],
    },
    {
      label: "Moved out",
      items: [
        {
          key: "moves",
          label: <RailLabel name="To cash accounts" amount={movedInRange} />,
          icon: ArrowRightLeftIcon,
          to: hrefFor({ ...filters, view: "moves" }),
        },
      ],
    },
  ];

  const searchBox = (
    <SearchBox
      value={showingMoves ? "" : filters.q}
      apply={(next) => apply({ q: next, view: showingMoves ? "all" : filters.view })}
      hidden={{
        view: filters.view === "all" || showingMoves ? "" : filters.view,
        from: filters.from,
        to: filters.to,
      }}
      placeholder="Customer or account number"
      label="Search commission"
      busy={busy}
      className="sm:w-full"
    />
  );

  const dayRange = (align: "start" | "end") => (
    <DayRangeFilter
      from={filters.from}
      to={filters.to}
      title={showingMoves ? "Moved" : "Earned"}
      align={align}
      apply={(next) => apply(next)}
    />
  );

  return (
    <RailFrame
      rail={({ horizontal }) =>
        horizontal ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">{searchBox}</div>
              {dayRange("end")}
            </div>
            <FilterRail
              label="Commission views"
              sections={sections}
              active={filters.view}
              horizontal
            />
          </div>
        ) : (
          <FilterRail
            label="Commission views"
            sections={sections}
            active={filters.view}
            header={searchBox}
            footer={
              <>
                <h3 className="mb-1.5 flex items-center gap-2 px-2 pt-1 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                  Dates
                </h3>
                <div className="[&>button]:w-full [&>button]:justify-start">
                  {dayRange("start")}
                </div>
              </>
            }
          />
        )
      }
    >
      <div className="space-y-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button asChild size="sm">
            <Link to={`/commissions/move${search}`} prefetch="intent" preventScrollReset>
              <ArrowRightLeftIcon />
              Move to a cash account
            </Link>
          </Button>
        </div>

        {/* The account itself, all time: the filters narrow the list, never
            what the account holds. */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat
            label="In the commission account"
            value={formatPesewas(summary.balance)}
            note="Earned and not yet moved"
            tone="revenue"
          />
          <Stat
            label="Earned, all time"
            value={formatPesewas(summary.earned.total)}
            note={`Susu ${formatPesewas(summary.earned.bySource.susu)} · savings ${formatPesewas(summary.earned.bySource["savings-fee"])}`}
            tone="in"
          />
          <Stat
            label="Loan processing fees"
            value={formatPesewas(summary.earned.bySource["loan-fee"])}
            note="All time"
            tone="in"
          />
          <Stat
            label="Moved to cash accounts"
            value={formatPesewas(summary.moved)}
            note="All time"
            tone="neutral"
          />
        </div>

        <section className="overflow-hidden rounded-2xl bg-card pt-2 text-card-foreground">
          {narrowed && (
            <FilterBar
              total={showingMoves ? movesTotal : entriesTotal}
              noun={showingMoves ? "move" : "entry"}
              plural={showingMoves ? "moves" : "entries"}
            >
              {filters.q && !showingMoves && (
                <FilterChip onDrop={() => apply({ q: "" })} label={`“${filters.q}”`} />
              )}
              {ranged && (
                <DayRangeChip
                  from={filters.from}
                  to={filters.to}
                  onDrop={() => apply({ from: "", to: "" })}
                />
              )}
            </FilterBar>
          )}

          <div className={cn("overflow-x-auto px-4 transition-opacity sm:px-5", busy && "opacity-60")}>
            {showingMoves ? (
              <MovesTable moves={moves} onUndo={setUndoing} />
            ) : (
              <EntriesTable entries={entries} />
            )}
            {(showingMoves ? moves : entries).length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {narrowed
                  ? "Nothing matches these filters."
                  : showingMoves
                    ? "Nothing has been moved out yet."
                    : "No commission or fees earned yet."}
              </p>
            )}
          </div>

          <ListingFooter
            page={page}
            pageSize={PAGE_SIZE}
            total={showingMoves ? movesTotal : entriesTotal}
            hrefFor={(p) => hrefFor(filters, p)}
          />
        </section>
      </div>

      <AlertDialog open={undoing !== null} onOpenChange={(open) => !open && setUndoing(null)}>
        <AlertDialogContent>
          {undoing && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Undo this move?</AlertDialogTitle>
                <AlertDialogDescription>
                  {formatPesewas(undoing.amount)} goes back into the commission account and out
                  of {undoing.cashAccountName ?? "the cash account"}. Move it again to the right
                  account afterwards.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <Button
                  variant="destructive"
                  onClick={() => {
                    const id = undoing.id;
                    setUndoing(null);
                    void fetcher.submit({ intent: "undo", id }, { method: "post" });
                  }}
                >
                  Undo the move
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* The move drawer renders here, over the book. */}
      <Outlet />
    </RailFrame>
  );
}

function RailLabel({ name, amount }: { name: string; amount: number }) {
  return (
    <span className="flex w-full items-center justify-between gap-3">
      <span className="truncate">{name}</span>
      <span className="tabular text-xs text-muted-foreground">{formatPesewas(amount)}</span>
    </span>
  );
}

const day = (iso: string) => formatAccraDate(iso);

function EntriesTable({ entries }: { entries: Commission[] }) {
  if (entries.length === 0) return null;
  return (
    <table className="w-full min-w-xl text-[13px]">
      <thead>
        <tr className="border-b border-border text-left text-xs font-bold text-foreground [&>th]:py-3">
          <th className="pr-3">Date</th>
          <th className="pr-3">Customer</th>
          <th className="pr-3">Account</th>
          <th className="pr-3">Earned on</th>
          <th className="text-right">Amount · GH₵</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id} className="border-b border-border last:border-0 [&>td]:py-3">
            <td className="pr-3 whitespace-nowrap text-muted-foreground">{day(e.takenAt)}</td>
            <td className="pr-3">
              <Link
                to={`/customers/${e.customerId}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {e.customerName ?? "Customer"}
              </Link>
            </td>
            <td className="pr-3">
              <Link to={accountPath(e)} className="tabular underline-offset-4 hover:underline">
                {e.accountNumber ?? "Open"}
              </Link>
            </td>
            <td className="pr-3">
              <p>{COMMISSION_SOURCE_LABELS[e.source]}</p>
              <p className="text-xs text-muted-foreground">
                {COMMISSION_REASON_LABELS[e.reason]}
                {e.source === "susu" && e.dailyAmount !== undefined && e.cycleNumber !== undefined
                  ? ` · ${formatPesewas(e.dailyAmount)}/day, cycle ${e.cycleNumber}`
                  : ""}
              </p>
            </td>
            <td className="tabular text-right font-medium text-revenue-foreground">
              {formatPesewas(e.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MovesTable({
  moves,
  onUndo,
}: {
  moves: CommissionMove[];
  onUndo: (m: CommissionMove) => void;
}) {
  if (moves.length === 0) return null;
  return (
    <table className="w-full min-w-xl text-[13px]">
      <thead>
        <tr className="border-b border-border text-left text-xs font-bold text-foreground [&>th]:py-3">
          <th className="pr-3">Date</th>
          <th className="pr-3">To</th>
          <th className="pr-3">Note</th>
          <th className="pr-3">By</th>
          <th className="pr-3 text-right">Amount · GH₵</th>
          <th className="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {moves.map((m) => (
          <tr key={m.id} className="border-b border-border last:border-0 [&>td]:py-3">
            <td className="pr-3 whitespace-nowrap text-muted-foreground">
              {day(`${m.occurredOn}T12:00:00Z`)}
            </td>
            <td className="pr-3 font-medium">{m.cashAccountName ?? "A cash account"}</td>
            <td className="pr-3 text-muted-foreground">{m.note ?? "—"}</td>
            <td className="pr-3 text-muted-foreground">{m.recordedByName ?? "Staff"}</td>
            <td className="tabular pr-3 text-right font-medium">{formatPesewas(m.amount)}</td>
            <td className="text-right">
              <Button variant="ghost" size="sm" onClick={() => onUndo(m)}>
                <Undo2Icon />
                Undo
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The KPI tile the ledger pages open with. */
function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: "in" | "revenue" | "neutral";
}) {
  return (
    <div className="rounded-2xl bg-card p-4">
      <p
        key={value}
        className={cn(
          "tabular animate-in fade-in slide-in-from-bottom-1 text-[22px] font-bold tracking-tight duration-300 motion-reduce:animate-none",
          tone === "in" && "text-cash-in",
          tone === "revenue" && "text-revenue-foreground",
          tone === "neutral" && "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs font-medium">{label}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}
