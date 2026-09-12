import { LandmarkIcon } from "lucide-react";
import { data, Link, useNavigation } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { getCustomer } from "~/api/customers";
import { listLoans } from "~/api/loans";
import {
  HoldingsPage,
  HOLDINGS_PAGE_SIZE,
  pageFrom,
} from "~/components/customer-holdings";
import { StatusPill } from "~/components/listing";
import { Button } from "~/components/ui/button";
import type { Column } from "~/components/ui/data-table";
import { formatAccraDate, formatPesewas } from "~/lib/format";
import { LOAN_STATUS_LABELS, LOAN_STATUS_TONE, type Loan } from "~/lib/loans";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/customer-loans";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.customer.fullName ?? "Customer";
  return [{ title: `Loans · ${name} · Yadah Dynamic Enterprise` }];
}

/** What the layout header calls this page. */
export const handle = { title: "Loans" };

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);
  const page = pageFrom(new URL(request.url));

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const [list, customer] = await Promise.all([
        listLoans(token, {
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

export default function CustomerLoans({ loaderData }: Route.ComponentProps) {
  const { rows, total, page, customer } = loaderData;
  const busy = useNavigation().state === "loading";

  const columns: Column<Loan>[] = [
    {
      key: "loan",
      header: "Loan",
      cell: (l) => (
        <Link
          to={`/loans/${l.id}`}
          className="font-medium capitalize underline-offset-4 hover:underline"
        >
          {l.tier}
        </Link>
      ),
    },
    {
      key: "principal",
      header: "Borrowed",
      align: "end",
      className: "tabular",
      cell: (l) => formatPesewas(l.principal),
    },
    {
      key: "due",
      header: "Due",
      className: "hidden text-muted-foreground md:table-cell",
      cell: (l) => (l.dueDate ? formatAccraDate(l.dueDate) : "—"),
    },
    {
      key: "remaining",
      header: "Still to pay",
      align: "end",
      className: "tabular font-medium",
      cell: (l) => formatPesewas(l.remaining),
    },
    {
      key: "status",
      header: "Status",
      cell: (l) => (
        <StatusPill
          tone={LOAN_STATUS_TONE[l.status]}
          label={LOAN_STATUS_LABELS[l.status]}
        />
      ),
    },
    {
      key: "act",
      header: "",
      align: "end",
      cell: (l) =>
        l.status === "active" || l.status === "arrears" ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/loans/${l.id}/repay`}>Repay</Link>
          </Button>
        ) : null,
    },
  ];

  return (
    <HoldingsPage
      customer={customer}
      title="Loans"
      noun={{ one: "loan", many: "loans" }}
      columns={columns}
      rows={rows}
      rowKey={(l) => l.id}
      page={page}
      pageSize={HOLDINGS_PAGE_SIZE}
      total={total}
      loading={busy}
      emptyTitle="No loan"
      emptyBody={`${customer.fullName} has never applied for one.`}
      emptyIcon={<LandmarkIcon className="size-5" />}
      // No customerId in the link: the form picks the customer itself and
      // would ignore the param, and a link that looks like it prefills but
      // does not is worse than one that plainly does not.
      openTo="/loans/new"
      openLabel="Apply for a loan"
    />
  );
}
