import { useEffect } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";

import { Page } from "~/components/page";
import { CycleStrip, Th } from "~/components/susu-bits";
import { DepositActions, describe, newestByPlan, type DepositRow } from "~/components/susu-deposits";
import { whyNotCorrectable, type CorrectionOutcome } from "~/components/txn-correction";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "~/components/ui/table";
import { formatAccraDate, formatAmount, formatPesewas } from "~/lib/format";
import { CYCLE_TARGET, planLabel } from "~/lib/susu";
import { cn } from "~/lib/utils";
import type { Crumb } from "./app-layout";
import type { Route } from "./+types/susu-plan";

/**
 * One plan, as a page of its own: where its cycle stands and every movement
 * of money on it — deposits in, withdrawals out — with the plan's balance
 * after each. It reads and acts through the account page's loader and action,
 * the same `:id` and the same data, so the two never disagree about a deposit.
 */
export { action, loader } from "./susu-detail";

export function meta({ loaderData, params }: Route.MetaArgs) {
  const plan = loaderData?.account.plans.find((p) => p.id === params.planId);
  return [{ title: `${plan ? planLabel(plan) : "Plan"} · Yadah Dynamic Enterprise` }];
}

/** The trail the layout header shows: the book, the account, then the plan. */
export const handle = {
  crumbs: (data: unknown, params?: { id?: string; planId?: string }): Crumb[] => {
    const d = data as
      | { account?: { id: string; customerName?: string | null; plans: { id: string; dailyAmount: number }[] } }
      | undefined;
    const plan = d?.account?.plans.find((p) => p.id === params?.planId);
    return [
      { label: "Susu", to: "/susu" },
      { label: d?.account?.customerName ?? "Account", to: `/susu/${d?.account?.id ?? params?.id ?? ""}` },
      { label: plan ? planLabel(plan) : "Plan" },
    ];
  },
};

/** One movement of money on the plan, as the statement lists it. */
interface StatementRow {
  key: string;
  createdAt: string;
  at: string;
  kind: "deposit" | "withdrawal";
  /** What moved, as shown: the share put on or taken off the plan. */
  amount: number;
  /** Commission a deposit's share took as it completed a cycle. */
  commission: number;
  /** What the plan's balance did: share less commission in, share out. */
  effect: number;
  completes: boolean;
  recordedBy: string;
  /** The deposit this row belongs to, for the correction menu. */
  deposit?: DepositRow;
  balanceAfter: number;
}

