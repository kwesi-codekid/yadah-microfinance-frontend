import {
  BanknoteArrowDownIcon,
  BanknoteArrowUpIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  PencilLineIcon,
  PlusIcon,
  SquareIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { data, Link, Outlet, useFetcher, useNavigate } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { getCustomer } from "~/api/customers";
import { listUsers } from "~/api/users";
import {
  approveCorrection,
  cancelCorrection,
  correctTransaction,
  listCorrections,
  proposeCorrection,
  rejectCorrection,
} from "~/api/corrections";
import {
  changePlanAmount,
  closeAccount,
  getAccount,
  listCycles,
  listDeposits,
  listPayouts,
  restoreDeposit,
  stopPlan,
  trashAccount,
  trashDeposit,
} from "~/api/susu";
import { Figure, LockMeter, Th } from "~/components/susu-bits";
import { describe, toRow } from "~/components/susu-deposits";
import {
  toPending,
  type CorrectionOutcome,
  type PendingCorrection,
} from "~/components/txn-correction";
import { FilterRail, RailFrame, type RailSection } from "~/components/filter-rail";
import { SearchBox } from "~/components/listing";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { CorrectionKind } from "~/lib/corrections";
import { Input } from "~/components/ui/input";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "~/components/ui/table";
import { Label } from "~/components/ui/label";
import { isCounter, isOffice } from "~/lib/auth";
import {
  formatAccraDate,
  formatAccraDateTime,
  formatAmount,
  formatPesewas,
  parseCedis,
  toCedisInput,
} from "~/lib/format";
import { requireCounter, requireUser, withAuth } from "~/lib/session.server";
import { redirectWithToast } from "~/lib/toast.server";
import {
  CYCLE_END_LABELS,
  CYCLE_TARGET,
  MIN_DAILY_AMOUNT,
  planLabel,
  type SusuAccount,
  type SusuCycle,
  type SusuPlan,
} from "~/lib/susu";
import { cn } from "~/lib/utils";
import type { Crumb } from "./app-layout";
import type { Route } from "./+types/susu-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  const n = loaderData?.account.accountNumber ?? "Account";
  return [{ title: `Susu #${n} · Yadah Dynamic Enterprise` }];
}

/** The trail the layout header shows: the book, then whose account this is. */
export const handle = {
  crumbs: (data: unknown): Crumb[] => [
    { label: "Susu", to: "/susu" },
    {
      label:
        (data as { account?: { customerName?: string | null } } | undefined)?.account
          ?.customerName ?? "Account",
    },
  ],
};

/**
 * The whole statement in one read, well inside the API's ceiling of 100 —
 * turning a page is then instant. An account that outgrows this gets the
 * newest hundred, which is what the counter is looking for anyway.
 */
const ALL_ROWS = 100;

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const office = isOffice(user);
  const counter = isCounter(user);

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const { account } = await getAccount(token, params.id);
      const [customer, deposits, payouts, cycles, staff, corrections] = await Promise.all([
        getCustomer(token, account.customerId)
          .then((r) => r.customer)
          .catch(() => null),
        listDeposits(token, params.id, { limit: ALL_ROWS }),
        listPayouts(token, params.id, { limit: ALL_ROWS }),
        listCycles(token, params.id, { limit: ALL_ROWS }),
        // A deposit names its collector by id and nothing else. `/users` is the
        // only place a name lives, and only the office may read it.
        office ? listUsers(token, { limit: ALL_ROWS }).catch(() => null) : Promise.resolve(null),
        // Corrections asked for on this account and not yet answered.
        counter
          ? listCorrections(token, { targetId: params.id, status: "pending", limit: ALL_ROWS }).catch(
              () => null,
            )
          : Promise.resolve(null),
      ]);
      return { account, customer, deposits, payouts, cycles, staff, corrections };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  const names = new Map<string, string>(result.staff?.items.map((u) => [u.id, u.name]) ?? []);
  names.set(user.id, user.name);
  const nameOf = (id: string) => names.get(id) ?? `Staff #${shortId(id)}`;

  const pending = new Map<string, PendingCorrection>(
    result.corrections?.items.map((c) => [c.txnId, toPending(c, user.id)]) ?? [],
  );

  return data(
    {
      /** Correcting outright, trashing, deciding what a teller asked. Office only. */
      canManage: office,
      /** Asking for a correction — the counter's door to one. */
      canCorrect: counter,
      /** Plans, withdrawing, closing — counter work. */
      canServe: counter,
      account: {
        ...result.account,
        customerName: result.customer?.fullName ?? result.account.customerName,
      },
      deposits: {
        total: result.deposits.total,
        items: result.deposits.items.map((d) => ({
          ...toRow(d),
          recordedBy: nameOf(d.collectorId),
          pending: pending.get(d.id) ?? null,
        })),
      },
      cycles: result.cycles.items.map((c) => toCycleRow(c, result.account)),
      /** Money out, newest first, each with its shares on the plans. */
      payouts: {
        total: result.payouts.total,
        items: result.payouts.items.map((p) => ({
          id: p.id,
          amount: p.amount,
          kind: p.kind,
          destination: PAYOUT_DESTINATION_LABELS[p.destination] ?? p.destination,
          lines: p.lines ?? [],
          createdAt: p.createdAt,
          at: formatAccraDateTime(p.createdAt),
          recordedBy: nameOf(p.recordedById),
        })),
      },
    },
    { headers },
  );
}

