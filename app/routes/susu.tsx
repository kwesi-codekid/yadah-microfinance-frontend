import { data, Link, useNavigation, useSearchParams } from "react-router";
import { PiggyBank, X } from "lucide-react";
import type { Route } from "./+types/susu";
import { DataTable, Table } from "~/components/data-table";
import { FilterSelect } from "~/components/form-fields";
import { CycleBar, StatusPill } from "~/components/susu-cycle";
import { formatGhs } from "~/lib/money";
import * as customersApi from "~/lib/api/customers";
import * as susuApi from "~/lib/api/susu";
import {
  isSusuAccountStatus,
  type SusuAccountStatus,
} from "~/lib/susu-client";
import { requireUser, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Susu accounts · YADAH Dynamic Enterprise" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  // Every role may list: the API scopes collectors to the accounts of their own
  // assigned customers, so there is nothing to guard here beyond being signed in.
  await requireUser(request);

  const sp = new URL(request.url).searchParams;
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  const limit = Math.max(1, Number(sp.get("limit") || "20") || 20);
  // "All" is a real choice here — unlike customers, the API returns accounts of
  // every status when the filter is omitted. Active is the working set, so it
  // stays the default and the other three are opt-in.
  const statusParam = sp.get("status");
  const selected =
    isSusuAccountStatus(statusParam) || statusParam === "all"
      ? statusParam
      : "active";
  const status: SusuAccountStatus | undefined =
    selected === "all" ? undefined : selected;
  const customerId = sp.get("customer")?.trim() || undefined;

  const { data: result, headers } = await withAuth(request, async (token) => {
    const accounts = await susuApi.listSusuAccounts(token, {
      page,
      limit,
      status,
      customerId,
    });

    /**
     * Accounts carry a `customerId` and nothing else, and an id on a screen is
     * no use to anyone — so the names are fetched one call per customer on this
     * page. It is an N+1, capped at the page size and run in parallel; the fix
     * belongs in the API, which already embeds `customerName` in
     * `/susu/summary` and could do the same here.
     *
     * `allSettled`, not `all`: a single customer the API declines to return
     * should cost that row its name, not sink the whole page.
     */
    const ids = [...new Set(accounts.items.map((a) => a.customerId))];
    const settled = await Promise.allSettled(
      ids.map((id) => customersApi.getCustomer(token, id)),
    );
    const customerNames: Record<string, string> = {};
    settled.forEach((outcome, i) => {
      if (outcome.status === "fulfilled") {
        customerNames[ids[i]] = outcome.value.customer.fullName;
      }
    });

    return { accounts, customerNames };
  });

  return data(
    {
      result: result.accounts,
      customerNames: result.customerNames,
      filters: { page, limit, status: selected, customer: customerId ?? "" },
    },
    { headers },
  );
}

export default function Susu({ loaderData }: Route.ComponentProps) {
  const { result, customerNames, filters } = loaderData;
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();

  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));
  const filteredName = filters.customer
    ? (customerNames[filters.customer] ?? "this customer")
    : null;

  function setParam(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next);
  }

  return (
    <div className="mx-auto w-full px-6 py-8">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Susu accounts
        </h1>
        <p className="mt-1 text-sm text-muted">
          Each account is one cycle of 31 days at a fixed daily amount.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterSelect
          name="status"
          label="Filter by status"
          value={filters.status}
          onChange={(value) => setParam({ status: value, page: null })}
          options={[
            { value: "active", label: "Active accounts" },
            { value: "completed", label: "Completed accounts" },
            { value: "closed", label: "Closed accounts" },
            { value: "all", label: "All accounts" },
          ]}
        />

        {/* There is no customer dropdown here on purpose: a business with
            thousands of customers can't be put in a select, and the API caps a
            page at 100 anyway. The filter is set by following "All accounts"
            from a customer's page, and this chip is how you get back out of it. */}
        {filteredName && (
          <button
            type="button"
            onClick={() => setParam({ customer: null, page: null })}
            className="flex min-h-8 items-center gap-1.5 rounded-md border-2 border-border bg-field px-3 text-sm text-foreground transition-colors hover:bg-background"
          >
            <span className="text-muted">Customer:</span>
            <span className="font-medium">{filteredName}</span>
            <X size={14} aria-hidden="true" />
            <span className="sr-only">Clear the customer filter</span>
          </button>
        )}
      </div>

      <DataTable
        columns={["Customer", "Daily", "Progress", "Saved", "Status"]}
        ariaLabel="Susu accounts"
        isLoading={navigation.state === "loading"}
        page={result.page}
        pageCount={pageCount}
        onPageChange={(p) => setParam({ page: String(p) })}
        pageSize={result.limit}
        onPageSizeChange={(s) => setParam({ limit: String(s), page: "1" })}
        emptyContent={{
          icon: <PiggyBank size={20} />,
          title: "No susu accounts found",
          subtext:
            filters.status === "active"
              ? "Open one from a customer's page — an account belongs to a customer, so that is where it starts."
              : "Nothing matches this filter.",
        }}
      >
        {result.items.map((account) => (
          <Table.Row key={account.id} id={account.id}>
            <Table.Cell className="px-4 py-2 font-medium text-foreground">
              <Link
                to={`/susu/${account.id}`}
                className="hover:text-success hover:underline"
              >
                {customerNames[account.customerId] ?? "Unknown customer"}
              </Link>
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {formatGhs(account.dailyAmount)}
            </Table.Cell>
            <Table.Cell className="px-4 py-2">
              <CycleBar account={account} />
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {formatGhs(account.totalDeposited)}
            </Table.Cell>
            <Table.Cell className="px-4 py-2">
              <StatusPill account={account} />
            </Table.Cell>
          </Table.Row>
        ))}
      </DataTable>
    </div>
  );
}
