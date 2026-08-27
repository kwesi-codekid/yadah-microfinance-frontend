import { data, useNavigation, useSubmit } from "react-router";

import { getCommission } from "~/api/reports";
import {
  DayRangeChip,
  DayRangeFilter,
  ExportMenu,
  Figure,
  FilterBar,
  ListingCard,
  ListingToolbar,
} from "~/components/listing";
import { BackLink, Page, PageHeader } from "~/components/page";
import { formatCount, formatPesewas } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/report-commission";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Commission and fees · Yadah Dynamic Enterprise" }];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /reports/commission` — the part that stays.
 *
 * Everything else in this app is money passing through: a deposit is the
 * customer's, a loan goes back out, a transfer only moves between two of their
 * own pockets. Revenue is the two places the branch actually keeps something —
 * one day's deposit when a susu cycle stops, and the flat fee on a savings
 * withdrawal or closure — and it is worth a screen of its own precisely because
 * it is so much smaller than the figures beside it on the dashboard.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : "";
  };
  const from = day("from");
  const to = day("to");

  const { data: report, headers } = await withAuth(request, (token) =>
    getCommission(token, { from: from || undefined, to: to || undefined }),
  );

  const susu = {
    count: report.susuCommission?.count ?? 0,
    amount: report.susuCommission?.amount ?? 0,
  };
  const savings = {
    count: report.savingsFees?.count ?? 0,
    amount: report.savingsFees?.amount ?? 0,
  };
  // The third stream, added API-side in August 2026: margin on outright counter
  // sales. Trading profit rather than a fee, but earned in the period, so the
  // API counts it toward `totalRevenue` — and a breakdown that left it out
  // would no longer add up to the total beside it.
  const sales = {
    count: report.outrightSalesProfit?.count ?? 0,
    amount: report.outrightSalesProfit?.amount ?? 0,
  };

  return data(
    {
      susu,
      savings,
      sales,
      // Trust the API's own total when it gives one — it knows about any source
      // of revenue this screen has not been taught to name.
      total: report.totalRevenue ?? susu.amount + savings.amount + sales.amount,
      range: { from: report.from ?? from, to: report.to ?? to },
      filters: { from, to },
    },
    { headers },
  );
}

export default function ReportCommission({ loaderData }: Route.ComponentProps) {
  const { susu, savings, sales, total, range, filters } = loaderData;
  const submit = useSubmit();
  const navigation = useNavigation();
  const busy = navigation.state === "loading";

  const apply = (next: { from: string; to: string }) => {
    const params = new URLSearchParams();
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    submit(params, { method: "get", action: "/reports/commission" });
  };

  const query = new URLSearchParams();
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);

  const events = susu.count + savings.count + sales.count;
  // What the branch keeps out of each event it earned on — the figure that says
  // whether a quiet month was quiet in volume or only in value.
  const average = events > 0 ? Math.round(total / events) : 0;

  return (
    <Page>
      <BackLink to="/reports" className="mb-4">
        All reports
      </BackLink>

      <PageHeader
        title="Commission and fees"
        description="What the branch earned, as opposed to what passed through it."
      />

      <ListingCard>
        <ListingToolbar>
          <DayRangeFilter
            from={filters.from}
            to={filters.to}
            apply={apply}
            title="Earned"
          />
          <ExportMenu
            path="/reports/commission/export"
            query={query.toString()}
            total={events}
            noun="row"
          />
        </ListingToolbar>

        <FilterBar total={events} noun="earning" plural="earnings">
          <DayRangeChip
            from={range.from}
            to={range.to}
            onDrop={() => apply({ from: "", to: "" })}
          />
        </FilterBar>

        <div
          className={
            busy ? "p-4 opacity-60 transition-opacity sm:p-5" : "p-4 sm:p-5"
          }
        >
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Figure
              label="Revenue"
              value={formatPesewas(total)}
              hint={`${formatCount(events)} earning${events === 1 ? "" : "s"}`}
              tone="revenue"
            />
            <Figure
              label="Susu commission"
              value={formatPesewas(susu.amount)}
              hint={`${formatCount(susu.count)} cycle${susu.count === 1 ? "" : "s"} stopped`}
            />
            <Figure
              label="Savings fees"
              value={formatPesewas(savings.amount)}
              hint={`${formatCount(savings.count)} withdrawal${savings.count === 1 ? "" : "s"} and closure${savings.count === 1 ? "" : "s"}`}
            />
            <Figure
              label="Sale margin"
              value={formatPesewas(sales.amount)}
              hint={`${formatCount(sales.count)} counter sale${sales.count === 1 ? "" : "s"}`}
            />
            <Figure
              label="Average"
              value={formatPesewas(average)}
              hint="per earning"
              tone="muted"
            />
          </dl>

          <p className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Susu commission is one day&rsquo;s deposit, taken when a cycle stops.
            Savings fees are the flat charge on a withdrawal or a closure. Sale
            margin is what an outright counter sale made over cost, with voided
            sales left out — trading profit rather than a fee, but money the
            branch kept. Nothing else is revenue: deposits, disbursements and
            transfers are money moving, not money kept.
          </p>
        </div>
      </ListingCard>
    </Page>
  );
}
