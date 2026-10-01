import { Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import type { useFetcher } from "react-router";

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
import { DropdownMenuItem } from "~/components/ui/dropdown-menu";
import { Label } from "~/components/ui/label";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";
import { Th } from "~/components/susu-bits";
import {
  TxnRowMenu,
  whyNotCorrectable,
  type CorrectionOutcome,
  type PendingCorrection,
} from "~/components/txn-correction";
import { formatAccraDateTime, formatAmount, formatPesewas } from "~/lib/format";
import { CHANNEL_LABELS, CYCLE_TARGET, type SusuAccount, type SusuDeposit } from "~/lib/susu";

/**
 * A susu account's deposits as a statement: the rows the account page builds
 * from the API, and the table that draws them with the correction menu on
 * each. Shared by the plan drawer, which shows the same rows narrowed to one
 * plan, so a deposit reads and is corrected the same way wherever it appears.
 */

export type Fetcher = ReturnType<typeof useFetcher<CorrectionOutcome>>;

export interface DepositRow {
  id: string;
  amount: number;
  payments: number;
  leftover: number;
  commission: number;
  /** One per line: "GH₵ 10.00 · 13–15 of 31", flagged when it completed a cycle. */
  lines: {
    key: string;
    planId: string;
    dailyAmount: number;
    /** payments × dailyAmount — what this line put on its plan. */
    amount: number;
    payments: number;
    commission: number;
    range: string;
    cycle: number;
    completes: boolean;
  }[];
  /** Plans this deposit touched, and whether the split can be corrected by amount alone. */
  planIds: string[];
  channel: string;
  transfer: boolean;
  paystack: boolean;
  /** As written, for the row. */
  at: string;
  /** As recorded, for ordering against other movements. */
  createdAt: string;
  recordedBy: string;
  pending: PendingCorrection | null;
}

export function toRow(d: SusuDeposit) {
  return {
    id: d.id,
    amount: d.amount,
    payments: d.payments,
    leftover: d.leftover,
    commission: d.commissionAmount,
    lines: d.lines.map((l, i) => ({
      key: `${l.planId}-${i}`,
      planId: l.planId,
      dailyAmount: l.dailyAmount,
      amount: l.amount,
      payments: l.payments,
      commission: l.commissionAmount,
      range: l.seqStart === l.seqEnd ? `${l.seqEnd}` : `${l.seqStart}–${l.seqEnd}`,
      cycle: l.cycleNumber,
      completes: l.completesCycle,
    })),
    planIds: [...new Set(d.lines.map((l) => l.planId))],
    channel: CHANNEL_LABELS[d.channel] ?? d.channel,
    transfer: d.channel === "transfer",
    paystack: d.channel === "paystack",
    at: formatAccraDateTime(d.createdAt),
    createdAt: d.createdAt,
  };
}

/** The newest live deposit on each plan — the only one the API lets be corrected. */
export function newestByPlan(rows: DepositRow[]): Map<string, string> {
  const out = new Map<string, string>();
  // Rows arrive newest first.
  for (const row of rows) {
    for (const planId of row.planIds) {
      if (!out.has(planId)) out.set(planId, row.id);
    }
  }
  return out;
}

export function DepositTable({
  rows,
  newestByPlan,
  canManage,
  canCorrect,
  account,
  fetcher,
}: {
  rows: DepositRow[];
  newestByPlan: Map<string, string>;
  canManage: boolean;
  canCorrect: boolean;
  account: SusuAccount;
  fetcher: Fetcher;
}) {
  const open = account.status === "active";

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <Th>Date &amp; time</Th>
          <Th>Plans</Th>
          <Th className="text-right">Amount</Th>
          <Th className="hidden md:table-cell">Channel</Th>
          <Th className="hidden lg:table-cell">Recorded by</Th>
          {canCorrect && <Th className="w-12 text-right">Actions</Th>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const newest = row.planIds.every((id) => newestByPlan.get(id) === row.id);
          return (
            <TableRow key={row.id}>
              <TableCell className="px-4 py-3 whitespace-nowrap">
                <p>{row.at}</p>
                <p className="tabular text-xs text-muted-foreground">
                  {row.payments} payment{row.payments === 1 ? "" : "s"}
                </p>
              </TableCell>
              <TableCell className="px-4 py-3">
                {/* Which plan, and which positions of its cycle — the answer
                    to "why did three move at once" and "which cycle was that". */}
                <ul className="space-y-0.5 text-xs">
                  {row.lines.map((l) => (
                    <li key={l.key} className="tabular whitespace-nowrap">
                      <span className="font-medium">{formatAmount(l.dailyAmount)}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · cycle {l.cycle} · {l.range}
                      </span>
                      {l.completes && <span className="ml-1 text-info">complete</span>}
                    </li>
                  ))}
                  {row.leftover > 0 && (
                    <li className="tabular text-muted-foreground">
                      {formatAmount(row.leftover)} kept in the balance
                    </li>
                  )}
                </ul>
              </TableCell>
              <TableCell className="tabular px-4 py-3 text-right font-medium whitespace-nowrap">
                {formatPesewas(row.amount)}
                {row.commission > 0 && (
                  <p className="text-xs font-normal text-muted-foreground">
                    {formatPesewas(row.commission)} commission
                  </p>
                )}
                {row.pending && (
                  <p className="text-xs font-normal text-warning">
                    {formatPesewas(row.pending.amount)} waiting
                  </p>
                )}
              </TableCell>
              <TableCell className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                {row.channel}
              </TableCell>
              <TableCell className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                {row.recordedBy}
              </TableCell>
              {canCorrect && (
                <TableCell className="px-4 py-3 text-right">
                  <DepositActions
                    row={row}
                    account={account}
                    fetcher={fetcher}
                    canManage={canManage}
                    blocked={whyNotCorrectable({
                      pending: row.pending,
                      locked: row.transfer
                        ? "This came from a transfer between accounts. Correct it on the transfer, not here."
                        : row.paystack
                          ? "This was paid through Paystack, so the amount is what was charged."
                          : null,
                      closed: open ? null : "This account is closed, so its deposits are final.",
                      newest,
                      noun: "deposit",
                    })}
                  />
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** The row menu: the shared correction, with the trash beneath it for the office. */
export function DepositActions({
  row,
  account,
  fetcher,
  canManage,
  blocked,
}: {
  row: DepositRow;
  account: SusuAccount;
  fetcher: Fetcher;
  canManage: boolean;
  blocked: string | null;
}) {
  const [trashing, setTrashing] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setTrashing(false);
  }, [fetcher.state, fetcher.data]);

  // The plan the corrected amount is re-credited to, as it stood before this
  // deposit: a deposit split across plans cannot be re-split by amount alone.
  const onePlan = row.planIds.length === 1 ? account.plans.find((p) => p.id === row.planIds[0]) : undefined;
  const firstLine = row.lines[0];

  return (
    <>
      <TxnRowMenu
        txn={{ id: row.id, amount: row.amount }}
        context={
          row.transfer || row.paystack
            ? null
            : {
                kind: "susu-deposit",
                dailyAmount: onePlan?.dailyAmount ?? firstLine?.dailyAmount ?? 0,
                paidBefore: onePlan ? Math.max(0, (firstLine ? Number(firstLine.range.split("–")[0]) : 1) - 1) : 0,
                cycleTarget: onePlan?.cycleTarget ?? CYCLE_TARGET,
                payments: row.payments,
                plans: row.planIds.length,
              }
        }
        targetId={account.id}
        pending={row.pending}
        blocked={blocked}
        canDecide={canManage}
        fetcher={fetcher}
        srLabel="Actions for this deposit"
        after={
          canManage && (
            <DropdownMenuItem
              variant="destructive"
              disabled={blocked !== null}
              onSelect={(e) => {
                e.preventDefault();
                setReason("");
                setTrashing(true);
              }}
            >
              <Trash2Icon />
              Move to trash
            </DropdownMenuItem>
          )
        }
      />

      <AlertDialog open={trashing} onOpenChange={setTrashing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move this deposit to the trash?</AlertDialogTitle>
            <AlertDialogDescription>
              GH₵ {formatAmount(row.amount)} comes back off the account and its {row.payments}{" "}
              payment{row.payments === 1 ? "" : "s"} come off the plan
              {row.planIds.length === 1 ? "" : "s"}
              {row.commission > 0 ? `, and the GH₵ ${formatAmount(row.commission)} commission it took is refunded` : ""}.
              It can be restored while nothing newer has taken its place.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="deposit-reason" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Reason (optional)
            </Label>
            <Textarea
              id="deposit-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Recorded on the wrong account…"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                fetcher.submit({ intent: "trash-deposit", depositId: row.id, reason }, { method: "post" })
              }
            >
              Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The figures an error carries, as one line under the toast. */
export function describe(details?: Record<string, unknown>): string | undefined {
  if (!details) return undefined;
  const money = (k: string) =>
    typeof details[k] === "number" ? `GH₵ ${formatAmount(details[k] as number)}` : null;
  const parts = [
    money("required") && `needs ${money("required")}`,
    money("available") && `available ${money("available")}`,
    money("locked") && `locked ${money("locked")}`,
    money("balance") && `balance ${money("balance")}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}
