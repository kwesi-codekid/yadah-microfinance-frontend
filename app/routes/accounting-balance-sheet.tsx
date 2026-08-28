import { CircleAlertIcon, CircleCheckIcon, ScaleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { data, useNavigation, useSubmit } from "react-router";

import { getBalanceSheet } from "~/api/accounting";
import {
  AsOfFilter,
  ExportMenu,
  Figure,
  ListingCard,
  ListingToolbar,
} from "~/components/listing";
import { Page } from "~/components/page";
import { netWorth } from "~/lib/accounting";
import {
  formatAccraDateTime,
  formatAmount,
  formatDayRange,
  formatPesewas,
} from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/accounting-balance-sheet";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Balance sheet · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page, and the line under it. */
export const handle = {
  title: "Balance sheet",
  description: "What the business owns, owes and is worth on one day.",
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /accounting/balance-sheet` — the position on one day.
 *
 * Two things the API states plainly and this page repeats. Customer deposits
 * are liabilities: susu and savings balances are held on someone else's behalf
 * and repayable. And loans receivable is principal outstanding: interest is
 * recognised as it is repaid, so uncollected interest is disclosed separately
 * rather than counted as an asset.
 *
 * `checkDifference` is assets less liabilities and equity, and should be zero.
 * It is reported rather than hidden — a non-zero figure means the derived cash
 * position and the recorded books have drifted, usually opening cash without
 * matching opening capital — so the page leads with it when it is not.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);
  const asOfParam = url.searchParams.get("asOf") ?? "";
  const asOf = DAY_RE.test(asOfParam) ? asOfParam : "";

  const { data: sheet, headers } = await withAuth(request, (token) =>
    getBalanceSheet(token, { asOf: asOf || undefined }),
  );

  return data({ sheet, filters: { asOf } }, { headers });
}

export default function AccountingBalanceSheet({ loaderData }: Route.ComponentProps) {
  const { sheet, filters } = loaderData;
  const submit = useSubmit();
  const navigation = useNavigation();
  const busy =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/accounting/balance-sheet";

  const apply = (asOf: string) => {
    const params = new URLSearchParams();
    if (asOf) params.set("asOf", asOf);
    submit(params, { method: "get", action: "/accounting/balance-sheet", replace: true });
  };

  const query = new URLSearchParams();
  if (filters.asOf) query.set("asOf", filters.asOf);

  const a = sheet.assets;
  const l = sheet.liabilities;
  const e = sheet.equity;
  const off = !sheet.balances || sheet.checkDifference !== 0;

  return (
    <Page>

      <ListingCard>
        <ListingToolbar>
          <AsOfFilter
            value={filters.asOf}
            apply={apply}
            title="Read the sheet as at"
          />
          <ExportMenu
            path="/accounting/balance-sheet/export"
            query={query.toString()}
            total={1}
            label={`As at ${formatDayRange(sheet.asOf, sheet.asOf)}`}
            pdf
          />
        </ListingToolbar>

        <div className={cn("p-4 sm:p-5", busy && "opacity-60 transition-opacity")}>
          {off ? (
            <p className="mb-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>
                <span className="font-medium">
                  The sheet does not balance by {formatPesewas(Math.abs(sheet.checkDifference))}.
                </span>{" "}
                Assets less liabilities and equity should come to nothing. The
                usual cause is a company account opened with a balance and no
                matching opening capital recorded — the cash is real, but the
                books do not say where it came from.
              </span>
            </p>
          ) : (
            <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
              <CircleCheckIcon className="size-4 text-success" />
              Balances: assets equal liabilities plus equity.
            </p>
          )}

          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Assets" value={formatPesewas(a.total)} hint="What the business owns" tone="info" />
            <Figure label="Liabilities" value={formatPesewas(l.total)} hint="What it owes — customers first" tone="warning" />
            <Figure label="Equity" value={formatPesewas(e.total)} hint="The owner’s stake plus what was kept" />
            <Figure
              label="Net worth"
              value={formatPesewas(netWorth(sheet))}
              hint="Assets less liabilities"
              tone={netWorth(sheet) >= 0 ? "success" : "danger"}
            />
          </dl>

          {/* The statement proper: amounts in one column, subtotals ruled off,
              the way the printed sheet lays them out. */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Statement title="Assets" total={a.total}>
              <Group title="Current">
                <Line label="Cash and bank" value={a.current.cashAndBank} />
                <Line label="Loans receivable" value={a.current.loansReceivable} hint="Principal outstanding" />
                <Line label="Hire purchase receivable" value={a.current.hirePurchaseReceivable} />
                <Line label="Inventory" value={a.current.inventory} hint="Stock on the shelf, at cost" />
                <Subtotal value={a.current.total} />
              </Group>
              <Group title="Non-current">
                <Line label="Fixed assets, at cost" value={a.nonCurrent.fixedAssetsAtCost} />
                <Line label="Accumulated depreciation" value={-a.nonCurrent.accumulatedDepreciation} />
                <Subtotal value={a.nonCurrent.netBookValue} label="Net book value" />
              </Group>
            </Statement>

            <div className="space-y-6">
              <Statement title="Liabilities" total={l.total}>
                <Group title="Customer deposits">
                  <Line label="Susu balances" value={l.customerDeposits.susuBalances} />
                  <Line label="Savings balances" value={l.customerDeposits.savingsBalances} />
                  <Line label="Susu payouts pending" value={l.customerDeposits.susuPayoutsPending} />
                  <Subtotal value={l.customerDeposits.total} />
                </Group>
                <Group title="Other">
                  <Line label="Accrued expenses" value={l.accruedExpenses} hint="Approved, not yet paid" />
                </Group>
              </Statement>

              <Statement title="Equity" total={e.total}>
                <Group>
                  <Line label="Contributed capital" value={e.contributedCapital} />
                  <Line label="Drawings" value={-e.drawings} />
                  <Line label="Retained earnings" value={e.retainedEarnings} hint="Profit kept, all time" />
                </Group>
              </Statement>
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">Notes</p>
            <p>
              Customer deposits are liabilities: money held on someone else&rsquo;s
              behalf, repayable on demand. Loans receivable is shown at principal
              outstanding; interest is recognised as it is repaid, so{" "}
              {formatPesewas(sheet.disclosures.unearnedLoanInterest)} of loan interest
              and {formatPesewas(sheet.disclosures.unearnedHpInterest)} of hire purchase
              interest still to be collected are disclosed here rather than counted
              as assets.
              {sheet.disclosures.note ? ` ${sheet.disclosures.note}` : ""}
            </p>
            <p className="mt-2 flex items-center gap-1.5">
              <ScaleIcon className="size-3.5" />
              As at {formatDayRange(sheet.asOf, sheet.asOf)}, generated{" "}
              {formatAccraDateTime(sheet.generatedAt)}. Amounts in cedis.
            </p>
          </div>
        </div>
      </ListingCard>
    </Page>
  );
}

/* --------------------------------------------------------------- statement --- */

/** One side of the sheet: a heading, its groups, and a double-ruled total. */
function Statement({
  title,
  total,
  children,
}: {
  title: string;
  total: number;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border">
      <h3 className="border-b border-border px-4 py-2.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="divide-y divide-border">{children}</div>
      <div className="flex items-baseline justify-between gap-4 border-t-2 border-double border-foreground/60 px-4 py-2.5">
        <span className="text-sm font-semibold">Total {title.toLowerCase()}</span>
        <span className="tabular text-sm font-bold">{formatAmount(total)}</span>
      </div>
    </section>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="px-4 py-2">
      {title && (
        <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      )}
      <dl>{children}</dl>
    </div>
  );
}

/**
 * One line of the statement. Negatives print in parentheses, as they do on
 * the paper version, so a deduction reads as one before the sign is noticed.
 */
function Line({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-sm">
        {label}
        {hint && <span className="ml-1.5 text-xs text-muted-foreground">{hint}</span>}
      </dt>
      <dd className={cn("tabular text-sm", value < 0 && "text-muted-foreground")}>
        {value < 0 ? `(${formatAmount(-value)})` : formatAmount(value)}
      </dd>
    </div>
  );
}

function Subtotal({ value, label = "Subtotal" }: { value: number; label?: string }) {
  return (
    <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-border pt-1.5">
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="tabular text-sm font-semibold">{formatAmount(value)}</dd>
    </div>
  );
}
