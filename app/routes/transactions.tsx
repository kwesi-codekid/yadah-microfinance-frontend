import { HourglassIcon, UserIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  data,
  Link,
  useFetcher,
  useNavigation,
  useSubmit,
} from "react-router";
import { toast } from "sonner";

import { correctTransaction, proposeCorrection } from "~/api/corrections";
import { getCustomer } from "~/api/customers";
import { ApiError } from "~/api/error";
import { listTransactions } from "~/api/reports";
import { listUsers } from "~/api/users";
import {
  LEDGER_COLUMNS,
  LedgerRowActions,
  LedgerTotals,
  ledgerHaystack,
  toLedgerRow,
  type LedgerRow,
} from "~/components/ledger";
import {
  CorrectTxnDialog,
  whyNotCorrectable,
  type CorrectionOutcome,
} from "~/components/txn-correction";
import { FilterRail, RailFrame, type RailSection } from "~/components/filter-rail";
import {
  DayRangeChip,
  ExportMenu,
  FilterChip,
  ModuleDot,
  PeriodFilter,
  SearchBox,
} from "~/components/listing";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { DataTable } from "~/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { isCounter, isOffice } from "~/lib/auth";
import {
  KIND_NOUNS,
  targetPath,
  type CorrectionKind,
} from "~/lib/corrections";
import { accraDay, accraDaysAgo, formatAmount, parseCedis } from "~/lib/format";
import { PERIOD_PRESETS } from "~/lib/period";
import { MODULES, MODULE_LABELS, type TxnModule } from "~/lib/reports";
import { requireCounter, requireUser, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Correctable } from "./correctable";
import type { Route } from "./+types/transactions";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Transactions · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = {
  title: "Transactions",
};

/** Ten rows, as the customer's statement pages them. */
const PAGE_SIZE = 10;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Filters {
  module: TxnModule | "";
  customerId: string;
  /** Office only: one member of staff's entries. Empty means everyone's. */
  recordedById: string;
  from: string;
  to: string;
  /** Also show Paystack charges still in flight — never counted in the totals. */
  pending: boolean;
}

function readFilters(url: URL, office: boolean): Filters {
  const moduleParam = url.searchParams.get("module") as TxnModule | null;
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : "";
  };
  return {
    module: moduleParam && MODULES.includes(moduleParam) ? moduleParam : "",
    customerId: url.searchParams.get("customerId")?.trim() ?? "",
    // The API ignores it for anyone else, so it is not read for them either.
    recordedById: office ? (url.searchParams.get("recordedById")?.trim() ?? "") : "",
    from: day("from"),
    to: day("to"),
    pending: url.searchParams.get("pending") === "1",
  };
}

function queryFor(f: Filters, page = 1): URLSearchParams {
  const p = new URLSearchParams();
  if (f.module) p.set("module", f.module);
  if (f.customerId) p.set("customerId", f.customerId);
  if (f.recordedById) p.set("recordedById", f.recordedById);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.pending) p.set("pending", "1");
  if (page > 1) p.set("page", String(page));
  return p;
}

/** The API's ceiling on a page — how much of the staff list can be read at once. */
const STAFF_LIMIT = 100;

/**
 * `GET /reports/transactions` — every money event as one list.
 *
 * Open to every role. The office reads the whole branch and may narrow it to
 * one member of staff with the Recorded by menu. Anyone else — a teller, a
 * collector — is narrowed by the API to the entries they recorded themselves,
 * which makes this their end of day: pick the day and the cards say what they
 * took in and what they issued out.
 *
 * The API defaults to the last 30 Accra days when asked for no range. Naming
 * that default here rather than leaving it implicit is what lets the period
 * button, the totals and the export link all state the same days — a total
 * with no period beside it is a figure nobody can check.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const office = isOffice(user);
  const url = new URL(request.url);

  const filters = readFilters(url, office);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  // The resolved range: what was picked, or the API's own default spelled out.
  const range = {
    from: filters.from || accraDaysAgo(29),
    to: filters.to || accraDay(),
  };

  const { data: result, headers } = await withAuth(request, async (token) => {
    const [feed, customer, staff] = await Promise.all([
      listTransactions(token, {
        page,
        limit: PAGE_SIZE,
        module: filters.module || undefined,
        customerId: filters.customerId || undefined,
        recordedById: filters.recordedById || undefined,
        from: range.from,
        to: range.to,
        // Off by default on the API's side, so it is only ever sent as "true".
        includePending: filters.pending ? "true" : undefined,
      }),
      // Only to name the chip. A filter that reads `customerId=8f3c…` tells
      // nobody whose ledger they are looking at.
      filters.customerId
        ? getCustomer(token, filters.customerId)
            .then((r) => r.customer)
            .catch(() => null)
        : Promise.resolve(null),
      // The Recorded by menu — the office's alone, as the staff list is.
      // Best-effort: the ledger must not go down because the staff list did.
      office
        ? listUsers(token, { limit: STAFF_LIMIT }).catch(() => null)
        : Promise.resolve(null),
    ]);
    return { feed, customer, staff };
  });

  const { feed } = result;
  const people = (result.staff?.items ?? [])
    .map((u) => ({ id: u.id, name: u.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return data(
    {
      filters,
      page,
      /** The days on screen, filter or no filter. */
      range,
      /** Whether the range was picked rather than defaulted — what tints the
          button, and what decides whether Clear can be pressed. */
      explicit: Boolean(filters.from || filters.to),
      customerName: result.customer?.fullName ?? null,
      /** Everyone but the office sees only their own entries. */
      office,
      userId: user.id,
      people,
      /** The office corrects a deposit outright; the counter asks. */
      canManage: office,
      /** A collector corrects nothing from here; the counter and office do. */
      canCorrect: isCounter(user),
      total: feed.total,
      totals: feed.totals,
      rows: feed.items.map(toLedgerRow),
    },
    { headers },
  );
}

