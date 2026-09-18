import { data } from "react-router";

import { ApiError } from "~/api/error";
import { listTrashedAccounts, restoreAccount } from "~/api/savings";
import { StatusPill } from "~/components/listing";
import { Page } from "~/components/page";
import { TrashList, trashMeta } from "~/components/trash-list";
import { formatPesewas } from "~/lib/format";
import { ACCOUNT_TYPE_LABELS, SAVINGS_STATUS_LABELS } from "~/lib/savings";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/trash-savings";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Trash · Savings accounts · Yadah Dynamic Enterprise" }];
}

export const handle = {
  title: "Trash",
};

const PAGE_SIZE = 20;

/** `GET /savings/accounts/trash` — soft-deleted savings accounts, newest first (office). */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: list, headers } = await withAuth(request, (token) =>
    listTrashedAccounts(token, { page, limit: PAGE_SIZE }),
  );

  const rows = list.items.map((a) => ({
    id: a.id,
    title: a.customerName ?? a.customerId,
    subtitle: `No. ${a.accountNumber} · ${ACCOUNT_TYPE_LABELS[a.accountType] ?? a.accountType}`,
    balance: a.balance,
    status: a.status,
    ...trashMeta(a),
  }));

  return data({ rows, page, total: list.total }, { headers });
}

/** `POST /savings/accounts/:id/restore` */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  if (!id) return data({ ok: false, message: "Missing account." }, { status: 400 });

  try {
    const { headers } = await withAuth(request, (token) => restoreAccount(token, id));
    return data({ ok: true, message: "Savings account restored." }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ ok: false, message: error.message }, { status: error.status });
    }
    throw error;
  }
}

export default function TrashSavings({ loaderData }: Route.ComponentProps) {
  const { rows, page, total } = loaderData;
  return (
    <Page className="max-w-none">
      <TrashList
        rows={rows.map((r) => ({
          ...r,
          detail: (
            <span className="flex flex-col gap-0.5">
              <span className="tabular">{formatPesewas(r.balance)}</span>
              <StatusPill
                label={SAVINGS_STATUS_LABELS[r.status] ?? r.status}
                tone="muted"
                className="text-xs"
              />
            </span>
          ),
        }))}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        hrefFor={(p) => (p > 1 ? `/trash/savings?page=${p}` : "/trash/savings")}
        noun="account"
        detailHeading="Balance"
        emptyTitle="No trashed savings accounts"
        emptyDescription="Savings accounts moved to the trash from an account page will wait here."
        backTo="/savings"
        backLabel="Go to savings"
        restoreDescription="The account returns to the savings book with its balance and transaction history exactly as they were."
      />
    </Page>
  );
}
