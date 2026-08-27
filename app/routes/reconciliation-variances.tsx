import { ChartNoAxesColumnIcon, ScaleIcon } from "lucide-react";
import { data, Link, useNavigation, useSubmit } from "react-router";

import { getVariances } from "~/api/reconciliation";
import {
  DayRangeChip,
  DayRangeFilter,
  ExportMenu,
  Figure,
  FilterBar,
  ListingCard,
  ListingToolbar,
  Th,
} from "~/components/listing";
import { BackLink, Page, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
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
import { formatCount, formatPesewas } from "~/lib/format";
import { VARIANCE_LABELS, varianceKind } from "~/lib/reconciliation";
import { requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/reconciliation-variances";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Cash variances · Yadah Dynamic Enterprise" }];
}

interface Filters {
  from: string;
  to: string;
}

function readFilters(url: URL): Filters {
  return {
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  };
}

function queryFor(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  return p;
}

/**
 * `GET /reconciliation/variances` — who is short, how often, and by how much.
 * Office only: it is a report about the collectors, not for them.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);
  const filters = readFilters(url);

  const { data: report, headers } = await withAuth(request, (token) =>
    getVariances(token, {
      from: filters.from || undefined,
      to: filters.to || undefined,
    }),
  );

  return data({ filters, report }, { headers });
}

export default function ReconciliationVariances({ loaderData }: Route.ComponentProps) {
  const { filters, report } = loaderData;
  const submit = useSubmit();
  const navigation = useNavigation();

  const apply = (patch: Partial<Filters>) =>
    submit(queryFor({ ...filters, ...patch }), {
      replace: true,
      preventScrollReset: true,
    });

  const rows = report.rows ?? [];
  const totals = report.totals;
  const narrowed = Boolean(filters.from || filters.to);

  return (
    <Page className="max-w-none">
      <BackLink to="/reconciliation" className="mb-4">
        All handovers
      </BackLink>

      <PageHeader
        title="Cash variances"
        description="Grouped by collector, worst first."
      />

      {/* Shorts and overs are reported apart as well as netted, and the screen
          keeps them apart: a collector short GH₵ 50 one day and over GH₵ 50 the
          next nets to zero, and is not the same person as one who balances. */}
      <dl className="mb-6 grid gap-3 sm:grid-cols-4">
        <Figure
          label="Total short"
          value={formatPesewas(totals.totalShort)}
          tone="danger"
          hint="Shortfalls alone"
        />
        <Figure
          label="Total over"
          value={formatPesewas(totals.totalOver)}
          tone="warning"
          hint="Overages alone"
        />
        <Figure
          label="Net"
          value={formatPesewas(Math.abs(totals.netVariance))}
          tone={totals.netVariance === 0 ? "muted" : undefined}
          hint={
            totals.netVariance === 0
              ? "Balanced overall"
              : `${VARIANCE_LABELS[varianceKind(totals.netVariance)]} once netted`
          }
        />
        <Figure
          label="Days with a gap"
          value={formatCount(totals.daysWithVariance)}
        />
      </dl>

      <ListingCard>
        <ListingToolbar>
          <DayRangeFilter
            from={filters.from}
            to={filters.to}
            apply={(next) => apply(next)}
            title="Day"
          />
          <ExportMenu
            path="/reconciliation/variances/export"
            query={queryFor(filters).toString()}
            total={rows.length}
            noun="collector"
          />
        </ListingToolbar>

        {narrowed && (
          <FilterBar total={rows.length} noun="collector" plural="collectors">
            <DayRangeChip
              from={filters.from}
              to={filters.to}
              onDrop={() => apply({ from: "", to: "" })}
            />
          </FilterBar>
        )}

        {rows.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ChartNoAxesColumnIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing to report</EmptyTitle>
              <EmptyDescription>
                {narrowed
                  ? "No handovers in that range."
                  : "No day has been counted yet, so there is nothing to compare."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <Th>Collector</Th>
                <Th className="text-right">Days</Th>
                <Th className="text-right">With a gap</Th>
                <Th className="text-right">Expected</Th>
                <Th className="text-right">Counted</Th>
                <Th className="text-right">Short</Th>
                <Th className="text-right">Over</Th>
                <Th className="text-right">Net</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const kind = varianceKind(row.netVariance);
                return (
                  <TableRow key={row.collectorId}>
                    <TableCell className="px-4 py-3 font-medium">
                      <Link
                        to={`/reconciliation?collectorId=${row.collectorId}${
                          filters.from ? `&from=${filters.from}` : ""
                        }${filters.to ? `&to=${filters.to}` : ""}`}
                        prefetch="intent"
                        className="underline-offset-4 hover:underline"
                      >
                        {row.collectorName}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular px-4 py-3 text-right">
                      {formatCount(row.days)}
                    </TableCell>
                    <TableCell className="tabular px-4 py-3 text-right">
                      {row.daysWithVariance > 0 ? (
                        <span className="font-medium text-warning">
                          {formatCount(row.daysWithVariance)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular px-4 py-3 text-right text-muted-foreground">
                      {formatPesewas(row.totalExpected)}
                    </TableCell>
                    <TableCell className="tabular px-4 py-3 text-right">
                      {formatPesewas(row.totalReceived)}
                    </TableCell>
                    <TableCell className="tabular px-4 py-3 text-right">
                      {row.totalShort > 0 ? (
                        <span className="text-danger">
                          {formatPesewas(row.totalShort)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular px-4 py-3 text-right">
                      {row.totalOver > 0 ? (
                        <span className="text-warning">
                          {formatPesewas(row.totalOver)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "tabular px-4 py-3 text-right font-semibold",
                        kind === "short" && "text-danger",
                        kind === "over" && "text-warning",
                        kind === "square" && "text-muted-foreground",
                      )}
                    >
                      {kind === "square"
                        ? "Balanced"
                        : `${VARIANCE_LABELS[kind]} ${formatPesewas(Math.abs(row.netVariance))}`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </ListingCard>

      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <ScaleIcon className="size-3.5" />
        {navigation.state === "loading" ? "Reading…" : "Variance is counted less expected."}
      </p>
    </Page>
  );
}
