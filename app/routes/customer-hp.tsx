import { ReceiptTextIcon } from "lucide-react";
import { data, Link, useNavigation } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { getCustomer } from "~/api/customers";
import { listAgreements } from "~/api/hire-purchase";
import {
  HoldingsPage,
  HOLDINGS_PAGE_SIZE,
  pageFrom,
} from "~/components/customer-holdings";
import { StatusPill } from "~/components/listing";
import { Button } from "~/components/ui/button";
import type { Column } from "~/components/ui/data-table";
import { formatPesewas } from "~/lib/format";
import {
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_STATUS_TONE,
  type HpAgreement,
} from "~/lib/hire-purchase";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/customer-hp";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.customer.fullName ?? "Customer";
  return [{ title: `Hire purchase · ${name} · Yadah Dynamic Enterprise` }];
}

/** What the layout header calls this page. */
export const handle = { title: "Hire purchase" };

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);
  const page = pageFrom(new URL(request.url));

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const [list, customer] = await Promise.all([
        listAgreements(token, {
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

export default function CustomerHp({ loaderData }: Route.ComponentProps) {
  const { rows, total, page, customer } = loaderData;
  const busy = useNavigation().state === "loading";

  const columns: Column<HpAgreement>[] = [
    {
      key: "item",
      header: "Item",
      cell: (a) => (
        <Link
          to={`/hire-purchase/${a.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {a.item.name}
        </Link>
      ),
    },
    {
      key: "paid",
      header: "Paid",
      align: "end",
      className: "tabular hidden sm:table-cell",
      cell: (a) => formatPesewas(a.totalPaid),
    },
    {
      key: "payable",
      header: "Financed",
      align: "end",
      className: "tabular hidden text-muted-foreground md:table-cell",
      // Only set once the deposit lands and the agreement activates.
      cell: (a) =>
        a.totalPayable != null ? formatPesewas(a.totalPayable) : "—",
    },
    {
      key: "remaining",
      header: "Still to pay",
      align: "end",
      className: "tabular font-medium",
      cell: (a) => formatPesewas(a.remaining),
    },
    {
      key: "status",
      header: "Status",
      cell: (a) => (
        <StatusPill
          tone={AGREEMENT_STATUS_TONE[a.status]}
          label={AGREEMENT_STATUS_LABELS[a.status]}
        />
      ),
    },
    {
      key: "act",
      header: "",
      align: "end",
      cell: (a) =>
        a.status === "active" || a.status === "in-arrears" ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/hire-purchase/${a.id}/pay`}>Pay</Link>
          </Button>
        ) : null,
    },
  ];

  return (
    <HoldingsPage
      customer={customer}
      title="Hire purchase"
      noun={{ one: "agreement", many: "agreements" }}
      columns={columns}
      rows={rows}
      rowKey={(a) => a.id}
      page={page}
      pageSize={HOLDINGS_PAGE_SIZE}
      total={total}
      loading={busy}
      emptyTitle="No agreement"
      emptyBody={`${customer.fullName} has never signed one.`}
      emptyIcon={<ReceiptTextIcon className="size-5" />}
      // As on the loans page: the form picks its own customer.
      openTo="/hire-purchase/new"
      openLabel="Sign an agreement"
    />
  );
}
