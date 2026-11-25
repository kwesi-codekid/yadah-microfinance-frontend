import {
  PiggyBankIcon,
  PlusIcon,
  ReceiptIcon,
} from "lucide-react";
import { data, Link, Outlet, useNavigation } from "react-router";

import { getCashPosition, listCashAccounts } from "~/api/accounting";
import { StatusPill } from "~/components/listing";
import { Page } from "~/components/page";
import { StatBand, StatCard } from "~/components/stat-band";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { DataTable, type Column } from "~/components/ui/data-table";
import { DropdownMenuItem } from "~/components/ui/dropdown-menu";
import {
  CASH_ACCOUNT_KIND_LABELS,
  CASH_CHANNEL_LABELS,
  type CashAccount,
  type CashAccountKind,
  type CashChannel,
} from "~/lib/accounting";
import { formatAccraDate, formatCount, formatPesewas } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/accounting";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Accounting · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = {
  title: "Accounting",
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /accounting/cash-position` and `GET /accounting/cash-accounts` — the
 * front page of the books.
 *
 * The position is derived on every read: opening balance, plus customer money
 * in and out on that channel, plus capital, less expenses paid and assets
 * bought. Nothing keeps a running total, so the figure here is never stale and
 * never silently wrong — which is what makes it the one to open with.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireOffice(request);
  const url = new URL(request.url);
  const asOfParam = url.searchParams.get("asOf") ?? "";
  const asOf = DAY_RE.test(asOfParam) ? asOfParam : "";

  const { data: result, headers } = await withAuth(request, async (token) => {
    const [position, accounts] = await Promise.all([
      getCashPosition(token, { asOf: asOf || undefined }),
      listCashAccounts(token),
    ]);
    return { position, accounts };
  });

  const balances = new Map(result.position.accounts.map((a) => [a.id, a.balance]));

  return data(
    {
      isAdmin: user.role === "admin",
      asOf: result.position.asOf || asOf,
      total: result.position.total,
      commission: result.position.commission ?? 0,
      rows: result.accounts.map((account) => toRow(account, balances.get(account.id))),
      // Channels with no active account: customer money recorded on them has
      // nowhere to land, and the page says so rather than showing a short total.
      uncovered: (["cash", "momo", "paystack"] as CashChannel[]).filter(
        (channel) =>
          !result.accounts.some(
            (a) => a.channel === channel && (a.status ?? "active") === "active",
          ),
      ),
    },
    { headers },
  );
}

/** Opening the account drawer does not re-read the position underneath it. */
export const shouldRevalidate = drawerParentShouldRevalidate;

/* -------------------------------------------------------------------- rows --- */

interface Row {
  id: string;
  name: string;
  kind: CashAccountKind;
  channel: CashChannel;
  detail: string;
  openingBalance: number;
  openedOn: string;
  balance: number | null;
  active: boolean;
}

function toRow(account: CashAccount, balance: number | undefined): Row {
  return {
    id: account.id,
    name: account.name,
    kind: account.kind,
    channel: account.channel,
    detail: [account.bankName, account.accountNumber].filter(Boolean).join(" · "),
    openingBalance: account.openingBalance,
    openedOn: account.openingDate ? formatAccraDate(`${account.openingDate}T12:00:00Z`) : "",
    balance: balance ?? null,
    active: (account.status ?? "active") === "active",
  };
}

/* -------------------------------------------------------------------- page --- */

/**
 * The position over the accounts it is read off, with the books themselves
 * in the rail alongside. Drawn like the dashboard — figures first, then the table — because
 * that is the order the office reads it in: how much is there, then where.
 */
export default function Accounting({ loaderData }: Route.ComponentProps) {
  const { isAdmin, total, rows, uncovered } = loaderData;
  const navigation = useNavigation();
  const busy =
    navigation.state === "loading" && navigation.location?.pathname === "/accounting";

  const active = rows.filter((r) => r.active).length;
  const largest = rows.reduce<Row | null>(
    (best, row) =>
      row.balance != null && (best?.balance == null || row.balance > best.balance)
        ? row
        : best,
    null,
  );

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Account",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {CASH_ACCOUNT_KIND_LABELS[row.kind] ?? row.kind}
            {row.detail ? ` · ${row.detail}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "channel",
      header: "Channel",
      className: "hidden text-muted-foreground md:table-cell",
      cell: (row) => CASH_CHANNEL_LABELS[row.channel] ?? row.channel,
    },
    {
      key: "opened",
      header: "Opened with",
      align: "end",
      className: "tabular hidden lg:table-cell",
      cell: (row) => (
        <>
          <p>{formatPesewas(row.openingBalance)}</p>
          {row.openedOn && <p className="text-xs text-muted-foreground">{row.openedOn}</p>}
        </>
      ),
    },
    {
      key: "balance",
      header: "Holds · GH₵",
      align: "end",
      cell: (row) =>
        row.balance == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span
            className={cn(
              "tabular font-semibold",
              row.balance < 0 ? "text-danger" : "text-foreground",
            )}
          >
            {formatPesewas(row.balance)}
          </span>
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusPill
          label={row.active ? "Active" : "Closed"}
          blurb={
            row.active
              ? "Takes the customer money recorded on its channel."
              : "No longer takes money."
          }
          tone={row.active ? "success" : "muted"}
        />
      ),
    },
  ];

  return (
    <Page className="max-w-none">
      <div className="mb-4">
        <StatBand>
          <StatCard label="Cash position" value={formatPesewas(total)} tone="in" />
          <StatCard label="Accounts" value={formatCount(active)} />
          <StatCard
            label="Largest holding"
            value={largest?.balance != null ? formatPesewas(largest.balance) : "—"}
            tone="revenue"
          />
          <StatCard
            label="Channels uncovered"
            value={formatCount(uncovered.length)}
            tone={uncovered.length === 0 ? "neutral" : "out"}
          />
        </StatBand>
      </div>

      <DataTable
        actions={
          isAdmin ? (
            <Button asChild size="sm">
              <Link to="/accounting/accounts/new" prefetch="intent" preventScrollReset>
                <PlusIcon />
                Open an account
              </Link>
            </Button>
          ) : null
        }
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={busy}
        rowActions={(row) => (
          <>
            <DropdownMenuItem asChild>
              <Link to={`/expenses?account=${row.id}&status=paid`}>
                <ReceiptIcon />
                Expenses paid from here
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild disabled={!isAdmin || !row.active}>
              <Link to={`/accounting/capital/new?account=${row.id}`} preventScrollReset>
                <PiggyBankIcon />
                Record capital into it
              </Link>
            </DropdownMenuItem>
          </>
        )}
        noun={{ one: "account", many: "accounts" }}
        pageSize={10}
        empty={
          isAdmin
            ? "No company accounts yet. Open one with the balance it really holds today, and record the matching opening capital so the balance sheet balances from day one."
            : "No company accounts yet. An admin opens them."
        }
      />


      {/* Opening an account renders here, over the position. */}
      <Outlet />
    </Page>
  );
}