/**
 * The one thing the ledger changes: a transaction's amount, the same way the
 * record's own page does it. The shared dialog posts here with the kind, the
 * record and the entry named, since unlike a record page this route has none
 * of them in its path.
 */
export async function action({ request }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const kind = String(form.get("kind") ?? "") as CorrectionKind;
  const targetId = String(form.get("targetId") ?? "");
  const txnId = String(form.get("txnId") ?? "");
  const why = String(form.get("reason") ?? "").trim();
  const amount = parseCedis(String(form.get("amount") ?? ""));

  if (!kind || !targetId || !txnId) {
    throw new Response("No entry named.", { status: 400 });
  }
  if (amount == null || amount <= 0) {
    throw new Response("Enter the corrected amount.", { status: 400 });
  }

  try {
    const { data: result, headers } = await withAuth(request, async (token) => {
      switch (intent) {
        case "correct-txn":
          await correctTransaction(token, kind, targetId, txnId, amount);
          return { message: "Corrected." };
        case "propose-correction":
          await proposeCorrection(token, kind, targetId, txnId, {
            amount,
            reason: why,
          });
          return {
            message: "Sent to the office. Nothing changes until they answer.",
          };
        default:
          throw new Response("Unknown action.", { status: 400 });
      }
    });
    return data<CorrectionOutcome>(
      { ok: true, message: result.message },
      { headers },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data<CorrectionOutcome>(
        {
          ok: false,
          message: error.message,
          details:
            typeof error.details === "object" && error.details
              ? (error.details as Record<string, unknown>)
              : undefined,
        },
        { status: error.status },
      );
    }
    throw error;
  }
}

/**
 * The business-wide ledger, drawn the way a customer's statement is drawn.
 *
 * The two screens answer the same question at two scales — what moved, in what
 * order, through which product — so they share one table rather than each
 * inventing its own. The module menu narrows it, the search box picks through what
 * is on screen, and every row carries the same ⋯ menu.
 *
 * Paging is the API's here, not the table's: the ledger is unbounded, so a page
 * is a request. The search is therefore local to the page in hand, and the note
 * under the table says so rather than letting a miss be read as an absence.
 */
