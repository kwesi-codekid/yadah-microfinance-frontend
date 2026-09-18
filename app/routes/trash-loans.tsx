import { data } from "react-router";

import { ApiError } from "~/api/error";
import { listTrashedLoans, restoreLoan } from "~/api/loans";
import { StatusPill } from "~/components/listing";
import { Page } from "~/components/page";
import { TrashList, trashMeta } from "~/components/trash-list";
import { formatPesewas } from "~/lib/format";
import { DURATION_LABELS, LOAN_STATUS_LABELS, TIER_LABELS } from "~/lib/loans";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/trash-loans";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Trash · Loans · Yadah Dynamic Enterprise" }];
}

export const handle = {
  title: "Trash",
};

const PAGE_SIZE = 20;

/** `GET /loans/trash` — soft-deleted loan applications, newest first (office). */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: list, headers } = await withAuth(request, (token) =>
    listTrashedLoans(token, { page, limit: PAGE_SIZE }),
  );

  const rows = list.items.map((l) => ({
    id: l.id,
    title: l.customerName ?? l.customerId,
    subtitle: `${TIER_LABELS[l.tier] ?? l.tier} · ${DURATION_LABELS[l.durationMonths] ?? `${l.durationMonths} months`}`,
    principal: l.principal,
    status: l.status,
    ...trashMeta(l),
  }));

  return data({ rows, page, total: list.total }, { headers });
}

/** `POST /loans/:id/restore` */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  if (!id) return data({ ok: false, message: "Missing loan." }, { status: 400 });

  try {
    const { headers } = await withAuth(request, (token) => restoreLoan(token, id));
    return data({ ok: true, message: "Loan restored." }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ ok: false, message: error.message }, { status: error.status });
    }
    throw error;
  }
}

export default function TrashLoans({ loaderData }: Route.ComponentProps) {
  const { rows, page, total } = loaderData;
  return (
    <Page className="max-w-none">
      <TrashList
        rows={rows.map((r) => ({
          ...r,
          detail: (
            <span className="flex flex-col gap-0.5">
              <span className="tabular">{formatPesewas(r.principal)}</span>
              <StatusPill
                label={LOAN_STATUS_LABELS[r.status] ?? r.status}
                tone="muted"
                className="text-xs"
              />
            </span>
          ),
        }))}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        hrefFor={(p) => (p > 1 ? `/trash/loans?page=${p}` : "/trash/loans")}
        noun="loan"
        detailHeading="Principal"
        emptyTitle="No trashed loans"
        emptyDescription="Loan applications moved to the trash from a loan page will wait here."
        backTo="/loans"
        backLabel="Go to loans"
        restoreDescription="The loan returns to the book with its schedule and every repayment against it exactly as they were."
      />
    </Page>
  );
}
