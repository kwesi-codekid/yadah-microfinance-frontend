import { LandmarkIcon } from "lucide-react";
import { data, Link, useNavigation } from "react-router";

import { getLoanAging, getOutstandingLoans } from "~/api/reports";
import {
  ExportMenu,
  Figure,
  ListingCard,
  ListingToolbar,
  StatusPill,
  Th,
  type Tone,
} from "~/components/listing";
import { BackLink, Page, PageHeader } from "~/components/page";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { formatAccraDate, formatCount, formatPesewas } from "~/lib/format";
import { amountOf } from "~/lib/reports";
import { requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/report-loans";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Loan portfolio · Yadah Dynamic Enterprise" }];
}

/**
 * The loan book from the office's side, in two readings of the same set.
 *
 * `GET /reports/loans/aging` buckets what is late into 1–30, 31–90 and 90+ days;
 * `GET /reports/loans/outstanding` lists every open loan, soonest due first.
 * They are one page because they are one question asked twice — how much is out
 * there, and how worried should we be — and reading the buckets without the
 * rows underneath them only ever prompts "which loans?".
 *
 * Neither endpoint takes a range: both are a position as at now, not a period.
 */

/** The buckets in the order arrears actually age, whatever the API calls them. */
const BUCKETS: { keys: string[]; label: string; blurb: string; tone: Tone }[] = [
  {
    keys: ["1-30", "1_30", "days1to30", "bucket1"],
    label: "1–30 days",
    blurb: "Late, but recently.",
    tone: "warning",
  },
  {
    keys: ["31-90", "31_90", "days31to90", "bucket2"],
    label: "31–90 days",
    blurb: "Late enough to chase.",
    tone: "warning",
  },
  {
    keys: ["90+", "90plus", "over90", "days90plus", "bucket3"],
    label: "90+ days",
    blurb: "Debt recovery.",
    tone: "danger",
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const [outstanding, aging] = await Promise.all([
      getOutstandingLoans(token),
      // A missing aging report must not take the whole page down with it: the
      // outstanding rows are the part someone came here to act on.
      getLoanAging(token).catch(() => null),
    ]);
    return { outstanding, aging };
  });

  const raw = result.outstanding.rows ?? result.outstanding.items ?? [];
  const rows = raw.map((row) => ({
    id: row.loanId ?? row.id ?? "",
    customerId: row.customerId ?? "",
    customerName: row.customerName ?? "Customer",
    principal: row.principal ?? 0,
    remaining: row.remaining ?? 0,
    totalDue: row.totalDue ?? 0,
    due: row.dueDate ? formatAccraDate(row.dueDate) : "—",
    daysOverdue: row.daysOverdue ?? 0,
    status: row.status ?? "",
  }));

  // The buckets come keyed differently across deployments, so each is looked up
  // under every name it is known by rather than trusted to one.
  const source = result.aging?.buckets ?? {};
  const byRow = new Map<string, { count?: number; amount?: number }>(
    (result.aging?.rows ?? []).map((r) => [String(r.bucket ?? ""), r]),
  );
  const buckets = BUCKETS.map((bucket) => {
    const hit =
      bucket.keys.map((k) => source[k]).find(Boolean) ??
      bucket.keys.map((k) => byRow.get(k)).find(Boolean) ??
      {};
    return {
      label: bucket.label,
      blurb: bucket.blurb,
      tone: bucket.tone,
      count: hit.count ?? 0,
      amount: hit.amount ?? 0,
    };
  });

  return data(
    {
      rows,
      buckets,
      /** Whether the aging endpoint answered at all — a zero is not a silence. */
      agingRead: result.aging != null,
      totals: {
        count: result.outstanding.totals?.count ?? rows.length,
        amount:
          amountOf(result.outstanding.totals ?? {}) ||
          rows.reduce((n, r) => n + r.remaining, 0),
      },
      overdueCount: rows.filter((r) => r.daysOverdue > 0).length,
    },
    { headers },
  );
}

