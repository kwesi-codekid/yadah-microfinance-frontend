import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import type { ReactNode } from "react";
import { data, useNavigation, useSubmit } from "react-router";

import { getProfitAndLoss } from "~/api/accounting";
import {
  ExportMenu,
  PeriodFilter,
} from "~/components/listing";
import { Page } from "~/components/page";
import { StatBand, StatCard } from "~/components/stat-band";
import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from "~/lib/accounting";
import {
  accraDay,
  formatAccraDateTime,
  formatAmount,
  formatDayRange,
  formatPercent,
  formatPesewas,
} from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/accounting-profit-loss";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Profit and loss · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = {
  title: "Profit and loss",
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /accounting/profit-loss` — what the business made over a period.
 *
 * Income is the revenue the reports already know — susu commission, savings
 * fees, sale margin — plus loan and hire purchase interest recognised as it is
 * repaid. Expenses are the recorded categories plus computed depreciation.
 * The API defaults to the current Accra month; the page resolves the same
 * default so the period is always printed beside the figures, because a total
 * with no period next to it is a figure nobody can check.
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
    getProfitAndLoss(token, { from: from || undefined, to: to || undefined }),
  );

  const today = accraDay();
  return data(
    {
      report,
      range: {
        from: report.from ?? from ?? `${today.slice(0, 7)}-01`,
        to: report.to ?? to ?? today,
      },
      filters: { from, to },
    },
    { headers },
  );
}

export default function AccountingProfitLoss({ loaderData }: Route.ComponentProps) {
  const { report, range, filters } = loaderData;
  const submit = useSubmit();
  const navigation = useNavigation();
  const busy =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/accounting/profit-loss";

  const apply = (next: { from: string; to: string }) => {
    const params = new URLSearchParams();
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    submit(params, { method: "get", action: "/accounting/profit-loss", replace: true });
  };

  const query = new URLSearchParams();
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);

  const inc = report.income;
  const exp = report.expenses;
  const profit = report.netProfit;
  const margin = inc.total > 0 ? profit / inc.total : null;

  const incomeLines: { label: string; value: number; hint?: string }[] = [
    { label: "Susu commission", value: inc.susuCommission },
    { label: "Savings fees", value: inc.savingsFees },
    { label: "Sale margin", value: inc.outrightSalesProfit },
    { label: "Loan interest", value: inc.loanInterest },
    {
      label: "Loan processing fees",
      value: inc.loanProcessingFees ?? 0,
    },
    { label: "Hire purchase interest", value: inc.hirePurchaseInterest },
  ];

  const byCategory = [...exp.byCategory].sort((x, y) => y.amount - x.amount);

  return (
    <Page className="max-w-none" contentClassName="space-y-4">
      {/* The same order as every other book: its controls, the figures, then
          the statement itself on a card. */}
      <StatBand>
        <StatCard label="Income" value={formatPesewas(inc.total)} tone="in" />
        <StatCard label="Expenses" value={formatPesewas(exp.total)} tone="out" />
        <StatCard
          label={profit >= 0 ? "Net profit" : "Net loss"}
          value={formatPesewas(Math.abs(profit))}
          tone={profit >= 0 ? "in" : "danger"}
        />
        <StatCard label="Margin" value={margin == null ? "—" : formatPercent(margin)} />
      </StatBand>

      <section
        className={cn(
          "overflow-hidden rounded-2xl bg-card p-4 text-card-foreground sm:p-5",
          busy && "opacity-60 transition-opacity",
        )}
      >
        {/* The book's own actions sit on the card, over the rows they act on. */}
        <div className="-mx-4 -mt-4 mb-4 flex flex-wrap items-center justify-end gap-2 border-b border-border px-4 py-3 sm:-mx-5 sm:-mt-5 sm:mb-5 sm:px-5">
            <PeriodFilter
              from={range.from}
              to={range.to}
              active={Boolean(filters.from || filters.to)}
              apply={apply}
            />
            <ExportMenu
              path="/accounting/profit-loss/export"
              query={query.toString()}
              total={1}
              label={formatDayRange(range.from, range.to)}
              pdf
            />
        </div>


          <div className="grid gap-6 lg:grid-cols-2">
            <Statement
              title="Income"
              icon={<TrendingUpIcon className="size-3.5 text-cash-in" />}
              total={inc.total}
            >
              {incomeLines.map((line) => (
                <Line key={line.label} {...line} />
              ))}
            </Statement>

            <Statement
              title="Expenses"
              icon={<TrendingDownIcon className="size-3.5 text-cash-out" />}
              total={exp.total}
            >
              {byCategory.length === 0 ? (
                <p className="py-1 text-sm text-muted-foreground">
                  Nothing recorded in this period.
                </p>
              ) : (
                byCategory.map((row) => (
                  <Line
                    key={row.category}
                    label={
                      EXPENSE_CATEGORY_LABELS[row.category as ExpenseCategory] ?? row.category
                    }
                    value={row.amount}
                  />
                ))
              )}
              <Line label="Depreciation" value={exp.depreciation} />
            </Statement>
          </div>

          <div className="mt-6 flex items-baseline justify-between gap-4 rounded-lg border-2 border-double border-foreground/60 px-4 py-3">
            <span className="font-heading font-bold tracking-tight">
              {profit >= 0 ? "Net profit" : "Net loss"} for the period
            </span>
            <span
              className={cn(
                "tabular text-lg font-bold",
                profit >= 0 ? "text-success" : "text-danger",
              )}
            >
              {profit < 0 ? `(${formatAmount(-profit)})` : formatAmount(profit)}
            </span>
          </div>

          <p className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Income is what the branch kept, not what passed through it: deposits,
            disbursements and transfers are money moving. Interest counts only as
            it is repaid. Retained earnings on the balance sheet are built from
            these same components over all time, so the two statements can never
            disagree. {formatDayRange(range.from, range.to)}, generated{" "}
            {formatAccraDateTime(report.generatedAt)}.
          </p>
      </section>
    </Page>
  );
}

/* --------------------------------------------------------------- statement --- */

function Statement({
  title,
  icon,
  total,
  children,
}: {
  title: string;
  icon: ReactNode;
  total: number;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border">
      <h3 className="flex items-center gap-1.5 border-b border-border px-4 py-2.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {icon}
        {title}
      </h3>
      <dl className="px-4 py-2">{children}</dl>
      <div className="flex items-baseline justify-between gap-4 border-t-2 border-double border-foreground/60 px-4 py-2.5">
        <span className="text-sm font-semibold">Total {title.toLowerCase()}</span>
        <span className="tabular text-sm font-bold">{formatAmount(total)}</span>
      </div>
    </section>
  );
}

function Line({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-sm">
        {label}
        {hint && <span className="ml-1.5 text-xs text-muted-foreground">{hint}</span>}
      </dt>
      <dd className="tabular text-sm">{formatAmount(value)}</dd>
    </div>
  );
}