export default function Transactions({ loaderData }: Route.ComponentProps) {
  const {
    filters,
    page,
    range,
    explicit,
    customerName,
    canManage,
    canCorrect,
    office,
    userId,
    people,
    total,
    totals,
    rows,
  } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();

  const [search, setSearch] = useState("");

  // The row being corrected, if any. One dialog over the table, opened by
  // whichever menu asked; the ledger re-reads itself when the action answers.
  const [correcting, setCorrecting] = useState<LedgerRow | null>(null);
  const fetcher = useFetcher<CorrectionOutcome>();
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      toast.success(fetcher.data.message);
      setCorrecting(null);
    } else {
      toast.error(fetcher.data.message, {
        description: describe(fetcher.data.details),
      });
    }
  }, [fetcher.state, fetcher.data]);

  const busy =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/transactions";

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), {
      replace: true,
      preventScrollReset: true,
    });

  const goToPage = (next: number) =>
    submit(queryFor(filters, next), { replace: true, preventScrollReset: true });

  const query = search.trim().toLowerCase();
  const visible = query ? rows.filter((row) => ledgerHaystack(row).includes(query)) : rows;

  const columns = LEDGER_COLUMNS;

  const hrefFor = (patch: Partial<Filters>) => `?${queryFor({ ...filters, ...patch }).toString()}`;

  const narrowed = Boolean(
    filters.module || filters.customerId || filters.recordedById || filters.pending,
  );

  // The ways of cutting the ledger, down the rail as the other books draw
  // them. Only the open view's total is known — the API counts what it was
  // asked for — so the others carry no count rather than a misleading zero.
  const sections: RailSection[] = [
    {
      label: "Module",
      items: [
        { key: "", label: "All modules", count: filters.module ? undefined : total, to: hrefFor({ module: "" }) },
        ...MODULES.map((m) => ({
          key: m,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <ModuleDot module={m} />
              {MODULE_LABELS[m]}
            </span>
          ),
          count: filters.module === m ? total : undefined,
          to: hrefFor({ module: m }),
        })),
      ],
    },
  ];
  // Whose entries: the office picks — anyone, themselves, or one colleague.
  // Anyone else sees their own and nothing else, so there is nothing to pick.
  const whoSection: RailSection = {
    label: "Recorded by",
    items: [
      { key: "", label: "Anyone", to: hrefFor({ recordedById: "" }) },
      { key: userId, label: "Me", to: hrefFor({ recordedById: userId }) },
      ...people
        .filter((p) => p.id !== userId)
        .map((p) => ({ key: p.id, label: p.name, to: hrefFor({ recordedById: p.id }) })),
    ],
  };

  const searchBox = (
    <SearchBox
      value={search}
      apply={setSearch}
      placeholder="Customer, account, entry"
      label="Search the transactions on this page"
      className="sm:w-full"
    />
  );

  const period = (align: "start" | "end") => (
    <PeriodFilter
      from={range.from}
      to={range.to}
      active={explicit}
      title="Recorded"
      presets={PERIOD_PRESETS}
      align={align}
      apply={(next) => apply(next)}
    />
  );

  // Mobile-money charges Paystack has not settled yet. They are rows of money
  // that has not moved, so the API leaves them out unless asked, and the
  // totals leave them out either way.
  const pendingToggle = (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={filters.pending}
      onClick={() => apply({ pending: !filters.pending })}
      className={cn(filters.pending && "border-primary/50 text-primary")}
    >
      <HourglassIcon />
      Include pending
    </Button>
  );

  const railHeading = (text: string) => (
    <h3 className="mb-1.5 flex items-center gap-2 px-2 pt-1 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
      {text}
    </h3>
  );

  return (
    <RailFrame
      rail={({ horizontal }) =>
        horizontal ? (
          // Under `lg`: the search and the days on one line, the modules as a
          // strip under them — as the loan book does it.
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-56 flex-1">{searchBox}</div>
              {period("end")}
            </div>
            <FilterRail
              label="Filter transactions by module"
              sections={sections}
              active={filters.module}
              horizontal
            />
            {office && (
              <FilterRail
                label="Filter transactions by who recorded them"
                sections={[whoSection]}
                active={filters.recordedById}
                horizontal
              />
            )}
          </div>
        ) : (
          // Two cards rather than one: a rail lights one item, and the module
          // and the member of staff are chosen independently of each other.
          <div className="space-y-3">
            <FilterRail
              label="Filter transactions by module"
              sections={sections}
              active={filters.module}
              header={searchBox}
              footer={
                <div className="space-y-3">
                  <div>
                    {railHeading("Date recorded")}
                    <div className="[&>button]:h-auto [&>button]:w-full [&>button]:justify-start [&>button]:py-1.5 [&>button]:text-left [&>button]:whitespace-normal">
                      {period("start")}
                    </div>
                  </div>
                  <div className="[&>button]:w-full [&>button]:justify-start">
                    {pendingToggle}
                  </div>
                </div>
              }
            />
            {office && (
              <FilterRail
                label="Filter transactions by who recorded them"
                sections={[whoSection]}
                active={filters.recordedById}
              />
            )}
          </div>
        )
      }
    >
      <div className="space-y-4 px-4 py-6 sm:px-6">
        <LedgerTotals totals={totals} />

        <DataTable
          // What is narrowing the list, as chips — each one let go on its own.
          // The rail is where they are set; this is where they are seen.
          filters={
            <>
              {!office && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                  <UserIcon className="size-3" />
                  Recorded by you
                </span>
              )}
              {query && (
                <FilterChip onDrop={() => setSearch("")} label={`“${search.trim()}”`} />
              )}
              {filters.customerId && (
                <FilterChip
                  onDrop={() => apply({ customerId: "" })}
                  label={
                    <>
                      <UserIcon className="size-3" />
                      {customerName ?? "One customer"}
                    </>
                  }
                />
              )}
              {explicit && (
                <DayRangeChip
                  from={range.from}
                  to={range.to}
                  onDrop={() => apply({ from: "", to: "" })}
                />
              )}
            </>
          }
          actions={
            <>
              {/* Under `lg` the rail is a strip with no room for this. */}
              <span className="lg:hidden">{pendingToggle}</span>
              {/* The export carries the resolved range, so the file covers the
                  days on screen rather than re-defaulting on the API's side. */}
              <ExportMenu
                path="/transactions/export"
                query={queryFor({ ...filters, ...range }).toString()}
                total={total}
                noun="transaction"
              />
            </>
          }
        columns={columns}
        rows={visible}
        rowKey={(row) => `${row.module}-${row.id}`}
        // A search is a local narrowing of the page in hand, so the footer
        // counts the matches; without one the footer is the API's own paging.
        paging={
          query
            ? undefined
            : { page, pageSize: PAGE_SIZE, total, onPageChange: goToPage }
        }
        loading={busy}
        rowActions={(row) => (
          <LedgerRowActions row={row} onCorrect={canCorrect ? setCorrecting : undefined} />
        )}
        noun={{ one: "transaction", many: "transactions" }}
        pageSize={PAGE_SIZE}
        empty={
          query
            ? "Nothing on this page matches that. Clear the search to see the page again."
            : narrowed
              ? "No money moved that way in the days shown. Widen the days, or choose All modules."
              : "No deposit, withdrawal, repayment or transfer was recorded in these days."
        }
      />
      </div>

      {correcting && correcting.kind && (
        <LedgerCorrection
          key={correcting.id}
          kind={correcting.kind}
          targetId={correcting.targetId}
          txnId={correcting.id}
          canManage={canManage}
          fetcher={fetcher}
          onClose={() => setCorrecting(null)}
        />
      )}
    </RailFrame>
  );
}