const PAYOUT_DESTINATION_LABELS: Record<string, string> = {
  cash: "Cash",
  savings: "To savings",
  loan: "Loan repayment",
  "hire-purchase": "Hire purchase payment",
};

/** Opening a drawer does not re-read the account. */
export const shouldRevalidate = drawerParentShouldRevalidate;

function shortId(id: string): string {
  return (
    id
      .replace(/[^a-z0-9]/gi, "")
      .slice(-6)
      .toUpperCase() || id.toUpperCase()
  );
}

interface CycleRow {
  id: string;
  planId: string;
  plan: string;
  cycle: number;
  payments: number;
  target: number;
  /** The plan's amount while this cycle ran — it can change between cycles. */
  dailyAmount: number;
  commission: number;
  reason: string;
  endedAt: string;
}

function toCycleRow(c: SusuCycle, account: SusuAccount): CycleRow {
  const plan = account.plans.find((p) => p.id === c.planId);
  return {
    id: c.id,
    planId: c.planId,
    plan: planLabel(plan ?? { dailyAmount: c.dailyAmount }),
    cycle: c.cycleNumber,
    payments: c.payments,
    target: plan?.cycleTarget || CYCLE_TARGET,
    dailyAmount: c.dailyAmount,
    commission: c.commissionAmount,
    reason: CYCLE_END_LABELS[c.endReason],
    endedAt: formatAccraDate(c.endedAt),
  };
}

type ActionResult = CorrectionOutcome;

/**
 * Everything that changes the account, its plans or its deposits. Counter
 * work and office work both post here — the API refuses what the caller may
 * not do, and the page only offers what they may.
 */
