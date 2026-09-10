import { data } from "react-router";

import { ApiError } from "~/api/error";
import { listTrashedAgreements, restoreAgreement } from "~/api/hire-purchase";
import { StatusPill } from "~/components/listing";
import { Page } from "~/components/page";
import { TrashList, trashMeta } from "~/components/trash-list";
import { formatPesewas } from "~/lib/format";
import { AGREEMENT_STATUS_LABELS } from "~/lib/hire-purchase";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/trash-agreements";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Trash · Hire purchase agreements · Yadah Dynamic Enterprise" }];
}

export const handle = {
  title: "Trash",
};

const PAGE_SIZE = 20;

/** `GET /hire-purchase/agreements/trash` — soft-deleted agreements, newest first (office). */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: list, headers } = await withAuth(request, (token) =>
    listTrashedAgreements(token, { page, limit: PAGE_SIZE }),
  );

  const rows = list.items.map((a) => ({
    id: a.id,
    title: a.customerName ?? a.customerId,
    subtitle: a.item?.name ?? "",
    remaining: a.remaining,
    status: a.status,
    ...trashMeta(a),
  }));

  return data({ rows, page, total: list.total }, { headers });
}

/** `POST /hire-purchase/agreements/:id/restore` */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  if (!id) return data({ ok: false, message: "Missing agreement." }, { status: 400 });

  try {
    const { headers } = await withAuth(request, (token) => restoreAgreement(token, id));
    return data({ ok: true, message: "Agreement restored." }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ ok: false, message: error.message }, { status: error.status });
    }
    throw error;
  }
}

export default function TrashAgreements({ loaderData }: Route.ComponentProps) {
  const { rows, page, total } = loaderData;
  return (
    <Page className="max-w-none">
      <TrashList
        rows={rows.map((r) => ({
          ...r,
          detail: (
            <span className="flex flex-col gap-0.5">
              <span className="tabular">{formatPesewas(r.remaining)}</span>
              <StatusPill
                label={AGREEMENT_STATUS_LABELS[r.status] ?? r.status}
                tone="muted"
                className="text-xs"
              />
            </span>
          ),
        }))}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        hrefFor={(p) => (p > 1 ? `/trash/agreements?page=${p}` : "/trash/agreements")}
        noun="agreement"
        detailHeading="Owing"
        emptyTitle="No trashed agreements"
        emptyDescription="Agreements moved to the trash from an agreement page will wait here."
        backTo="/hire-purchase"
        backLabel="Go to hire purchase"
        restoreDescription="The agreement returns to the book with every payment against it exactly as it was."
      />
    </Page>
  );
}
