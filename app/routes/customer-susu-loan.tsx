import { NotebookPenIcon } from "lucide-react";
import { data, Link, useNavigation } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { getCustomer } from "~/api/customers";
import { listAccounts } from "~/api/susu-loans";
import { HoldingsPage, HOLDINGS_PAGE_SIZE, pageFrom } from "~/components/customer-holdings";
import { SusuStatusPill } from "~/components/susu-bits";
import { Button } from "~/components/ui/button";
import type { Column } from "~/components/ui/data-table";
import { formatPesewas } from "~/lib/format";
import type { SusuLoanAccount } from "~/lib/susu-loans";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/customer-susu-loan";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.customer.fullName ?? "Customer";
  return [{ title: `Susu loan · ${name} · Yadah Dynamic Enterprise` }];
}

/** What the layout header calls this page. */
export const handle = { title: "Susu loan" };

/** One customer's susu loan account — one row, as a customer holds one. */
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

export default function CustomerSusuLoan({ loaderData }: Route.ComponentProps) {
  const { rows, total, page, customer } = loaderData;
  const busy = useNavigation().state === "loading";
  const hasOpen = rows.some((a) => a.status === "active");

  const columns: Column<SusuLoanAccount>[] = [
    {
      key: "account",
      header: "Account",
      cell: (a) => (
        <Link
          to={`/susu-loans/${a.id}`}
          className="tabular font-medium underline-offset-4 hover:underline"
        >
          #{a.accountNumber}
        </Link>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      align: "end",
      className: "tabular",
      cell: (a) => formatPesewas(a.balance),
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
            <Link to={`/susu-loans/${a.id}/deposit`}>Deposit</Link>
          </Button>
        ) : null,
    },
  ];

  return (
    <HoldingsPage
      customer={customer}
      title="Susu loan"
      noun={{ one: "account", many: "accounts" }}
      columns={columns}
      rows={rows}
      rowKey={(a) => a.id}
      page={page}
      pageSize={HOLDINGS_PAGE_SIZE}
      total={total}
      loading={busy}
      emptyTitle="No susu loan account"
      emptyBody={`${customer.fullName} has never had one opened.`}
      emptyIcon={<NotebookPenIcon className="size-5" />}
      openTo={hasOpen ? undefined : "/susu-loans/new"}
      openLabel="Open an account"
    />
  );
}
