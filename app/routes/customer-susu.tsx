import { PiggyBankIcon } from "lucide-react";
import { data, Link, useNavigation } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { getCustomer } from "~/api/customers";
import { listAccounts } from "~/api/susu";
import { HoldingsPage, HOLDINGS_PAGE_SIZE, pageFrom } from "~/components/customer-holdings";
import { PlanChip, SusuStatusPill } from "~/components/susu-bits";
import { Button } from "~/components/ui/button";
import type { Column } from "~/components/ui/data-table";
import { formatPesewas } from "~/lib/format";
import { type SusuAccount } from "~/lib/susu";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/customer-susu";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.customer.fullName ?? "Customer";
  return [{ title: `Susu · ${name} · Yadah Dynamic Enterprise` }];
}

/** What the layout header calls this page. */
export const handle = { title: "Susu" };

/**
 * One customer's susu account — one row, as a customer holds one — the page
 * that stops the counter walking back to the susu listing to find somebody
 * they already have open. The row leads to the account, and an open one
 * carries the deposit button.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);
  const page = pageFrom(new URL(request.url));

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const [list, customer] = await Promise.all([
        listAccounts(token, { customerId: params.id, page, limit: HOLDINGS_PAGE_SIZE }),
        getCustomer(token, params.id),
      ]);
      return { list, customer: customer.customer };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data(
    { rows: result.list.items, total: result.list.total, page, customer: result.customer },
    { headers },
  );
}

export default function CustomerSusu({ loaderData }: Route.ComponentProps) {
  const { rows, total, page, customer } = loaderData;
  const busy = useNavigation().state === "loading";
  const hasOpen = rows.some((a) => a.status === "active");

  const columns: Column<SusuAccount>[] = [
    {
      key: "account",
      header: "Account",
      cell: (a) => (
        <Link to={`/susu/${a.id}`} className="tabular font-medium underline-offset-4 hover:underline">
          #{a.accountNumber}
        </Link>
      ),
    },
    {
      key: "plans",
      header: "Plans",
      className: "hidden sm:table-cell",
      cell: (a) => {
        const running = a.plans.filter((p) => p.status === "active");
        return running.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {running.map((p) => (
              <PlanChip key={p.id} plan={p} />
            ))}
          </div>
        );
      },
    },
    {
      key: "balance",
      header: "Balance",
      align: "end",
      className: "tabular",
      cell: (a) =>
        a.status === "active" ? (
          formatPesewas(a.balance)
        ) : (
          <span className="text-muted-foreground">{formatPesewas(a.closePayout ?? 0)} paid out</span>
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
        a.status === "active" && a.dailyTotal > 0 ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/susu/${a.id}/deposit`}>Deposit</Link>
          </Button>
        ) : null,
    },
  ];

  return (
    <HoldingsPage
      customer={customer}
      title="Susu"
      noun={{ one: "account", many: "accounts" }}
      columns={columns}
      rows={rows}
      rowKey={(a) => a.id}
      page={page}
      pageSize={HOLDINGS_PAGE_SIZE}
      total={total}
      loading={busy}
      emptyTitle="No susu account"
      emptyBody={`${customer.fullName} has never had one opened.`}
      emptyIcon={<PiggyBankIcon className="size-5" />}
      // A customer holds one account; once it is open, plans are added on it.
      openTo={hasOpen ? undefined : "/susu/new"}
      openLabel="Open an account"
    />
  );
}