/* -------------------------------------------------------------- correcting --- */

/**
 * Correcting an entry from the ledger.
 *
 * The row knows the record and the entry, but not what the correction rules
 * need — the daily amount, what the account held, what was still owed,
 * whether this is the newest entry, whether a request is already waiting — so
 * those are read when the item is chosen, from the resource route at
 * `/corrections/check/:kind/:targetId/:txnId`. Nothing is fetched for rows
 * nobody touches. What comes back decides which dialog opens: the correction
 * itself, or the reason it cannot be made.
 *
 * A waiting request is decided on the record's page, not here: the ledger
 * corrects figures, and deciding what a teller asked deserves the row it sits
 * on, with the rest of the record around it.
 */
function LedgerCorrection({
  kind,
  targetId,
  txnId,
  canManage,
  fetcher,
  onClose,
}: {
  kind: CorrectionKind;
  targetId: string;
  txnId: string;
  canManage: boolean;
  fetcher: ReturnType<typeof useFetcher<CorrectionOutcome>>;
  onClose: () => void;
}) {
  const probe = useFetcher<Correctable>();
  // Asked once per opening — the component is keyed by the row, so a second
  // opening is a fresh instance and a fresh read.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    probe.load(`/corrections/check/${kind}/${targetId}/${txnId}`);
  }, [probe, kind, targetId, txnId]);

  const found = probe.data;
  const noun = KIND_NOUNS[kind];

  if (!found) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Correct the {noun}</DialogTitle>
            <DialogDescription>Reading the record…</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const blocked =
    found.error ??
    (found.txn
      ? whyNotCorrectable({
          pending: found.txn.pending,
          locked: found.txn.locked,
          closed: found.closed,
          newest: found.newest,
          noun,
        })
      : "This entry cannot be read right now.");

  if (blocked || !found.context || !found.txn) {
    return (
      <AlertDialog open onOpenChange={(open) => !open && onClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This {noun} cannot be corrected here</AlertDialogTitle>
            <AlertDialogDescription>{blocked}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* A waiting request is decided where it sits. */}
            {found.txn?.pending && (
              <Button asChild variant="outline">
                <Link to={targetPath({ kind, targetId })}>Open the record</Link>
              </Button>
            )}
            <AlertDialogAction onClick={onClose}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <CorrectTxnDialog
      open
      onOpenChange={(open) => !open && onClose()}
      context={found.context}
      targetId={targetId}
      txn={found.txn}
      asking={!canManage}
      fetcher={fetcher}
    />
  );
}

/** The figures an error carries, as one line under the toast. */
function describe(details?: Record<string, unknown>): string | undefined {
  if (!details) return undefined;
  const money = (k: string) =>
    typeof details[k] === "number"
      ? `GH₵ ${formatAmount(details[k] as number)}`
      : null;
  const parts = [
    money("dailyAmount") && `daily ${money("dailyAmount")}`,
    typeof details.remaining === "number" &&
      `${details.remaining} day${details.remaining === 1 ? "" : "s"} left in the cycle`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