export async function action({ request, params }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const depositId = String(form.get("depositId") ?? "");
  const planId = String(form.get("planId") ?? "");
  const correctionId = String(form.get("correctionId") ?? "");
  const kind = String(form.get("kind") ?? "") as CorrectionKind;
  const txnId = String(form.get("txnId") ?? "");
  const reason = trimmedReason(form.get("reason"));
  const why = String(form.get("reason") ?? "").trim();

  try {
    const { data: result, headers } = await withAuth(request, async (token) => {
      switch (intent) {
        case "close": {
          const { commission, payout } = await closeAccount(token, params.id);
          return {
            message: `Closed. GH₵ ${formatAmount(payout)} paid out, GH₵ ${formatAmount(commission)} commission.`,
            gone: false,
          };
        }
        case "change-plan": {
          const dailyAmount = parseCedis(String(form.get("dailyAmount") ?? ""));
          if (dailyAmount == null || dailyAmount < MIN_DAILY_AMOUNT) {
            throw new Response("Enter the new daily amount.", { status: 400 });
          }
          const { plan } = await changePlanAmount(token, params.id, planId, { dailyAmount });
          return {
            message: `Plan changed to GH₵ ${formatAmount(plan.dailyAmount)} a day.`,
            gone: false,
          };
        }
        case "stop-plan": {
          const { commission } = await stopPlan(token, params.id, planId);
          return {
            message:
              commission > 0
                ? `Plan stopped. GH₵ ${formatAmount(commission)} commission taken.`
                : "Plan stopped. No commission was due.",
            gone: false,
          };
        }
        case "trash-account": {
          await trashAccount(token, params.id, reason);
          return { message: "Account moved to the trash.", gone: true };
        }
        case "correct-txn": {
          const amount = parseCedis(String(form.get("amount") ?? ""));
          if (amount == null || amount <= 0) {
            throw new Response("Enter the corrected amount.", { status: 400 });
          }
          await correctTransaction(token, kind, params.id, txnId, amount);
          return { message: "Deposit corrected.", gone: false };
        }
        case "propose-correction": {
          const amount = parseCedis(String(form.get("amount") ?? ""));
          if (amount == null || amount <= 0) {
            throw new Response("Enter the corrected amount.", { status: 400 });
          }
          await proposeCorrection(token, kind, params.id, txnId, { amount, reason: why });
          return { message: "Sent to the office. Nothing changes until they answer.", gone: false };
        }
        case "approve-correction": {
          const { correction } = await approveCorrection(token, correctionId);
          return {
            message: `Correction applied. The deposit is now GH₵ ${formatAmount(correction.amount)}.`,
            gone: false,
          };
        }
        case "reject-correction": {
          await rejectCorrection(token, correctionId, why);
          return { message: "Correction declined. The deposit is unchanged.", gone: false };
        }
        case "cancel-correction": {
          await cancelCorrection(token, correctionId);
          return { message: "Request taken back.", gone: false };
        }
        case "trash-deposit": {
          await trashDeposit(token, params.id, depositId, reason);
          return { message: "Deposit moved to the trash.", gone: false };
        }
        case "restore-deposit": {
          await restoreDeposit(token, params.id, depositId);
          return { message: "Deposit restored.", gone: false };
        }
        default:
          throw new Response("Unknown action.", { status: 400 });
      }
    });

    if (result.gone) {
      await redirectWithToast("/susu", { tone: "success", message: result.message }, headers);
    }
    return data<ActionResult>({ ok: true, message: result.message }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return data<ActionResult>(
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

/** The API wants at least two characters in a reason, or nothing at all. */
function trimmedReason(value: FormDataEntryValue | null): string | undefined {
  const s = String(value ?? "").trim();
  return s.length >= 2 ? s : undefined;
}

/* -------------------------------------------------------------------- page --- */

export default function SusuDetail({ loaderData }: Route.ComponentProps) {
  const { canServe, account } = loaderData;

  const fetcher = useFetcher<ActionResult>();
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      toast.success(fetcher.data.message);
    } else {
      toast.error(fetcher.data.message, { description: describe(fetcher.data.details) });
    }
  }, [fetcher.state, fetcher.data]);

  const open = account.status === "active";

  // Which plans the table shows and what they are searched by. Client state:
  // the page opens on the running plans every time, the round being about them.
  const [view, setView] = useState<PlanView>("active");
  const [query, setQuery] = useState("");
  const running = account.plans.filter((p) => p.status === "active");
  const stopped = account.plans.filter((p) => p.status === "stopped");
  const byView = view === "active" ? running : view === "inactive" ? stopped : [...running, ...stopped];
  const needle = query.trim().toLowerCase();
  const shown = needle ? byView.filter((p) => planLabel(p).toLowerCase().includes(needle)) : byView;

  // The account in four figures, all of them sums over the plans: what the
  // running plans hold and what has been taken off them, then the same over
  // every plan the account has ever had.
  const sum = (plans: SusuPlan[], of: (p: SusuPlan) => number) => plans.reduce((s, p) => s + of(p), 0);
  const balanceOf = (p: SusuPlan) => p.balance ?? 0;
  const withdrawnOf = (p: SusuPlan) => p.withdrawn ?? 0;

  const sections: RailSection[] = [
    {
      label: "Status",
      items: (
        [
          ["active", "Active", running.length],
          ["inactive", "Inactive", stopped.length],
          ["all", "All", account.plans.length],
        ] as const
      ).map(([key, label, count]) => ({ key, label, count, onSelect: () => setView(key) })),
    },
  ];

  const searchBox = (
    <SearchBox
      value={query}
      apply={setQuery}
      placeholder="Amount, e.g. 20"
      label="Search plans"
      className="sm:w-full"
    />
  );

  return (
    <RailFrame
      rail={({ horizontal }) =>
        horizontal ? (
          <div className="space-y-3">
            {searchBox}
            <FilterRail label="Filter plans by status" sections={sections} active={view} horizontal />
          </div>
        ) : (
          <FilterRail
            label="Filter plans by status"
            sections={sections}
            active={view}
            header={searchBox}
          />
        )
      }
    >
      <div className="space-y-4 px-4 py-6 sm:px-6">
        {!open && (
          <Note tone="info">
            Closed. GH₵ {formatAmount(account.closePayout ?? 0)} was paid out after GH₵{" "}
            {formatAmount(account.closeCommission ?? 0)} commission. Opening a susu account for
            this customer again brings this one back under the same number.
          </Note>
        )}

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Figure className="bg-card" label="Active balance" value={formatPesewas(sum(running, balanceOf))} />
          <Figure className="bg-card" label="Withdrawn · active" value={formatPesewas(sum(running, withdrawnOf))} />
          <Figure className="bg-card" label="Balance · all plans" value={formatPesewas(sum(account.plans, balanceOf))} />
          <Figure className="bg-card" label="Withdrawn · all plans" value={formatPesewas(sum(account.plans, withdrawnOf))} />
        </dl>

        {/* The commission due sits in the balance until a cycle completes or the
            customer takes everything — said apart so nobody reads it as theirs. */}
        {open && account.locked > 0 && (
          <LockMeter
            className="rounded-xl border border-border bg-card px-4 py-3"
            balance={account.balance}
            available={account.availableToWithdraw}
            locked={account.locked}
          />
        )}

        {/* The plans are the page: each row opens into the deposits that landed on it. */}
        <PlansSection
          account={account}
          plans={shown}
          canServe={canServe}
          fetcher={fetcher}
          empty={
            account.plans.length === 0
              ? "No plan yet."
              : needle
                ? "No plan matches."
                : view === "active"
                  ? "No plan is running."
                  : "No plan has been stopped."
          }
        />

        <Outlet />
      </div>
    </RailFrame>
  );
}

type PlanView = "active" | "inactive" | "all";

function Note({ tone, children }: { tone: "info" | "warning"; children: ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
        tone === "warning" ? "border-warning/40 bg-warning/10" : "border-info/40 bg-info/10",
      )}
    >
      <TriangleAlertIcon
        className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-warning" : "text-info")}
      />
      <span>{children}</span>
    </p>
  );
}

