import { FileTextIcon, PrinterIcon } from "lucide-react";
import { data, useSubmit } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { getStatement } from "~/api/portal";
import { Figure, ModuleDot, PeriodFilter, Th } from "~/components/listing";
import { Button } from "~/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "~/components/ui/table";
import { channelLabel, MODULE_LABELS, TX_TYPE_LABELS } from "~/lib/customers";
import { accraDay, accraDaysAgo, formatAccraDate, formatAccraDateTime, formatCount, formatDayRange, formatPesewas } from "~/lib/format";
import { requireCustomer, withPortalAuth } from "~/lib/portal-session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/portal-statement";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Statement · Yadah Dynamic Enterprise" }];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `GET /portal/statement` — the same statement the office prints, for a range. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireCustomer(request);
  const url = new URL(request.url);
  const day = (k: string, fallback: string) => {
    const v = url.searchParams.get(k) ?? "";
    return DAY_RE.test(v) ? v : fallback;
  };
  const from = day("from", accraDaysAgo(29));
  const to = day("to", accraDay());

  const { data: statement, headers } = await withPortalAuth(request, async (token) => {
    try {
      return await getStatement(token, { from, to });
    } catch (error) {
      throwAsRouteError(error);
    }
  });
  return data({ from, to, statement }, { headers });
}

export default function PortalStatement({ loaderData }: Route.ComponentProps) {
  const { from, to, statement } = loaderData;
  const submit = useSubmit();
  const s = statement;
  const products = s.products ?? { susu: [], savings: [], loans: [], hirePurchase: [] };
  const rows = s.transactions ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Statement of account</h1>
          <p className="mt-1 text-sm text-muted-foreground">{formatDayRange(from, to)}</p>
        </div>
        <div className="flex gap-2">
          <PeriodFilter from={from} to={to} active={from !== accraDaysAgo(29) || to !== accraDay()} apply={(next) => submit({ from: next.from ?? from, to: next.to ?? to }, { replace: true })} />
          <Button variant="outline" onClick={() => window.print()}>
            <PrinterIcon />
            Print
          </Button>
        </div>
      </header>

      {/* Print header — the page prints as the document it is. */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">Statement of account</h1>
        <p className="text-sm">
          {s.customer?.fullName} · {s.customer?.phone} · {formatDayRange(from, to)}
        </p>
      </div>

      {s.totals && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="Paid in" value={formatPesewas(s.totals.in.amount)} tone="success" hint={`${formatCount(s.totals.in.count)} entries`} />
          <Figure label="Taken out" value={formatPesewas(s.totals.out.amount)} tone="warning" hint={`${formatCount(s.totals.out.count)} entries`} />
          <Figure label="Moved between accounts" value={formatPesewas(s.totals.internal.amount)} tone="muted" />
          <Figure label="Fees" value={formatPesewas(s.totals.feesCollected)} tone="muted" />
        </dl>
      )}

      <section className="grid gap-3 md:grid-cols-2">
        {products.susu.map((a) => (
          <Holding key={a.accountId} title={`Susu #${a.accountNumber}`} status={a.status}>
            <Cell label="Daily" value={formatPesewas(a.dailyAmount)} />
            <Cell label="Days paid" value={formatCount(a.depositsCount)} />
            <Cell label="Paid in" value={formatPesewas(a.totalDeposited)} />
            <Cell label="Owed to you" value={formatPesewas(a.payoutRemaining)} />
          </Holding>
        ))}
        {products.savings.map((a) => (
          <Holding key={a.accountId} title={`Savings #${a.accountNumber}`} status={a.status}>
            <Cell label="Opening" value={formatPesewas(a.openingBalance)} />
            <Cell label="Closing" value={formatPesewas(a.closingBalance)} />
            <Cell label="Now" value={formatPesewas(a.currentBalance)} />
          </Holding>
        ))}
        {products.loans.map((l) => (
          <Holding key={l.loanId} title={`${l.tier} loan`} status={l.status}>
            <Cell label="Borrowed" value={formatPesewas(l.principal)} />
            <Cell label="Repaid" value={formatPesewas(l.totalRepaid)} />
            <Cell label="Remaining" value={formatPesewas(l.remaining)} />
            {l.dueDate && <Cell label="Due" value={formatAccraDate(l.dueDate)} />}
          </Holding>
        ))}
        {products.hirePurchase.map((h) => (
          <Holding key={h.agreementId} title={h.itemName} status={h.status}>
            <Cell label="Paid" value={formatPesewas(h.totalPaid)} />
            {h.remaining != null && <Cell label="Remaining" value={formatPesewas(h.remaining)} />}
          </Holding>
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <FileTextIcon className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nothing moved in this period.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <Th>Date</Th>
                <Th>Entry</Th>
                <Th className="hidden sm:table-cell">Account</Th>
                <Th className="text-right">In</Th>
                <Th className="text-right">Out</Th>
                <Th className="hidden text-right md:table-cell">Balance</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{formatAccraDateTime(tx.createdAt)}</TableCell>
                  <TableCell className="px-4 py-2.5">
                    <span className="font-medium">{TX_TYPE_LABELS[tx.type] ?? tx.type}</span>
                    <span className="block text-xs text-muted-foreground">
                      {tx.channel ? channelLabel(tx.channel) : ""}
                      {tx.detail ? ` · ${tx.detail}` : ""}
                    </span>
                  </TableCell>
                  <TableCell className="hidden px-4 py-2.5 sm:table-cell">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <ModuleDot module={tx.module} />
                      {MODULE_LABELS[tx.module]}
                      {tx.ref.accountNumber && <span className="tabular">#{tx.ref.accountNumber}</span>}
                    </span>
                  </TableCell>
                  <TableCell className={cn("tabular px-4 py-2.5 text-right", tx.direction === "in" && "text-cash-in font-medium")}>
                    {tx.direction === "in" ? formatPesewas(tx.amount) : ""}
                  </TableCell>
                  <TableCell className={cn("tabular px-4 py-2.5 text-right", tx.direction === "out" && "text-cash-out font-medium")}>
                    {tx.direction === "out" ? formatPesewas(tx.amount + tx.fee) : tx.direction === "internal" ? <span className="text-muted-foreground">{formatPesewas(tx.amount)}</span> : ""}
                  </TableCell>
                  <TableCell className="tabular hidden px-4 py-2.5 text-right text-muted-foreground md:table-cell">
                    {tx.balanceAfter != null ? formatPesewas(tx.balanceAfter) : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {s.truncated && (
        <p className="text-xs text-warning">This period held more entries than can be shown at once. Narrow the range to see everything.</p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Generated {s.generatedAt ? formatAccraDateTime(s.generatedAt) : "now"}. Keep this for your records.
      </p>
    </div>
  );
}

function Holding({ title, status, children }: { title: string; status: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-heading text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground capitalize">{status.replace(/-/g, " ")}</span>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">{children}</dl>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}
