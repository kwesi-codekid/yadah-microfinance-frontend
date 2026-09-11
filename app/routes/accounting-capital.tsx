import { PiggyBankIcon, PlusIcon, WalletIcon } from "lucide-react";
import { data, Link, Outlet, useNavigation } from "react-router";

import { listCapital, listCashAccounts } from "~/api/accounting";
import { StatusPill } from "~/components/listing";
import { Page } from "~/components/page";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
import { Button } from "~/components/ui/button";
import { DataTable, type Column } from "~/components/ui/data-table";
import { DropdownMenuItem } from "~/components/ui/dropdown-menu";
import {
  CAPITAL_KIND_BLURBS,
  CAPITAL_KIND_LABELS,
  type CapitalEntry,
  type CapitalKind,
} from "~/lib/accounting";
import { formatAccraDate, formatAccraDateTime, formatCount, formatPesewas } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/accounting-capital";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Capital · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page. */
export const handle = {
  title: "Capital",
};

/**
 * `GET /accounting/capital` — owner contributions and drawings, whole.
 *
 * The API pages nothing here: a business has a handful of these a year, and
 * the table pages them itself. Accounts are read alongside so a row can name
 * the account the money went into rather than showing an id.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireOffice(request);

  const { data: result, headers } = await withAuth(request, async (token) => {
    const [entries, accounts] = await Promise.all([
      listCapital(token),
      listCashAccounts(token),
    ]);
    return { entries, accounts };
  });

  const accountNames = new Map(result.accounts.map((a) => [a.id, a.name]));
  const rows = result.entries
    .map((entry) => toRow(entry, accountNames))
    .sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));

  const contributed = rows
    .filter((r) => r.kind === "contribution")
    .reduce((sum, r) => sum + r.amount, 0);
  const drawn = rows
    .filter((r) => r.kind === "drawing")
    .reduce((sum, r) => sum + r.amount, 0);

  return data(
    {
      isAdmin: user.role === "admin",
      rows,
      contributed,
      drawn,
    },
    { headers },
  );
}

/** Opening the record drawer does not re-read the list underneath it. */
export const shouldRevalidate = drawerParentShouldRevalidate;

/* -------------------------------------------------------------------- rows --- */

interface Row {
  id: string;
  kind: CapitalKind;
  amount: number;
  on: string;
  account: string;
  accountId: string | null;
  note: string;
  recordedBy: string;
  recordedAt: string;
  sortKey: string;
}

function toRow(entry: CapitalEntry, accountNames: Map<string, string>): Row {
  return {
    id: entry.id,
    kind: entry.kind,
    amount: entry.amount,
    on: entry.occurredOn ? formatAccraDate(`${entry.occurredOn}T12:00:00Z`) : "",
    account:
      entry.cashAccountName ??
      (entry.cashAccountId ? (accountNames.get(entry.cashAccountId) ?? "An account") : "—"),
    accountId: entry.cashAccountId ?? null,
    note: entry.note ?? "",
    recordedBy: entry.recordedByName ?? "",
    recordedAt: entry.createdAt ? formatAccraDateTime(entry.createdAt) : "",
    sortKey: `${entry.occurredOn ?? ""}|${entry.createdAt ?? ""}`,
  };
}

/* -------------------------------------------------------------------- page --- */

export default function AccountingCapital({ loaderData }: Route.ComponentProps) {
  const { isAdmin, rows, contributed, drawn } = loaderData;
  const navigation = useNavigation();
  const busy =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/accounting/capital";

  const columns: Column<Row>[] = [
    {
      key: "on",
      header: "On",
      className: "whitespace-nowrap text-muted-foreground",
      cell: (row) => (
        <>
          <p>{row.on}</p>
          {row.recordedAt && <p className="text-xs">recorded {row.recordedAt}</p>}
        </>
      ),
    },
    {
      key: "kind",
      header: "What",
      cell: (row) => (
        <StatusPill
          label={CAPITAL_KIND_LABELS[row.kind] ?? row.kind}
          blurb={CAPITAL_KIND_BLURBS[row.kind]}
          tone={row.kind === "contribution" ? "success" : "warning"}
        />
      ),
    },
    {
      key: "account",
      header: "Account",
      className: "hidden text-muted-foreground md:table-cell",
      cell: (row) => row.account,
    },
    {
      key: "note",
      header: "Note",
      className: "hidden max-w-xs truncate text-muted-foreground lg:table-cell",
      cell: (row) => row.note || "—",
    },
    {
      key: "amount",
      header: "Amount · GH₵",
      align: "end",
      cell: (row) => (
        <span
          className={cn(
            "tabular font-medium",
            row.kind === "contribution" ? "text-cash-in" : "text-cash-out",
          )}
        >
          {row.kind === "contribution" ? "+" : "−"}
          {formatPesewas(row.amount)}
        </span>
      ),
    },
  ];

  return (
    <Page className="max-w-none">

      <dl className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Figure
          label="Contributed"
          value={formatPesewas(contributed)}
          hint="Put in by the owner, all time"
          tone="in"
        />
        <Figure
          label="Drawn"
          value={formatPesewas(drawn)}
          hint="Taken out by the owner, all time"
          tone="out"
        />
        <Figure
          label="Net capital"
          value={formatPesewas(contributed - drawn)}
          hint="What the owner has in the business"
          tone="neutral"
          className="col-span-2 lg:col-span-1"
        />
      </dl>

      <DataTable
        actions={
          isAdmin ? (
            <Button asChild size="sm">
              <Link to="/accounting/capital/new" prefetch="intent" preventScrollReset>
                <PlusIcon />
                Record capital
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
            <DropdownMenuItem asChild disabled={!row.accountId}>
              <Link to="/accounting">
                <WalletIcon />
                {row.accountId ? "Open the cash position" : "No account named"}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild disabled={!isAdmin}>
              <Link
                to={`/accounting/capital/new${row.accountId ? `?account=${row.accountId}` : ""}`}
                preventScrollReset
              >
                <PiggyBankIcon />
                Record another
              </Link>
            </DropdownMenuItem>
          </>
        )}
        noun={{ one: "entry", many: "entries" }}
        pageSize={10}
        empty={
          isAdmin
            ? "Nothing recorded yet. The opening capital at go-live is simply the first contribution — record it against the account that holds it."
            : "Nothing recorded yet. An admin records the owner’s contributions and drawings."
        }
      />

      <p className="mt-4 text-xs text-muted-foreground">
        {formatCount(rows.length)} {rows.length === 1 ? "entry" : "entries"}. A
        contribution is the owner putting money in; a drawing is taking it out.
        Neither is income or an expense — they move equity, not profit — which is
        why they cannot be recorded under Expenses.
      </p>

      {/* Recording renders here, over the list. */}
      <Outlet />
    </Page>
  );
}

/** One figure, boxed, in the money-direction colours the ledger uses. */
function Figure({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "in" | "out" | "neutral";
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-muted/40 px-3 py-2.5", className)}>
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "tabular mt-0.5 font-semibold",
          tone === "in" && "text-cash-in",
          tone === "out" && "text-cash-out",
        )}
      >
        {value}
      </dd>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
