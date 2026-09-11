import { BanknoteArrowUpIcon, PlusIcon } from "lucide-react";
import { data, Link } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { listRequests } from "~/api/portal";
import { StatusPill, Th } from "~/components/listing";
import { Button } from "~/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "~/components/ui/table";
import { formatAccraDateTime, formatPesewas } from "~/lib/format";
import {
  KIND_LABELS,
  STATUS_BLURBS,
  STATUS_LABELS,
  STATUS_TONE,
  providerLabel,
} from "~/lib/payout-requests";
import { requireCustomer, withPortalAuth } from "~/lib/portal-session.server";
import type { Route } from "./+types/portal-requests";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Withdrawals · Yadah Dynamic Enterprise" }];
}

/** `GET /portal/requests` — what you asked for, and what the office said. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireCustomer(request);
  const { data: result, headers } = await withPortalAuth(request, async (token) => {
    try {
      return await listRequests(token, { limit: 50 });
    } catch (error) {
      throwAsRouteError(error);
    }
  });
  return data({ rows: result.items }, { headers });
}

/** The customer's wording for each state — the office's labels assume the other side. */
const CUSTOMER_STATUS: Record<string, { label: string; blurb: string }> = {
  pending: { label: "Waiting for the office", blurb: "Nothing has moved yet." },
  approved: { label: "On its way", blurb: "Approved. The money is being sent to your wallet." },
  rejected: { label: "Declined", blurb: "The office said no — the reason is below." },
  paid: { label: "Paid", blurb: "The money reached your wallet." },
  failed: { label: "Delayed", blurb: "The transfer did not go through. The office will retry or pay you in cash." },
};

export default function PortalRequests({ loaderData }: Route.ComponentProps) {
  const { rows } = loaderData;
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Withdrawals</h1>
        </div>
        <Button asChild>
          <Link to="/portal/requests/new" prefetch="intent">
            <PlusIcon />
            Request a withdrawal
          </Link>
        </Button>
      </header>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <BanknoteArrowUpIcon className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">You have not asked for a withdrawal yet.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <Th>Asked</Th>
                <Th>What</Th>
                <Th className="text-right">Amount</Th>
                <Th>Status</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const cs = CUSTOMER_STATUS[r.status] ?? { label: STATUS_LABELS[r.status], blurb: STATUS_BLURBS[r.status] };
                return (
                  <TableRow key={r.id}>
                    <TableCell className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatAccraDateTime(r.createdAt)}</TableCell>
                    <TableCell className="px-4 py-3">
                      <span className="font-medium">{KIND_LABELS[r.kind]}</span>
                      <span className="block text-xs text-muted-foreground">
                        to {providerLabel(r.payoutProvider)} · {r.payoutPhone}
                      </span>
                    </TableCell>
                    <TableCell className="tabular px-4 py-3 text-right font-medium">
                      {r.amount == null ? <span className="text-muted-foreground">Whole balance</span> : formatPesewas(r.amount)}
                      {r.netAmount != null && r.netAmount !== r.amount && (
                        <span className="block text-[10.5px] font-normal text-muted-foreground">sent {formatPesewas(r.netAmount)}</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusPill label={cs.label} blurb={cs.blurb} tone={STATUS_TONE[r.status]} />
                      {r.status === "rejected" && r.rejectionReason && (
                        <span className="block max-w-56 text-xs text-muted-foreground">{r.rejectionReason}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
