import { data, Link } from "react-router";

import { ApiError } from "~/api/error";
import { listTrashedDepositsAll, restoreDeposit } from "~/api/susu";
import { Page } from "~/components/page";
import { TrashList, trashMeta } from "~/components/trash-list";
import { formatPesewas } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/trash-susu-deposits";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Trash · Susu deposits · Yadah Dynamic Enterprise" }];
}

export const handle = {
  title: "Trash",
};

const PAGE_SIZE = 20;

/** `GET /susu/deposits/trash` — every deleted susu deposit (office). */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: list, headers } = await withAuth(request, (token) =>
    listTrashedDepositsAll(token, { page, limit: PAGE_SIZE }),
  );

  const rows = list.items.map((d) => ({
    id: `${d.accountId}:${d.id}`,
    title: d.customerName || d.customerId,
    subtitle: `Deposit · No. ${d.accountNumber}`,
    amount: d.amount,
    accountId: d.accountId,
    ...trashMeta(d),
  }));

  return data({ rows, page, total: list.total }, { headers });
}

/** `POST` with a composite `id` of `accountId:depositId` → per-account restore. */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const [accountId, depositId] = String(form.get("id") ?? "").split(":");
  if (!accountId || !depositId) {
    return data({ ok: false, message: "Missing deposit." }, { status: 400 });
  }

  try {
    const { headers } = await withAuth(request, (token) =>
      restoreDeposit(token, accountId, depositId),
    );
    return data({ ok: true, message: "Deposit restored." }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ ok: false, message: error.message }, { status: error.status });
    }
    throw error;
  }
}

export default function TrashSusuDeposits({ loaderData }: Route.ComponentProps) {
  const { rows, page, total } = loaderData;
  return (
    <Page className="max-w-none">
      <TrashList
        rows={rows.map((r) => ({
          ...r,
          detail: (
            <Link
              to={`/susu/${r.accountId}`}
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
          p > 1 ? `/trash/susu-deposits?page=${p}` : "/trash/susu-deposits"
        }
        noun="deposit"
        detailHeading="Amount"
        emptyTitle="No trashed deposits"
        emptyDescription="Deleted susu deposits wait here."
        backTo="/susu"
        backLabel="Go to susu"
        restoreDescription="The deposit goes back onto the plans and the account balance."
      />
    </Page>
  );
}
