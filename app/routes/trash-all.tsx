import { MoreHorizontalIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Link, useFetcher } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { restoreCustomer, listTrashedCustomers } from "~/api/customers";
import {
  listTrashedAgreements,
  listTrashedItems,
  restoreAgreement,
  restoreItem,
} from "~/api/hire-purchase";
import { listTrashedLoans, listTrashedRepaymentsAll, restoreLoan } from "~/api/loans";
import {
  listTrashedAccounts as listTrashedSavings,
  listTrashedTxnsAll,
  restoreAccount as restoreSavingsAccount,
  restoreTxn,
} from "~/api/savings";
import {
  listTrashedAccounts as listTrashedSusu,
  listTrashedDepositsAll,
  restoreAccount as restoreSusuAccount,
  restoreDeposit,
} from "~/api/susu";
import { Th, ListingCard, ListingFooter } from "~/components/listing";
import { Page } from "~/components/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { formatAccraDate, formatPesewas, relativeDayLabel } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/trash-all";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Trash · All · Yadah Dynamic Enterprise" }];
}

export const handle = {
  title: "Trash",
};

const PAGE_SIZE = 25;
/** How many of each kind to pull before merging — the branch's trash is small,
 *  and the office can still open a kind's own book for the full, paged list. */
const PER_SOURCE = 100;

interface AllRow {
  key: string;
  type: string;
  title: string;
  subtitle: string;
  amount: number | null;
  href: string;
  deletedAt: string;
  reason: string | null;
  /** The restore dispatch: `kind:id` or `kind:accountId:itemId`; null when the
   *  record cannot be restored (a deleted loan payment). */
  restoreKey: string | null;
}

/** Every deleted record across the branch, newest removal first (office). */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const q = { limit: PER_SOURCE };
  const safe = <T,>(p: Promise<{ items: T[]; total: number }>) =>
    p.catch(() => ({ items: [] as T[], total: 0 }));

  const { data: all, headers } = await withAuth(request, async (token) => {
    const [
      customers,
      susu,
      savings,
      loans,
      susuDeposits,
      savingsTxns,
      payments,
      items,
      agreements,
    ] = await Promise.all([
      safe(listTrashedCustomers(token, q)),
      safe(listTrashedSusu(token, q)),
      safe(listTrashedSavings(token, q)),
      safe(listTrashedLoans(token, q)),
      safe(listTrashedDepositsAll(token, q)),
      safe(listTrashedTxnsAll(token, q)),
      safe(listTrashedRepaymentsAll(token, q)),
      safe(listTrashedItems(token, q)),
      safe(listTrashedAgreements(token, q)),
    ]);

    const rows: AllRow[] = [
      ...customers.items.map((c) => ({
        key: `customer:${c.id}`,
        type: "Customer",
        title: c.fullName,
        subtitle: c.phone,
        amount: null,
        href: `/customers/${c.id}`,
        deletedAt: c.deletedAt,
        reason: c.deleteReason ?? null,
        restoreKey: `customer:${c.id}`,
      })),
      ...susu.items.map((a) => ({
        key: `susu:${a.id}`,
        type: "Susu account",
        title: a.customerName ?? a.customerId,
        subtitle: `No. ${a.accountNumber}`,
        amount: a.balance,
        href: `/susu/${a.id}`,
        deletedAt: a.deletedAt,
        reason: a.deleteReason ?? null,
        restoreKey: `susu:${a.id}`,
      })),
      ...savings.items.map((a) => ({
        key: `savings:${a.id}`,
        type: "Savings account",
        title: a.customerName ?? a.customerId,
        subtitle: `No. ${a.accountNumber}`,
        amount: a.balance,
        href: `/savings/${a.id}`,
        deletedAt: a.deletedAt,
        reason: a.deleteReason ?? null,
        restoreKey: `savings:${a.id}`,
      })),
      ...loans.items.map((l) => ({
        key: `loan:${l.id}`,
        type: "Loan",
        title: l.customerName ?? l.customerId,
        subtitle: l.status,
        amount: l.principal,
        href: `/loans/${l.id}`,
        deletedAt: l.deletedAt,
        reason: l.deleteReason ?? null,
        restoreKey: `loan:${l.id}`,
      })),
      ...susuDeposits.items.map((d) => ({
        key: `susu-deposit:${d.id}`,
        type: "Susu deposit",
        title: d.customerName || d.customerId,
        subtitle: `No. ${d.accountNumber}`,
        amount: d.amount,
        href: `/susu/${d.accountId}`,
        deletedAt: d.deletedAt,
        reason: d.deleteReason ?? null,
        restoreKey: `susu-deposit:${d.accountId}:${d.id}`,
      })),
      ...savingsTxns.items.map((t) => ({
        key: `savings-txn:${t.id}`,
        type: "Savings transaction",
        title: t.customerName || t.customerId,
        subtitle: `No. ${t.accountNumber}`,
        amount: t.amount,
        href: `/savings/${t.accountId}`,
        deletedAt: t.deletedAt,
        reason: t.deleteReason ?? null,
        restoreKey: `savings-txn:${t.accountId}:${t.id}`,
      })),
      ...payments.items.map((r) => ({
        key: `payment:${r.id}`,
        type: "Loan payment",
        title: r.customerName || r.customerId,
        subtitle: r.loanAccountNumber,
        amount: r.amount,
        href: `/loans/${r.loanId}`,
        deletedAt: r.deletedAt,
        reason: r.deleteReason ?? null,
        // A deleted payment's money was reversed — it is re-entered, not restored.
        restoreKey: null,
      })),
      ...items.items.map((i) => ({
        key: `item:${i.id}`,
        type: "Inventory item",
        title: i.name,
        subtitle: `${i.quantityInStock} in stock`,
        amount: i.sellingPrice,
        href: `/inventory`,
        deletedAt: i.deletedAt,
        reason: i.deleteReason ?? null,
        restoreKey: `item:${i.id}`,
      })),
      ...agreements.items.map((a) => ({
        key: `agreement:${a.id}`,
        type: "Agreement",
        title: a.customerName ?? a.customerId,
        subtitle: a.item?.name ?? "",
        amount: a.remaining,
        href: `/hire-purchase/${a.id}`,
        deletedAt: a.deletedAt,
        reason: a.deleteReason ?? null,
        restoreKey: `agreement:${a.id}`,
      })),
    ];

    rows.sort((x, y) => y.deletedAt.localeCompare(x.deletedAt));
    const total =
      customers.total +
      susu.total +
      savings.total +
      loans.total +
      susuDeposits.total +
      savingsTxns.total +
      payments.total +
      items.total +
      agreements.total;
    return { rows, total, fetched: rows.length };
  });

  const start = (page - 1) * PAGE_SIZE;
  return data(
    {
      rows: all.rows.slice(start, start + PAGE_SIZE),
      page,
      total: all.total,
      truncated: all.total > all.fetched,
    },
    { headers },
  );
}

