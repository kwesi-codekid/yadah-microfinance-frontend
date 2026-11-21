import {
  BanknoteArrowDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DoorClosedIcon,
  FileTextIcon,
  HandCoinsIcon,
  PencilIcon,
} from "lucide-react";
import { listCollectors } from "~/api/collectors";
import { listCorrections } from "~/api/corrections";
import { getCustomer } from "~/api/customers";
import { isOffice } from "~/lib/auth";
import { defaultCollector } from "~/lib/collector-entry";
import { useEffect, useState } from "react";
import { data, Form, Link, Outlet, useActionData, useNavigation, useSubmit } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { getLoan, listLoans, repayFromSusuLoan } from "~/api/loans";
import { closeAccount, getAccount, listTxns } from "~/api/susu-loans";
import { FilterRail, RailFrame, type RailSection } from "~/components/filter-rail";
import { Figure, PagerButton, Th } from "~/components/listing";
import { BackLink, Page } from "~/components/page";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
import { SusuStatusPill } from "~/components/susu-bits";
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
import { Table, TableBody, TableCell, TableHeader, TableRow } from "~/components/ui/table";
import {
  formatAccraDate,
  formatAccraDateTime,
  formatAmount,
  formatCount,
  formatPesewas,
} from "~/lib/format";
import { newIdempotencyKey } from "~/lib/idempotency";
import { isOpen } from "~/lib/loans";
import { requireCounter, withAuth } from "~/lib/session.server";
import { isCredit, TXN_LABELS, type SusuLoanTxnType } from "~/lib/susu-loans";
import { redirectWithToast } from "~/lib/toast.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/susu-loan-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.account.customerName ?? "Account";
  return [{ title: `Susu loan · ${name} · Yadah Dynamic Enterprise` }];
}

/** What the layout header calls this page. */
export const handle = { title: "Susu loan" };

const PAGE_SIZE = 25;
const TYPES: SusuLoanTxnType[] = ["deposit", "repayment", "leftover", "refund"];

/**
 * One susu loan account: its balance and every movement on it. Office only,
 * like the rest of the product. No withdraw button — there is no withdrawal.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireCounter(request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const typeParam = url.searchParams.get("type") as SusuLoanTxnType | null;
  const type = typeParam && TYPES.includes(typeParam) ? typeParam : undefined;

  const { data: result, headers } = await withAuth(request, async (token) => {
    try {
      const [{ account }, txns] = await Promise.all([
        getAccount(token, params.id),
        listTxns(token, params.id, { page, limit: PAGE_SIZE, ...(type ? { type } : {}) }),
      ]);
      const [customer, collectors, corrections, openLoan] = await Promise.all([
        getCustomer(token, account.customerId)
          .then((r) => r.customer)
          .catch(() => null),
        listCollectors(token)
          .then((r) => r.collectors)
          .catch(() => null),
        // So a row can say the office has not answered yet. Soft: the statement
        // must not go down with it.
        listCorrections(token, { targetId: params.id, status: "pending", limit: 100 }).catch(
          () => null,
        ),
        // The loan the Settle button pays: the customer's open one, the oldest
        // if there are ever two. Soft as well — without it there is no button.
        Promise.all(
          (["active", "arrears"] as const).map((status) =>
            listLoans(token, { customerId: account.customerId, status, limit: 5 }),
          ),
        )
          .then(
            (lists) =>
              lists
                .flatMap((l) => l.items)
                .filter((l) => l.remaining > 0)
                .sort((a, b) => (a.disbursedAt ?? "").localeCompare(b.disbursedAt ?? ""))[0] ??
              null,
          )
          .catch(() => null),
      ]);
      return {
        account,
        openLoan: openLoan ? { id: openLoan.id, remaining: openLoan.remaining } : null,
        txns,
        collectors,
        assignedCollectorId: customer?.assignedCollectorId,
        pendingTxnIds: corrections?.items.map((c) => c.txnId) ?? [],
      };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data(
    {
      ...result,
      page,
      type: type ?? "all",
      office: isOffice(user),
      defaultCollectorId: defaultCollector(result.collectors, result.assignedCollectorId),
    },
    { headers },
  );
}

/** The deposit drawer opening does not re-read the statement. */
export const shouldRevalidate = drawerParentShouldRevalidate;

/**
 * Done on the page itself: closing an empty account, and settling — paying
 * the customer's loan from the account now, as far as the balance goes,
 * rather than waiting for the loan's monthly dates.
 */
