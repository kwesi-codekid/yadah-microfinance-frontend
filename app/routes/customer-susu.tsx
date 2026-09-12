import { PiggyBankIcon } from "lucide-react";
import { data, Link, useNavigation } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { getCustomer } from "~/api/customers";
import { listAccounts } from "~/api/susu";
import {
  HoldingsPage,
  HOLDINGS_PAGE_SIZE,
  pageFrom,
} from "~/components/customer-holdings";
import { SusuStatusPill } from "~/components/susu-bits";
import { Button } from "~/components/ui/button";
import type { Column } from "~/components/ui/data-table";
import { formatPesewas } from "~/lib/format";
import {
  CYCLE_TARGET,
  heldBalance,
  isStopped,
  type SusuAccount,
} from "~/lib/susu";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/customer-susu";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.customer.fullName ?? "Customer";
  return [{ title: `Susu · ${name} · Yadah Dynamic Enterprise` }];
}

/** What the layout header calls this page. */
export const handle = { title: "Susu" };

/**
 * One customer's susu cycles — the page that stops the counter walking back to
 * the susu listing to find somebody they already have open. Every row leads to
 * the cycle, and an open one carries the deposit button.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);
  const page = pageFrom(new URL(request.url));

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const [list, customer] = await Promise.all([
        listAccounts(token, {
          customerId: params.id,
          page,
          limit: HOLDINGS_PAGE_SIZE,
        }),
        getCustomer(token, params.id),
      ]);
      return { list, customer: customer.customer };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data(
    {
      rows: result.list.items,
      total: result.list.total,
      page,
      customer: result.customer,
    },
    { headers },
  );
}

export default function CustomerSusu({ loaderData }: Route.ComponentProps) {
  const { rows, total, page, customer } = loaderData;
  const busy = useNavigation().state === "loading";

  const columns: Column<SusuAccount>[] = [
    {
      key: "account",
      header: "Account",
      cell: (a) => (
        <Link
          to={`/susu/${a.id}`}
          className="tabular font-medium underline-offset-4 hover:underline"
        >
          #{a.accountNumber}
        </Link>
      ),
    },
    {
      // Every row on this page belongs to one customer, so every account
      // number on it is the same string. This is the only thing separating
      // two cycles of the same month.
      key: "ref",
      header: "Ref",
      className: "tabular hidden text-xs text-muted-foreground lg:table-cell",
      cell: (a) => a.ref,
    },
    {
      key: "daily",
      header: "Daily",
      align: "end",
      className: "tabular",
      cell: (a) => formatPesewas(a.dailyAmount),
    },
    {
      key: "progress",
      header: "Progress",
      className: "hidden text-muted-foreground sm:table-cell",
      cell: (a) => `${a.depositsCount} of ${a.cycleTarget || CYCLE_TARGET}`,
    },
    {
      key: "balance",
      header: "Balance",
      align: "end",
      className: "tabular",
      // A completed cycle still holds its money — it just takes no more
      // deposits. Only a stopped one holds nothing, and that is quoted on what
      // passed through it rather than on a balance it no longer has.
      cell: (a) =>
        isStopped(a) ? (
          <span className="text-muted-foreground">
            {formatPesewas(a.totalDeposited)} saved
          </span>
        ) : (
          formatPesewas(heldBalance(a))
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (a) => <SusuStatusPill status={a.status} />,
    },
    {
      key: "act",
      header: "",
      align: "end",
      cell: (a) =>
        a.status === "active" ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/susu/${a.id}/deposit`}>Deposit</Link>
          </Button>
        ) : null,
    },
  ];

  return (
    <HoldingsPage
      customer={customer}
      title="Susu cycles"
      noun={{ one: "cycle", many: "cycles" }}
      columns={columns}
      rows={rows}
      rowKey={(a) => a.id}
      page={page}
      pageSize={HOLDINGS_PAGE_SIZE}
      total={total}
      loading={busy}
      emptyTitle="No susu cycle"
      emptyBody={`${customer.fullName} has never had one opened.`}
      emptyIcon={<PiggyBankIcon className="size-5" />}
      openTo="/susu/new"
      openLabel="Open a cycle"
    />
  );
}