/** Restore any kind from one place: the row posts its `restoreKey`, and this
 *  dispatches to that kind's own restore. */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const [kind, a, b] = String(form.get("restoreKey") ?? "").split(":");

  try {
    const { headers } = await withAuth(request, async (token) => {
      switch (kind) {
        case "customer":
          return restoreCustomer(token, a);
        case "susu":
          return restoreSusuAccount(token, a);
        case "savings":
          return restoreSavingsAccount(token, a);
        case "loan":
          return restoreLoan(token, a);
        case "susu-deposit":
          return restoreDeposit(token, a, b);
        case "savings-txn":
          return restoreTxn(token, a, b);
        case "item":
          return restoreItem(token, a);
        case "agreement":
          return restoreAgreement(token, a);
        default:
          throw new Response("Nothing to restore.", { status: 400 });
      }
    });
    return data({ ok: true, message: "Restored." }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ ok: false, message: error.message }, { status: error.status });
    }
    throw error;
  }
}

export default function TrashAll({ loaderData }: Route.ComponentProps) {
  const { rows, page, total, truncated } = loaderData;
  const now = new Date();

  return (
    <Page className="max-w-none">
      <ListingCard>
        {rows.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Trash2Icon className="size-6" />
              </EmptyMedia>
              <EmptyTitle>The trash is empty</EmptyTitle>
              <EmptyDescription>
                Everything deleted across the branch would show here, newest
                first.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Type</Th>
                  <Th>Record</Th>
                  <Th className="hidden text-right sm:table-cell">Amount</Th>
                  <Th className="hidden lg:table-cell">Reason</Th>
                  <Th>Removed</Th>
                  <Th className="w-12 text-right">Actions</Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="px-4 py-3 text-sm whitespace-nowrap text-muted-foreground">
                      {row.type}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Link
                        to={row.href}
                        className="truncate font-medium underline-offset-4 hover:underline"
                      >
                        {row.title}
                      </Link>
                      {row.subtitle ? (
                        <p className="tabular truncate text-xs text-muted-foreground">
                          {row.subtitle}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular hidden px-4 py-3 text-right whitespace-nowrap sm:table-cell">
                      {row.amount != null ? formatPesewas(row.amount) : "—"}
                    </TableCell>
                    <TableCell className="hidden max-w-xs px-4 py-3 text-sm text-muted-foreground lg:table-cell">
                      {row.reason ?? "—"}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                      <p>{relativeDayLabel(row.deletedAt, now)}</p>
                      <p className="text-xs">{formatAccraDate(row.deletedAt)}</p>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <RowActions row={row} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {truncated ? (
              <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                Showing the most recent of each kind. Open a kind on the left to
                restore from its full list.
              </p>
            ) : null}
          </>
        )}

        <ListingFooter
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          hrefFor={(p) => (p > 1 ? `/trash/all?page=${p}` : "/trash/all")}
        />
      </ListingCard>
    </Page>
  );
}

function RowActions({ row }: { row: AllRow }) {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const [confirm, setConfirm] = useState(false);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) toast.success(fetcher.data.message);
      else toast.error(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data]);

  // A deleted loan payment is not restorable — its money was reversed.
  if (!row.restoreKey) {
    return <span className="text-xs text-muted-foreground">Re-enter to reverse</span>;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            className="text-muted-foreground hover:text-foreground"
          >
            <MoreHorizontalIcon />
            <span className="sr-only">Actions for {row.title}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setConfirm(true);
            }}
          >
            <RotateCcwIcon />
            Restore
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore {row.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              The {row.type.toLowerCase()} goes back where it was, with its money
              and history as they were. It may be refused if the record it
              belongs to has moved on.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                fetcher.submit({ restoreKey: row.restoreKey ?? "" }, { method: "post" })
              }
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
