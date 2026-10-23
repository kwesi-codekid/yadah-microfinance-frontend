import { data, Link } from "react-router";

import { listTrashedRepaymentsAll } from "~/api/loans";
import { Page } from "~/components/page";
import { TrashList, trashMeta } from "~/components/trash-list";
import { formatPesewas } from "~/lib/format";
import { SOURCE_LABELS } from "~/lib/loans";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/trash-payments";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Trash · Loan payments · Yadah Dynamic Enterprise" }];
}

export const handle = {
  title: "Trash",
};

const PAGE_SIZE = 20;

/** `GET /loans/repayments/trash` — every deleted loan repayment (office). */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: list, headers } = await withAuth(request, (token) =>
    listTrashedRepaymentsAll(token, { page, limit: PAGE_SIZE }),
  );

  const rows = list.items.map((r) => ({
    id: r.id,
    title: r.customerName || r.customerId,
    subtitle: `${SOURCE_LABELS[r.source] ?? r.source} · ${r.loanAccountNumber}`,
    amount: r.amount,
    loanId: r.loanId,
    ...trashMeta(r),
  }));

  return data({ rows, page, total: list.total }, { headers });
}

export default function TrashPayments({ loaderData }: Route.ComponentProps) {
  const { rows, page, total } = loaderData;
  return (
    <Page className="max-w-none">
      <TrashList
        rows={rows.map((r) => ({
          ...r,
          detail: (
            <Link
              to={`/loans/${r.loanId}`}
              className="tabular underline-offset-4 hover:underline"
            >
              {formatPesewas(r.amount)}
            </Link>
          ),
        }))}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        hrefFor={(p) => (p > 1 ? `/trash/payments?page=${p}` : "/trash/payments")}
        noun="payment"
        detailHeading="Amount"
        emptyTitle="No deleted payments"
        emptyDescription="Deleted loan payments wait here. Their money was reversed when they were deleted."
        backTo="/loans"
        backLabel="Go to loans"
        restoreDescription=""
        restorable={false}
      />
    </Page>
  );
}