/* ------------------------------------------------------------------- plans --- */

type Fetcher = ReturnType<typeof useFetcher<ActionResult>>;

/**
 * The plans as a table, already narrowed by the rail. This is the one thing
 * on the page that is susu and not savings, so it gets the room: each row is
 * a plan, and opens into the deposits that landed on it. What a plan holds
 * comes from the API (`plan.balance`), where the withdrawal rule lives.
 */
function PlansSection({
  account,
  plans,
  canServe,
  fetcher,
  empty,
}: {
  account: SusuAccount;
  /** The plans to show, in order. */
  plans: SusuPlan[];
  canServe: boolean;
  fetcher: Fetcher;
  /** What to say when there is nothing to show. */
  empty: string;
}) {
  const open = account.status === "active";

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Plans
        </h3>
        {/* Everything the counter does to the account, in one row: money out,
            money in, and a new plan for the money to go on. */}
        {open && (
          <div className="flex flex-wrap items-center gap-2">
            {canServe && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/susu/${account.id}/withdraw`} prefetch="intent">
                  <BanknoteArrowUpIcon />
                  Withdraw
                </Link>
              </Button>
            )}
            {account.dailyTotal > 0 && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/susu/${account.id}/deposit`} prefetch="intent">
                  <BanknoteArrowDownIcon />
                  Record deposit
                </Link>
              </Button>
            )}
            {canServe && (
              <Button asChild size="sm">
                <Link to={`/susu/${account.id}/plans/new`} prefetch="intent">
                  <PlusIcon />
                  Add a plan
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>

      {plans.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <Th>Plan</Th>
              <Th>Cycle</Th>
              <Th className="hidden text-right sm:table-cell">Withdrawn</Th>
              <Th className="text-right">Balance</Th>
              <Th className="text-right">Commission due</Th>
              <Th className="hidden lg:table-cell">Started</Th>
              {canServe && open && <Th className="w-12 text-right">Actions</Th>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((plan) => (
              <PlanRow
                key={plan.id}
                plan={plan}
                balance={plan.balance ?? 0}
                account={account}
                canServe={canServe && plan.status === "active"}
                actionsColumn={canServe && open}
                fetcher={fetcher}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/**
 * One plan as a row. The row itself opens the plan — its cycle and every
 * deposit that landed on it — in a drawer; the menu at the end holds what
 * can be done to it.
 */
function PlanRow({
  plan,
  balance,
  account,
  canServe,
  actionsColumn,
  fetcher,
}: {
  plan: SusuPlan;
  /** Paid in on this plan, less its commission. Pesewas. */
  balance: number;
  account: SusuAccount;
  /** Whether this plan can be acted on: false for a stopped one. */
  canServe: boolean;
  /** Whether the table has an actions column at all, so every row lines up. */
  actionsColumn: boolean;
  fetcher: Fetcher;
}) {
  const navigate = useNavigate();
  const [confirmStop, setConfirmStop] = useState(false);
  const [changing, setChanging] = useState(false);
  const target = plan.cycleTarget || CYCLE_TARGET;
  const stopped = plan.status === "stopped";
  const between = !stopped && plan.paidInCycle === 0;
  const busy = fetcher.state !== "idle";
  const href = `/susu/${account.id}/plans/${plan.id}`;
  const showActions = canServe && account.status === "active";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setConfirmStop(false);
      setChanging(false);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <TableRow
      className={cn("cursor-pointer", stopped && "text-muted-foreground")}
      onClick={(e) => {
        // The dialogs below are portaled out of the row, but React still
        // bubbles their clicks up through here. Only a click on the row
        // itself opens the plan.
        if (!e.currentTarget.contains(e.target as Node)) return;
        navigate(href);
      }}
    >
      <TableCell className="px-4 py-3 whitespace-nowrap">
        <Link
          to={href}
          prefetch="intent"
          onClick={(e) => e.stopPropagation()}
          className={cn("tabular font-semibold underline-offset-4 hover:underline", stopped && "font-medium")}
        >
          {planLabel(plan)}
        </Link>
      </TableCell>
      <TableCell className="tabular px-4 py-3 whitespace-nowrap">
        {stopped ? (
          <>
            {plan.cyclesCompleted} completed
          </>
        ) : (
          <>
            {plan.paidInCycle}/{target}
          </>
        )}
      </TableCell>
      <TableCell className="tabular hidden px-4 py-3 text-right whitespace-nowrap sm:table-cell">
        {formatPesewas(plan.withdrawn ?? 0)}
      </TableCell>
      <TableCell className="tabular px-4 py-3 text-right font-medium whitespace-nowrap">
        {formatPesewas(balance)}
      </TableCell>
      <TableCell className="tabular px-4 py-3 text-right whitespace-nowrap">
        {stopped || between ? <span className="text-muted-foreground">—</span> : formatPesewas(plan.locked)}
      </TableCell>
      <TableCell className="hidden px-4 py-3 text-muted-foreground whitespace-nowrap lg:table-cell">
        {formatAccraDate(plan.startedAt)}
      </TableCell>
      {actionsColumn && (
        <TableCell className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
          {showActions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground">
                  <MoreHorizontalIcon />
                  <span className="sr-only">Actions for this plan</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={() => navigate(href)}>
                  <FileTextIcon />
                  View transactions
                </DropdownMenuItem>
                {plan.amountChangeable && (
                  <DropdownMenuItem onSelect={() => setChanging(true)}>
                    <PencilLineIcon />
                    Change amount
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmStop(true)}>
                  <SquareIcon />
                  Stop plan
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </TableCell>
      )}

      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop the {planLabel(plan)} plan?</AlertDialogTitle>
            <AlertDialogDescription>
              {between
                ? "No cycle is in progress, so nothing is charged. The money stays in the account."
                : `It is ${plan.paidInCycle} of ${target} into its cycle. One payment — GH₵ ${formatAmount(plan.dailyAmount)} — is taken as commission, and the rest stays in the account.`}{" "}
              A stopped plan does not restart; add a new one instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={busy}
              onClick={() => fetcher.submit({ intent: "stop-plan", planId: plan.id }, { method: "post" })}
            >
              Stop plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ChangeAmountDialog open={changing} onOpenChange={setChanging} plan={plan} fetcher={fetcher} />
    </TableRow>
  );
}

/** A new daily amount, between cycles only. The next cycle and its commission run at it. */
function ChangeAmountDialog({
  open,
  onOpenChange,
  plan,
  fetcher,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: SusuPlan;
  fetcher: Fetcher;
}) {
  const [amount, setAmount] = useState("");
  useEffect(() => {
    if (open) setAmount(toCedisInput(plan.dailyAmount));
  }, [open, plan.dailyAmount]);

  const pesewas = parseCedis(amount);
  const tooSmall = pesewas == null || pesewas < MIN_DAILY_AMOUNT;
  const same = pesewas === plan.dailyAmount;
  const busy = fetcher.state !== "idle";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change the daily amount</DialogTitle>
          <DialogDescription>
            Now {planLabel(plan)}. The next cycle — and its commission of one payment —
            runs at the new amount.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="plan-amount" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            New amount · GH₵ a day
          </Label>
          <Input
            id="plan-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={amount !== "" && tooSmall ? true : undefined}
            className="tabular"
          />
          {amount !== "" && tooSmall && (
            <p className="text-xs text-destructive">At least GH₵ {formatAmount(MIN_DAILY_AMOUNT)}.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || tooSmall || same}
            onClick={() =>
              fetcher.submit({ intent: "change-plan", planId: plan.id, dailyAmount: amount }, { method: "post" })
            }
          >
            Change amount
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