export default function SusuPlan({ loaderData, params }: Route.ComponentProps) {
  const { account, deposits, payouts, cycles, canManage, canCorrect } = loaderData;

  const fetcher = useFetcher<CorrectionOutcome>();
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      toast.success(fetcher.data.message);
    } else {
      toast.error(fetcher.data.message, { description: describe(fetcher.data.details) });
    }
  }, [fetcher.state, fetcher.data]);

  const plan = account.plans.find((p) => p.id === params.planId);
  if (!plan) {
    return (
      <Page className="max-w-none">
        <p className="text-sm text-muted-foreground">This plan is not on this account.</p>
      </Page>
    );
  }

  const target = plan.cycleTarget || CYCLE_TARGET;
  const stopped = plan.status === "stopped";
  const between = !stopped && plan.paidInCycle === 0;
  const open = account.status === "active";
  const newest = newestByPlan(deposits.items);

  // The statement: this plan's share of every deposit and every withdrawal,
  // newest first. The balance after each is walked back from what the plan
  // holds now, so it is right whether or not the page has the whole history.
  const rows: StatementRow[] = [
    ...deposits.items.flatMap((d) =>
      d.lines
        .filter((l) => l.planId === plan.id)
        .sort((x, y) => y.cycle - x.cycle)
        .map<StatementRow>((l) => ({
          key: `${d.id}-${l.key}`,
          createdAt: d.createdAt,
          at: d.at,
          kind: "deposit",
          amount: l.amount,
          commission: l.commission,
          effect: l.amount - l.commission,
          completes: l.completes,
          recordedBy: d.recordedBy,
          deposit: d,
          balanceAfter: 0,
        })),
    ),
    ...payouts.items.flatMap((p) =>
      p.lines
        .filter((l) => l.planId === plan.id)
        .map<StatementRow>((l) => ({
          key: `${p.id}-${l.planId}`,
          createdAt: p.createdAt,
          at: p.at,
          kind: "withdrawal",
          amount: l.amount,
          commission: 0,
          effect: -l.amount,
          completes: false,
          recordedBy: p.recordedBy,
          balanceAfter: 0,
        })),
    ),
  ].sort((x, y) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0));
  let running = plan.balance ?? 0;
  for (const row of rows) {
    row.balanceAfter = running;
    running -= row.effect;
  }

  const ended = cycles.filter((c) => c.planId === plan.id);
  const partial = deposits.total > deposits.items.length || payouts.total > payouts.items.length;

  return (
    <Page className="max-w-none">
      <div className="space-y-6">
        {/* Where the plan stands. */}
        <section className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-sm font-medium">
              {stopped
                ? `Stopped${plan.stoppedAt ? ` ${formatAccraDate(plan.stoppedAt)}` : ""}`
                : `Cycle ${plan.cycleNumber}`}
            </p>
            <p className="tabular text-xs text-muted-foreground">
              {stopped
                ? `${plan.cyclesCompleted} cycle${plan.cyclesCompleted === 1 ? "" : "s"} completed`
                : `${plan.paidInCycle}/${target} paid`}
            </p>
          </div>
          <CycleStrip className="mt-2" paid={plan.paidInCycle} target={target} dim={stopped} />
          <p className="mt-2 text-xs text-muted-foreground">
            {stopped
              ? plan.stopCommission
                ? `GH₵ ${formatAmount(plan.stopCommission)} commission taken when it stopped.`
                : "Stopped between cycles, nothing charged."
              : between
                ? plan.cyclesCompleted > 0
                  ? "Between cycles. The next deposit starts the next one; the amount can be changed until then."
                  : "Waiting for its first deposit. The amount can still be changed."
                : `GH₵ ${formatAmount(plan.locked)} locked until the cycle completes.`}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Balance</dt>
              <dd className="tabular font-medium">{formatPesewas(plan.balance ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Withdrawn</dt>
              <dd className="tabular">{formatPesewas(plan.withdrawn ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cycles completed</dt>
              <dd className="tabular">{plan.cyclesCompleted}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Started</dt>
              <dd>{formatAccraDate(plan.startedAt)}</dd>
            </div>
          </dl>
        </section>

        {/* Money in and out of this plan, with what it held after each. A
            deposit row keeps the correction menu it has on the account. */}
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Transactions
            </h3>
          </div>
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Nothing has moved on this plan yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Date &amp; time</Th>
                  <Th>Type</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">Balance after</Th>
                  <Th className="hidden lg:table-cell">Recorded by</Th>
                  {canCorrect && <Th className="w-12 text-right">Actions</Th>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="px-4 py-3 whitespace-nowrap">{row.at}</TableCell>
                    <TableCell className="px-4 py-3 whitespace-nowrap">
                      {row.kind === "deposit" ? "Deposit" : "Withdrawal"}
                      {row.completes && <span className="ml-1 text-xs text-info">cycle complete</span>}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "tabular px-4 py-3 text-right font-medium whitespace-nowrap",
                        row.kind === "withdrawal" && "text-muted-foreground",
                      )}
                    >
                      {row.kind === "withdrawal" ? "−" : ""}
                      {formatPesewas(row.amount)}
                      {row.commission > 0 && (
                        <p className="text-xs font-normal text-muted-foreground">
                          {formatPesewas(row.commission)} commission
                        </p>
                      )}
                      {row.deposit?.pending && (
                        <p className="text-xs font-normal text-warning">
                          {formatPesewas(row.deposit.pending.amount)} waiting
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="tabular px-4 py-3 text-right whitespace-nowrap">
                      {formatPesewas(row.balanceAfter)}
                    </TableCell>
                    <TableCell className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                      {row.recordedBy}
                    </TableCell>
                    {canCorrect && (
                      <TableCell className="px-4 py-3 text-right">
                        {row.deposit && (
                          <DepositActions
                            row={row.deposit}
                            account={account}
                            fetcher={fetcher}
                            canManage={canManage}
                            blocked={whyNotCorrectable({
                              pending: row.deposit.pending,
                              locked: row.deposit.transfer
                                ? "This came from a transfer between accounts. Correct it on the transfer, not here."
                                : row.deposit.paystack
                                  ? "This was paid through Paystack, so the amount is what was charged."
                                  : null,
                              closed: open ? null : "This account is closed, so its deposits are final.",
                              newest: row.deposit.planIds.every((id) => newest.get(id) === row.deposit!.id),
                              noun: "deposit",
                            })}
                          />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {partial && (
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              Drawn from the newest {deposits.items.length} deposits and {payouts.items.length}{" "}
              withdrawals on the account.
            </p>
          )}
        </section>

        {/* Cycles this plan has closed. */}
        {ended.length > 0 && (
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Cycles ended
              </h3>
            </div>
            <ul className="divide-y divide-border text-sm">
              {ended.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5"
                >
                  <span className="tabular">
                    Cycle {c.cycle}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {c.payments} of {c.target} · {c.reason}
                    </span>
                  </span>
                  <span className="tabular text-xs text-muted-foreground">
                    {formatPesewas(c.commission)} commission · {c.endedAt}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Page>
  );
}