export default function ReportLoans({ loaderData }: Route.ComponentProps) {
  const { rows, buckets, agingRead, totals, overdueCount } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state === "loading";

  const arrears = buckets.reduce((n, b) => n + b.amount, 0);

  return (
    <Page className="max-w-none">
      <BackLink to="/reports" className="mb-4">
        All reports
      </BackLink>

      <PageHeader
        title="Loan portfolio"
        description="What is still out there, and how late it is. A position as at now, not a period."
      />

      <dl className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Still owed"
          value={formatPesewas(totals.amount)}
          hint={`across ${formatCount(totals.count)} open loan${totals.count === 1 ? "" : "s"}`}
          tone="info"
        />
        <Figure
          label="In arrears"
          value={formatPesewas(arrears)}
          hint={
            agingRead
              ? `${formatCount(overdueCount)} past due`
              : "aging report unavailable"
          }
          tone={arrears > 0 ? "danger" : "muted"}
        />
        <Figure
          label="Healthy"
          value={formatPesewas(Math.max(0, totals.amount - arrears))}
          hint="not yet late"
          tone="success"
        />
        <Figure
          label="Open loans"
          value={formatCount(totals.count)}
          tone="muted"
        />
      </dl>

      {/* The three buckets, in the order arrears age. Read together they are the
          shape of the problem; the table underneath is which loans make it up. */}
      <section className="mb-6 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Arrears aging
        </h3>
        {agingRead ? (
          <dl className="grid gap-3 sm:grid-cols-3">
            {buckets.map((bucket) => (
              <div
                key={bucket.label}
                className="rounded-lg border border-border bg-muted/40 px-3 py-2.5"
              >
                <dt className="flex items-center justify-between gap-2">
                  <StatusPill label={bucket.label} tone={bucket.tone} />
                  <span className="text-xs text-muted-foreground">
                    {formatCount(bucket.count)} loan
                    {bucket.count === 1 ? "" : "s"}
                  </span>
                </dt>
                <dd className="tabular mt-1 text-lg font-semibold">
                  {formatPesewas(bucket.amount)}
                </dd>
                <dd className="mt-0.5 text-xs text-muted-foreground">
                  {bucket.blurb}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            The aging report did not answer. The outstanding loans below are
            unaffected — only the bucket summary is missing.
          </p>
        )}
      </section>

      <ListingCard>
        <ListingToolbar>
          <ExportMenu
            path="/reports/loans/aging/export"
            query=""
            total={agingRead ? buckets.length : 0}
            noun="bucket"
          />
          <ExportMenu
            path="/reports/loans/export"
            query=""
            total={rows.length}
            noun="loan"
          />
        </ListingToolbar>

        {rows.length === 0 ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LandmarkIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing is outstanding</EmptyTitle>
              <EmptyDescription>
                Every loan on the book has been settled. New applications appear
                here once they are approved.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table className={cn("transition-opacity", busy && "opacity-60")}>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Customer</Th>
                  <Th className="text-right">Principal</Th>
                  <Th className="text-right">Still owing</Th>
                  <Th>Due</Th>
                  <Th className="text-right">Overdue</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {row.id ? (
                        <Link
                          to={`/loans/${row.id}`}
                          className="hover:underline"
                          prefetch="intent"
                        >
                          {row.customerName}
                        </Link>
                      ) : (
                        row.customerName
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right text-muted-foreground">
                      {formatPesewas(row.principal)}
                    </TableCell>
                    <TableCell className="tabular text-right font-semibold">
                      {formatPesewas(row.remaining)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.due}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.daysOverdue > 0 ? (
                        <StatusPill
                          label={`${formatCount(row.daysOverdue)} day${row.daysOverdue === 1 ? "" : "s"}`}
                          tone={row.daysOverdue > 90 ? "danger" : "warning"}
                          className="justify-end"
                        />
                      ) : (
                        <span className="text-muted-foreground">On time</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ListingCard>
    </Page>
  );
}
