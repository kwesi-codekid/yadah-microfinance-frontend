import { UsersIcon } from "lucide-react";
import { data, useNavigation, useSubmit } from "react-router";

import { getCollections } from "~/api/reports";
import { listUsers } from "~/api/users";
import {
  DayRangeChip,
  PeriodFilter,
  ExportMenu,
  Figure,
  FilterBar,
  ListingCard,
  ListingToolbar,
  Th,
} from "~/components/listing";
import { BackLink, Page } from "~/components/page";
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
import { amountOf } from "~/lib/reports";
import {
  PERIOD_PRESETS,
  rangeQuery,
  readDay,
  resolveReportRange,
} from "~/lib/period";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/report-collections";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Collections by staff · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = {
  title: "Collections by staff",
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /reports/collections` — who brought in what.
 *
 * This is the reconciliation report: susu and savings deposits grouped by
 * whoever recorded them, over a range that defaults to the last 30 Accra days.
 * A collector counts their bag against their own row at the end of a round, so
 * the two modules are kept apart rather than summed into one figure — the cash
 * they are holding is susu plus savings, but the *count* that has to match is
 * per module.
 *
 * The payload is read defensively. Deployments differ on `rows` versus `items`
 * and on `total` versus `amount`, and a reconciliation screen that renders a
 * blank because of a key name is worse than useless.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const from = readDay(url.searchParams, "from");
  const to = readDay(url.searchParams, "to");
  // A report with no dates is not showing everything — the API answers with
  // the last thirty days — so the period is resolved here and printed.
  const period = resolveReportRange(from, to);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const [report, staff] = await Promise.all([
      getCollections(token, { from: from || undefined, to: to || undefined }),
      // The report names a collector by id on some deployments and by name on
      // others. Reading `/users` once covers the case where it is only an id.
      listUsers(token, { limit: 100 }).catch(() => null),
    ]);
    return { report, staff };
  });

  const names = new Map<string, string>(
    result.staff?.items.map((u) => [u.id, u.name]) ?? [],
  );

  const raw = result.report.rows ?? result.report.items ?? [];
  const rows = raw.map((row) => {
    const susu = { count: row.susu?.count ?? 0, amount: row.susu?.amount ?? 0 };
    const savings = {
      count: row.savings?.count ?? 0,
      amount: row.savings?.amount ?? 0,
    };
    return {
      id: row.userId ?? row.name ?? "",
      name:
        row.userName ??
        row.name ??
        (row.userId ? (names.get(row.userId) ?? "Staff") : "Staff"),
      susu,
      savings,
      // Trust the row's own total when it carries one; otherwise the two
      // modules are the whole of it.
      count: row.count ?? susu.count + savings.count,
      total: row.total ?? row.amount ?? susu.amount + savings.amount,
    };
  });

  // Sorted by what each person brought in, because that is the order the
  // question "who is short" is actually asked in.
  rows.sort((a, b) => b.total - a.total);

  const totals = {
    susu: {
      count: result.report.totals?.susu?.count ?? rows.reduce((n, r) => n + r.susu.count, 0),
      amount: result.report.totals?.susu?.amount ?? rows.reduce((n, r) => n + r.susu.amount, 0),
    },
    savings: {
      count: result.report.totals?.savings?.count ?? rows.reduce((n, r) => n + r.savings.count, 0),
      amount:
        result.report.totals?.savings?.amount ?? rows.reduce((n, r) => n + r.savings.amount, 0),
    },
    count: result.report.totals?.count ?? rows.reduce((n, r) => n + r.count, 0),
    amount: amountOf(result.report.totals ?? {}) || rows.reduce((n, r) => n + r.total, 0),
  };

  return data(
    {
      rows,
      totals,
      // What the API settled on, which is what the chip echoes — nobody should
      // have to guess what "no filter" covered.
      range: { from: result.report.from ?? period.from, to: result.report.to ?? period.to },
      period,
    },
    { headers },
  );
}

export default function ReportCollections({ loaderData }: Route.ComponentProps) {
  const { rows, totals, range, period } = loaderData;
  const submit = useSubmit();
  const navigation = useNavigation();
  const busy = navigation.state === "loading";

  const apply = (next: { from: string; to: string }) => {
    const params = new URLSearchParams();
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    submit(params, { method: "get", action: "/reports/collections" });
  };

  // The RESOLVED period, not the chosen one: a download with no dates would
  // be re-defaulted by the API, and a file that quietly covers a different
  // period from the screen it came off is worse than no file.
  const query = new URLSearchParams(rangeQuery(period.from, period.to));

  return (
    <Page className="max-w-none">
      <BackLink to="/reports" className="mb-4">
        All reports
      </BackLink>

      <dl className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Collected"
          value={formatPesewas(totals.amount)}
          hint={`${formatCount(totals.count)} deposit${totals.count === 1 ? "" : "s"}`}
          tone="success"
        />
        <Figure
          label="Susu"
          value={formatPesewas(totals.susu.amount)}
          hint={`${formatCount(totals.susu.count)} deposit${totals.susu.count === 1 ? "" : "s"}`}
        />
        <Figure
          label="Savings"
          value={formatPesewas(totals.savings.amount)}
          hint={`${formatCount(totals.savings.count)} deposit${totals.savings.count === 1 ? "" : "s"}`}
        />
        <Figure
          label="Staff collecting"
          value={formatCount(rows.length)}
          tone="muted"
        />
      </dl>

      <ListingCard>
        <ListingToolbar>
          <PeriodFilter
            from={period.from}
            to={period.to}
            active={period.active}
            apply={apply}
            title="Collected"
            presets={PERIOD_PRESETS}
          />
          <ExportMenu
            path="/reports/collections/export"
            query={query.toString()}
            total={rows.length}
            noun="row"
          />
        </ListingToolbar>

        {/* The range is always stated, filter or not: the API silently defaults
            to the last 30 days, and a total with no period beside it is a
            figure nobody can check. */}
        <FilterBar total={rows.length} noun="collector" plural="collectors">
          <DayRangeChip
            from={range.from}
            to={range.to}
            onDrop={() => apply({ from: "", to: "" })}
          />
        </FilterBar>

        {rows.length === 0 ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing was collected</EmptyTitle>
              <EmptyDescription>
                No susu or savings deposit was recorded by anyone over this
                range. Widen it, or check that the days are the right way round.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table className={busy ? "opacity-60 transition-opacity" : undefined}>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Collected by</Th>
                  <Th className="text-right">Susu</Th>
                  <Th className="text-right">Savings</Th>
                  <Th className="text-right">Deposits</Th>
                  <Th className="text-right">Total</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id || row.name}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="tabular text-right">
                      {row.susu.count === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          {formatPesewas(row.susu.amount)}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {formatCount(row.susu.count)}
                          </span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {row.savings.count === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          {formatPesewas(row.savings.amount)}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {formatCount(row.savings.count)}
                          </span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right text-muted-foreground">
                      {formatCount(row.count)}
                    </TableCell>
                    <TableCell className="tabular text-right font-semibold">
                      {formatPesewas(row.total)}
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