export async function action({ request, params }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  try {
    if (form.get("intent") === "settle") {
      const loanId = String(form.get("loanId") ?? "");
      const idempotencyKey = String(form.get("idempotencyKey") ?? "");
      const { data: result, headers } = await withAuth(request, async (token) => {
        // Read both again: the amount is worked out here, never taken from the form.
        const [{ account }, { loan }] = await Promise.all([
          getAccount(token, params.id),
          getLoan(token, loanId),
        ]);
        if (loan.customerId !== account.customerId || !isOpen(loan)) return null;
        const amount = Math.min(account.balance, loan.remaining);
        if (amount <= 0) return null;
        return repayFromSusuLoan(token, loanId, { amount, idempotencyKey });
      });
      if (!result) {
        return data(
          { error: "There is nothing to settle — check the balance and the loan." },
          { status: 422, headers },
        );
      }
      return redirectWithToast(
        `/susu-loans/${params.id}`,
        {
          tone: "success",
          message: result.replayed
            ? "That settlement was already recorded."
            : `GH₵ ${formatAmount(result.repayment.amount)} paid onto the loan.`,
          description:
            result.loan.remaining > 0
              ? `GH₵ ${formatAmount(result.loan.remaining)} still owing.`
              : "The loan is fully repaid.",
        },
        headers,
      );
    }
    const { headers } = await withAuth(request, (token) => closeAccount(token, params.id));
    return redirectWithToast(
      `/susu-loans/${params.id}`,
      { tone: "success", message: "Susu loan account closed." },
      headers,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export default function SusuLoanDetail({ loaderData }: Route.ComponentProps) {
  const { account, txns, page, type, office, pendingTxnIds, openLoan } = loaderData;
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const busy = useNavigation().state !== "idle";
  const open = account.status === "active";

  // A fresh key each time the dialog opens, so a second settlement later on
  // the same page is not mistaken for a retry of the first.
  const [settleKey, setSettleKey] = useState<string | null>(null);
  const settleAmount = openLoan ? Math.min(account.balance, openLoan.remaining) : 0;
  const canSettle = open && openLoan !== null && settleAmount > 0;

  useEffect(() => {
    if (actionData?.error) toast.error(actionData.error);
  }, [actionData]);

  const hrefFor = (next: { type?: string; page?: number }) => {
    const p = new URLSearchParams();
    const t = next.type ?? type;
    if (t !== "all") p.set("type", t);
    const pg = next.page ?? 1;
    if (pg > 1) p.set("page", String(pg));
    const s = p.toString();
    return s ? `/susu-loans/${account.id}?${s}` : `/susu-loans/${account.id}`;
  };

  const sections: RailSection[] = [
    {
      label: "Show",
      items: [
        { key: "all", label: "Everything", to: hrefFor({ type: "all" }) },
        ...TYPES.map((t) => ({ key: t, label: TXN_LABELS[t], to: hrefFor({ type: t }) })),
      ],
    },
  ];

  const first = txns.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, txns.total);

  return (
    <RailFrame
      rail={({ horizontal }) => (
        <FilterRail
          label="Filter the statement"
          sections={sections}
          active={type}
          horizontal={horizontal}
        />
      )}
    >
      <Page className="max-w-none">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <BackLink to="/susu-loans">All susu loan accounts</BackLink>
          <div className="min-w-0 text-right">
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
              <h2 className="font-heading truncate text-2xl font-bold tracking-tight">
                <Link
                  to={`/customers/${account.customerId}`}
                  className="underline-offset-4 hover:underline"
                >
                  {account.customerName ?? "Customer"}
                </Link>
              </h2>
              <SusuStatusPill status={account.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="tabular">#{account.accountNumber}</span>
              {account.closedAt
                ? ` · Closed ${formatAccraDate(account.closedAt)}`
                : ` · Opened ${formatAccraDate(account.openedAt)}`}
            </p>
          </div>
        </header>

        <dl className="mb-6 grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
          <Figure label="Balance" value={formatPesewas(account.balance)} className="py-3" />
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
            For the customer&rsquo;s loan only — nothing is withdrawn. The loan is paid
            from it on its monthly dates, counted from the day it went out; if a
            month falls short, the next deposit goes to the loan straight away.
            Once a loan is paid off, what is left moves to their savings.
          </div>
        </dl>

        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Statement
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {office && (
                <Button asChild variant="outline" size="sm">
                  <Link
                    to={`/susu-loans/${account.id}/edit`}
                    prefetch="intent"
                    preventScrollReset
                  >
                    <PencilIcon />
                    Edit account
                  </Link>
                </Button>
              )}
              {open && account.balance === 0 && (
                <Form method="post">
                  <Button type="submit" variant="outline" size="sm">
                    <DoorClosedIcon />
                    Close account
                  </Button>
                </Form>
              )}
              {canSettle && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setSettleKey(newIdempotencyKey())}
                >
                  <HandCoinsIcon />
                  Settle loan
                </Button>
              )}
              {open && (
                <Button asChild size="sm">
                  <Link
                    to={`/susu-loans/${account.id}/deposit`}
                    prefetch="intent"
                    preventScrollReset
                  >
                    <BanknoteArrowDownIcon />
                    Record deposit
                  </Link>
                </Button>
              )}
            </div>
          </div>

          {txns.items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {type === "all"
                ? "Nothing has moved through this account yet."
                : "Nothing of that kind on this account."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <Th>Date</Th>
                  <Th>What</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="hidden text-right sm:table-cell">Balance after</Th>
                  <Th className="w-12 text-right">
                    <span className="sr-only">Receipt</span>
                  </Th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txns.items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="px-4 py-3 text-sm whitespace-nowrap">
                      {formatAccraDateTime(t.createdAt)}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <p className="font-medium">{TXN_LABELS[t.type]}</p>
                      {t.type === "deposit" && t.recordedByName && (
                        <p className="text-xs text-muted-foreground">
                          {t.enteredByName
                            ? `Collected by ${t.recordedByName} · entered by ${t.enteredByName}`
                            : `Recorded by ${t.recordedByName}`}
                        </p>
                      )}
                      {pendingTxnIds.includes(t.id) && (
                        <p className="text-xs text-warning">Correction waiting on the office</p>
                      )}
                      {t.loanId && (
                        <Link
                          to={`/loans/${t.loanId}`}
                          className="tabular text-xs text-muted-foreground underline-offset-4 hover:underline"
                        >
                          Loan {t.loanNumber ? `#${t.loanNumber}` : ""}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "tabular px-4 py-3 text-right font-medium whitespace-nowrap",
                        isCredit(t.type) ? "text-success" : "text-foreground",
                      )}
                    >
                      {isCredit(t.type) ? "+" : "−"}
                      {formatPesewas(t.amount)}
                    </TableCell>
                    <TableCell className="tabular hidden px-4 py-3 text-right whitespace-nowrap text-muted-foreground sm:table-cell">
                      {formatPesewas(t.balanceAfter)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right whitespace-nowrap">
                      {open &&
                        t.type === "deposit" &&
                        (t.channel === "cash" || t.channel === "momo") &&
                        !pendingTxnIds.includes(t.id) && (
                          <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground"
                          >
                            <Link
                              to={`/susu-loans/${account.id}/txns/${t.id}/edit`}
                              prefetch="intent"
                              preventScrollReset
                              aria-label={office ? "Edit deposit" : "Ask to correct this deposit"}
                            >
                              <PencilIcon />
                            </Link>
                          </Button>
                        )}
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground"
                      >
                        <a
                          href={`/susu-loans/${account.id}/txns/${t.id}/receipt`}
                          aria-label="Receipt"
                        >
                          <FileTextIcon />
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {txns.total > 0 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
              <p>
                Showing <span className="tabular font-medium text-foreground">{first}</span>–
                <span className="tabular font-medium text-foreground">{last}</span> of{" "}
                <span className="tabular font-medium text-foreground">{formatCount(txns.total)}</span>
              </p>
              <div className="flex items-center gap-2">
                <PagerButton
                  to={hrefFor({ page: page - 1 })}
                  disabled={page <= 1}
                  label="Previous page"
                >
                  <ChevronLeftIcon />
                  Prev
                </PagerButton>
                <PagerButton
                  to={hrefFor({ page: page + 1 })}
                  disabled={last >= txns.total}
                  label="Next page"
                >
                  Next
                  <ChevronRightIcon />
                </PagerButton>
              </div>
            </div>
          )}
        </section>

        {openLoan && (
          <AlertDialog
            open={settleKey !== null}
            onOpenChange={(next) => {
              if (!next) setSettleKey(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Settle the loan from this account?</AlertDialogTitle>
                <AlertDialogDescription>
                  {formatPesewas(settleAmount)} is taken from this account and paid onto{" "}
                  {account.customerName ?? "the customer"}&rsquo;s loan now.{" "}
                  {openLoan.remaining > settleAmount ? (
                    <>
                      The account is left empty and{" "}
                      {formatPesewas(openLoan.remaining - settleAmount)} is still owing.
                    </>
                  ) : account.balance > settleAmount ? (
                    <>
                      That pays the loan off. The {formatPesewas(account.balance - settleAmount)}{" "}
                      left over moves to their savings account, or stays here if they have none.
                    </>
                  ) : (
                    <>That pays the loan off and leaves the account empty.</>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (!settleKey) return;
                    void submit(
                      { intent: "settle", loanId: openLoan.id, idempotencyKey: settleKey },
                      { method: "post" },
                    );
                  }}
                >
                  Settle {formatPesewas(settleAmount)}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {/* The deposit drawer opens over all of it. */}
        <Outlet />
      </Page>
    </RailFrame>
  );
}
