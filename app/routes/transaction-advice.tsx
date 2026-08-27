import { PrinterIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { data } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { getCustomerStatement } from "~/api/customers";
import { BrandLockup } from "~/components/brand";
import { BackLink } from "~/components/page";
import { TransactionAdvice } from "~/components/transaction-advice";
import { Button } from "~/components/ui/button";
import { TX_TYPE_LABELS } from "~/lib/customers";
import { accraDay, accraDaysAgo, formatAccraDate } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/transaction-advice";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.customer.fullName ?? "Customer";
  return [{ title: `Advice · ${name} · Yadah Dynamic Enterprise` }];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One entry's advice, as its own page so it can be saved as a PDF or handed
 * over the counter. It renders outside the app layout — no sidebar, no rail —
 * because everything on the page is meant to end up on the paper.
 *
 * The API has no endpoint for a single ledger row: the statement is where
 * transactions come from. So the period travels in the query string, the
 * statement is re-read for it, and the one row is picked out. Following the
 * "Advice" link from a statement carries that statement's own period across,
 * which is what keeps the row findable.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);
  const day = (key: string, fallback: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : fallback;
  };
  const from = day("from", accraDaysAgo(29));
  const to = day("to", accraDay());

  const { data: statement, headers } = await withAuth(request, async (token) => {
    try {
      return await getCustomerStatement(token, params.id, { from, to });
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  const tx = statement.transactions.find((t) => t.id === params.txId);
  if (!tx) {
    throw new Response(
      "That entry is not in this period. Open the statement, set the dates around it, and take the advice from there.",
      { status: 404, statusText: "Entry not found" },
    );
  }

  return data(
    { tx, customer: statement.customer, customerId: params.id, from, to },
    { headers },
  );
}

/**
 * Export on arrival. This page is not somewhere to read an advice — the ledger
 * row's "View advice" already does that — it is the export itself, so landing
 * here and then having to press a button was a step that bought nothing.
 *
 * It waits for the webfont and the logo first: printing a moment too early
 * takes the sheet with the mark missing and the text in a fallback face, and
 * there is no second chance once the dialog is up.
 */
function usePrintOnArrival() {
  const fired = useRef(false);

  useEffect(() => {
    // Strict mode runs effects twice in development; one print dialog is enough.
    if (fired.current) return;
    fired.current = true;

    let cancelled = false;
    const pending = Array.from(document.images)
      .filter((img) => !img.complete)
      .map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
      );

    void Promise.all([document.fonts?.ready, ...pending]).then(() => {
      if (cancelled) return;
      // One frame, so the settled layout is what the dialog measures.
      requestAnimationFrame(() => {
        if (!cancelled) window.print();
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);
}

export default function TransactionAdviceRoute({ loaderData }: Route.ComponentProps) {
  const { tx, customer, customerId, from, to } = loaderData;
  const period = `from=${from}&to=${to}`;
  usePrintOnArrival();

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      {/* Screen furniture. None of this reaches the paper. */}
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <BackLink to={`/customers/${customerId}/statement?${period}`}>
          Back to the statement
        </BackLink>
        {/* The export fires on arrival; this is only for a second copy, or
            after someone dismisses the dialog. */}
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          <PrinterIcon />
          Export again
        </Button>
      </div>

      <div className="print-sheet rounded-xl border border-border bg-card p-6 sm:p-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
          <BrandLockup />
          <div className="text-right">
            <h1 className="font-heading text-lg font-bold tracking-tight">
              Transaction advice
            </h1>
            <p className="text-xs text-muted-foreground">
              {TX_TYPE_LABELS[tx.type] ?? tx.type} ·{" "}
              {formatAccraDate(tx.createdAt)}
            </p>
          </div>
        </header>

        <TransactionAdvice tx={tx} customer={customer} withCustomer />

        <footer className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
          <p>
            This advice is computer-generated and needs no signature. Quote the
            transaction reference when querying this entry at the branch.
          </p>
          <p className="mt-1">Yadah Dynamic Enterprise · Takoradi, Ghana</p>
        </footer>
      </div>
    </div>
  );
}
