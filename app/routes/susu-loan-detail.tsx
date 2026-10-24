import {
  BanknoteArrowDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DoorClosedIcon,
  FileTextIcon,
} from "lucide-react";
import { useEffect } from "react";
import { data, Form, Link, Outlet, useActionData } from "react-router";
import { toast } from "sonner";

import { throwAsRouteError } from "~/api/client";
import { ApiError } from "~/api/error";
import { closeAccount, getAccount, listTxns } from "~/api/susu-loans";
import { FilterRail, RailFrame, type RailSection } from "~/components/filter-rail";
import { Figure, PagerButton, Th } from "~/components/listing";
import { BackLink, Page } from "~/components/page";
import { drawerParentShouldRevalidate } from "~/components/route-sheet";
import { SusuStatusPill } from "~/components/susu-bits";
import { Button } from "~/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "~/components/ui/table";
import { formatAccraDate, formatAccraDateTime, formatCount, formatPesewas } from "~/lib/format";
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
  await requireCounter(request);
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
      return { account, txns };
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data({ ...result, page, type: type ?? "all" }, { headers });
}

/** The deposit drawer opening does not re-read the statement. */
export const shouldRevalidate = drawerParentShouldRevalidate;

/** Closing an empty account — the only thing done on the page itself. */
export async function action({ request, params }: Route.ActionArgs) {
  await requireCounter(request);
  try {
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
  const { account, txns, page, type } = loaderData;
  const actionData = useActionData<typeof action>();
  const open = account.status === "active";

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
              {open && account.balance === 0 && (
                <Form method="post">
                  <Button type="submit" variant="outline" size="sm">
                    <DoorClosedIcon />
                    Close account
                  </Button>
                </Form>
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
                    <TableCell className="px-4 py-3 text-right">
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

        {/* The deposit drawer opens over all of it. */}
        <Outlet />
      </Page>
    </RailFrame>
  );
}
