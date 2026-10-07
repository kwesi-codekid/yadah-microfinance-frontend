import { BanknoteIcon } from "lucide-react";
import { data, Link, useNavigation } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { getCustomer } from "~/api/customers";
import { listAccounts } from "~/api/savings";
import {
  HoldingsPage,
  HOLDINGS_PAGE_SIZE,
  pageFrom,
} from "~/components/customer-holdings";
import { StatusPill } from "~/components/listing";
import { Button } from "~/components/ui/button";
import type { Column } from "~/components/ui/data-table";
import { formatAccraDate, formatPesewas } from "~/lib/format";
import {
  ACCOUNT_TYPE_LABELS,
  SAVINGS_STATUS_LABELS,
  SAVINGS_STATUS_TONE,
  type SavingsAccount,
} from "~/lib/savings";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/customer-savings";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.customer.fullName ?? "Customer";
  return [{ title: `Savings · ${name} · Yadah Dynamic Enterprise` }];
}

/** What the layout header calls this page. */
export const handle = { title: "Savings" };

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);
  const page = pageFrom(new URL(request.url));

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const [list, customer, guarding] = await Promise.all([
        listAccounts(token, {
          customerId: params.id,
          page,
          limit: HOLDINGS_PAGE_SIZE,
        }),
        getCustomer(token, params.id),
        // Fixed deposits held by their children, which this parent keeps.
        listAccounts(token, { guardianId: params.id, limit: 50 }),
      ]);
      return { list, customer: customer.customer, guarding: guarding.items };
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
      guarding: result.guarding,
    },
    { headers },
  );
}

export default function CustomerSavings({ loaderData }: Route.ComponentProps) {
  const { rows, total, page, customer, guarding } = loaderData;
  const busy = useNavigation().state === "loading";

  const columns: Column<SavingsAccount>[] = [
    {
      key: "account",
      header: "Account",
      cell: (a) => (
        <Link
          to={`/savings/${a.id}`}
          className="tabular font-medium underline-offset-4 hover:underline"
        >
          #{a.accountNumber}
        </Link>
      ),
    },
    {
      key: "type",
      header: "Type",
      className: "hidden text-muted-foreground sm:table-cell",
      cell: (a) => ACCOUNT_TYPE_LABELS[a.accountType],
    },
    {
      key: "balance",
      header: "Balance",
      align: "end",
      className: "tabular font-medium",
      cell: (a) => formatPesewas(a.balance),
    },
    {
      key: "available",
      header: "Available",
      align: "end",
      // What may actually leave today: the balance less the minimum and the
      // fee. Quoting the balance alone is what makes a refused withdrawal a
      // surprise at the counter.
      className: "tabular hidden text-muted-foreground md:table-cell",
      cell: (a) => formatPesewas(a.availableToWithdraw),
    },
    {
      key: "status",
      header: "Status",
      cell: (a) => (
        <StatusPill
          tone={SAVINGS_STATUS_TONE[a.status]}
          label={SAVINGS_STATUS_LABELS[a.status]}
        />
      ),
    },
    {
      key: "act",
      header: "",
      align: "end",
      cell: (a) =>
        a.status === "active" ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/savings/${a.id}/deposit`}>Deposit</Link>
          </Button>
        ) : null,
    },
  ];

  return (
    <HoldingsPage
      customer={customer}
      title="Savings accounts"
      noun={{ one: "account", many: "accounts" }}
      columns={columns}
      rows={rows}
      rowKey={(a) => a.id}
      page={page}
      pageSize={HOLDINGS_PAGE_SIZE}
      total={total}
      loading={busy}
      emptyTitle="No savings account"
      emptyBody={`${customer.fullName} has never had one opened.`}
      emptyIcon={<BanknoteIcon className="size-5" />}
      openTo="/savings/new"
      openLabel="Open an account"
      after={guarding.length > 0 && <ChildrensDeposits accounts={guarding} />}
    />
  );
}

/**
 * The fixed deposits this customer keeps for their children. The money is the
 * child's, so the accounts live on the child's record — but the parent is the
 * one at the counter asking after them, and the only one paid out of them.
 */
function ChildrensDeposits({ accounts }: { accounts: SavingsAccount[] }) {
  return (
    <section className="mt-8">
      <h3 className="mb-3 font-heading text-lg font-semibold tracking-tight">
        Children's fixed deposits
      </h3>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <ul className="divide-y divide-border">
          {accounts.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <Link
                  to={`/savings/${a.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {a.customerName}
                </Link>
                <p className="tabular text-xs text-muted-foreground">
                  #{a.accountNumber}
                  {a.status === "closed"
                    ? " · Closed"
                    : a.matured
                      ? " · Matured"
                      : a.maturesOn
                        ? ` · Matures ${formatAccraDate(a.maturesOn)}`
                        : ""}
                </p>
              </div>
              <p className="tabular font-medium">{formatPesewas(a.balance)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
