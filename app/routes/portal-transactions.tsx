import { ArrowDownLeftIcon, ArrowRightLeftIcon, ArrowUpRightIcon, LayersIcon } from "lucide-react";
import { data, useSubmit } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { listTransactions } from "~/api/portal";
import { DayRangeChip, DayRangeFilter, FilterBar, Figure, ListingFooter, ModuleDot, Th } from "~/components/listing";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "~/components/ui/table";
import { channelLabel, MODULE_LABELS, TX_TYPE_LABELS, type UnifiedTransaction } from "~/lib/customers";
import { formatAccraDateTime, formatCount, formatPesewas } from "~/lib/format";
import { requireCustomer, withPortalAuth } from "~/lib/portal-session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/portal-transactions";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Transactions · Yadah Dynamic Enterprise" }];
}

const PAGE_SIZE = 20;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /portal/transactions` — the customer's own ledger. Pending mobile
 * money shows as pending and is not counted in the totals, so a payment
 * still being approved on the handset is visible without being claimed.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireCustomer(request);
  const url = new URL(request.url);
  const day = (k: string) => {
    const v = url.searchParams.get(k) ?? "";
    return DAY_RE.test(v) ? v : "";
  };
  const from = day("from");
  const to = day("to");
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: feed, headers } = await withPortalAuth(request, async (token) => {
    try {
      return await listTransactions(token, {
        page,
        limit: PAGE_SIZE,
        from: from || undefined,
        to: to || undefined,
      });
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  const items = feed.items ?? [];
  return data(
    {
      from,
      to,
      page,
      total: feed.total ?? (page - 1) * PAGE_SIZE + items.length,
      totals: feed.totals ?? null,
      rows: items,
    },
    { headers },
  );
}

function hrefFor(from: string, to: string, page = 1): string {
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `/portal/transactions?${s}` : "/portal/transactions";
}

export default function PortalTransactions({ loaderData }: Route.ComponentProps) {
  const { from, to, page, total, totals, rows } = loaderData;
  const submit = useSubmit();
  const apply = (next: { from?: string; to?: string }) => {
    const q: Record<string, string> = {};
    const f = next.from ?? from;
    const t = next.to ?? to;
    if (f) q.from = f;
    if (t) q.to = t;
    submit(q, { replace: true, preventScrollReset: true });
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Transactions</h1>
        </div>
        <DayRangeFilter from={from} to={to} apply={apply} title="Day" />
      </header>

      {totals && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Figure label="Paid in" value={formatPesewas(totals.in.amount)} tone="success" hint={`${formatCount(totals.in.count)} deposits`} />
          <Figure label="Taken out" value={formatPesewas(totals.out.amount)} tone="warning" hint={`${formatCount(totals.out.count)} withdrawals`} />
          <Figure label="Fees" value={formatPesewas(totals.feesCollected)} tone="muted" hint="Savings withdrawal fees" className="col-span-2 sm:col-span-1" />
        </dl>
      )}

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {(from || to) && (
          <FilterBar total={total} noun="transaction" plural="transactions">
            <DayRangeChip from={from} to={to} onDrop={() => submit({}, { replace: true })} />
          </FilterBar>
        )}
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <LayersIcon className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nothing here yet.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <Th>When</Th>
                <Th>What</Th>
                <Th className="hidden sm:table-cell">Account</Th>
                <Th className="text-right">Amount</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((tx) => (
                <Row key={tx.id} tx={tx} />
              ))}
            </TableBody>
          </Table>
        )}
        <ListingFooter page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => hrefFor(from, to, p)} />
      </section>
    </div>
  );
}

function Row({ tx }: { tx: UnifiedTransaction }) {
  const Icon =
    tx.direction === "in" ? ArrowDownLeftIcon : tx.direction === "out" ? ArrowUpRightIcon : ArrowRightLeftIcon;
  const pending = tx.status != null && tx.status !== "completed";
  return (
    <TableRow className={cn(pending && "opacity-70")}>
      <TableCell className="px-4 py-3 whitespace-nowrap text-muted-foreground">
        {formatAccraDateTime(tx.createdAt)}
      </TableCell>
      <TableCell className="px-4 py-3">
        <span className="flex items-center gap-2">
          <Icon
            className={cn(
              "size-4 shrink-0",
              tx.direction === "in" && "text-cash-in",
              tx.direction === "out" && "text-cash-out",
              tx.direction === "internal" && "text-muted-foreground",
            )}
          />
          <span>
            <span className="font-medium">{TX_TYPE_LABELS[tx.type] ?? tx.type}</span>
            <span className="block text-xs text-muted-foreground">
              {tx.channel ? channelLabel(tx.channel) : ""}
              {tx.detail ? ` · ${tx.detail}` : ""}
              {pending ? ` · ${tx.status === "pending" ? "awaiting confirmation" : "failed"}` : ""}
            </span>
          </span>
        </span>
      </TableCell>
      <TableCell className="hidden px-4 py-3 sm:table-cell">
        <span className="flex items-center gap-2 text-muted-foreground">
          <ModuleDot module={tx.module} />
          {MODULE_LABELS[tx.module]}
          {tx.ref.accountNumber && <span className="tabular">#{tx.ref.accountNumber}</span>}
        </span>
      </TableCell>
      <TableCell
        className={cn(
          "tabular px-4 py-3 text-right font-medium",
          tx.direction === "in" && "text-cash-in",
          tx.direction === "out" && "text-cash-out",
        )}
      >
        {tx.direction === "out" ? "−" : tx.direction === "in" ? "+" : ""}
        {formatPesewas(tx.amount)}
        {tx.fee > 0 && <span className="block text-[10.5px] font-normal text-muted-foreground">fee {formatPesewas(tx.fee)}</span>}
      </TableCell>
    </TableRow>
  );
}
