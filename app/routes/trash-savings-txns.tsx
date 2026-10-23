import { data, Link } from "react-router";

import { ApiError } from "~/api/error";
import { listTrashedTxnsAll, restoreTxn } from "~/api/savings";
import { Page } from "~/components/page";
import { TrashList, trashMeta } from "~/components/trash-list";
import { formatPesewas } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/trash-savings-txns";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Trash · Savings transactions · Yadah Dynamic Enterprise" }];
}

export const handle = {
  title: "Trash",
};

const PAGE_SIZE = 20;

const TYPE_LABELS: Record<string, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  closure: "Closure",
};

/** `GET /savings/transactions/trash` — every deleted savings transaction (office). */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: list, headers } = await withAuth(request, (token) =>
    listTrashedTxnsAll(token, { page, limit: PAGE_SIZE }),
  );

  const rows = list.items.map((t) => ({
    // Restore needs both ids; the action splits this back apart.
    id: `${t.accountId}:${t.id}`,
    title: t.customerName || t.customerId,
    subtitle: `${TYPE_LABELS[t.type] ?? t.type} · No. ${t.accountNumber}`,
    amount: t.amount,
    accountId: t.accountId,
    ...trashMeta(t),
  }));

  return data({ rows, page, total: list.total }, { headers });
}

/** `POST` with a composite `id` of `accountId:txnId` → per-account restore. */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const [accountId, txnId] = String(form.get("id") ?? "").split(":");
  if (!accountId || !txnId) {
    return data({ ok: false, message: "Missing transaction." }, { status: 400 });
  }

  try {
    const { headers } = await withAuth(request, (token) =>
      restoreTxn(token, accountId, txnId),
    );
    return data({ ok: true, message: "Transaction restored." }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ ok: false, message: error.message }, { status: error.status });
    }
    throw error;
  }
}

export default function TrashSavingsTxns({ loaderData }: Route.ComponentProps) {
  const { rows, page, total } = loaderData;
  return (
    <Page className="max-w-none">
      <TrashList
        rows={rows.map((r) => ({
          ...r,
          detail: (
            <Link
              to={`/savings/${r.accountId}`}
              className="tabular underline-offset-4 hover:underline"
            >
              {formatPesewas(r.amount)}
            </Link>
          ),
        }))}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        hrefFor={(p) =>
          p > 1 ? `/trash/savings-txns?page=${p}` : "/trash/savings-txns"
        }
        noun="transaction"
        detailHeading="Amount"
        emptyTitle="No trashed transactions"
        emptyDescription="Deleted savings deposits and withdrawals wait here."
        backTo="/savings"
        backLabel="Go to savings"
        restoreDescription="The transaction goes back onto its account and the later balances are recalculated."
      />
    </Page>
  );
}
