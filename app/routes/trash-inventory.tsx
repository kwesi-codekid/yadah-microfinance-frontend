import { data } from "react-router";

import { ApiError } from "~/api/error";
import { listTrashedItems, restoreItem } from "~/api/hire-purchase";
import { StatusPill } from "~/components/listing";
import { Page } from "~/components/page";
import { TrashList, trashMeta } from "~/components/trash-list";
import { formatCount, formatPesewas } from "~/lib/format";
import { CONDITION_LABELS, ITEM_STATUS_LABELS } from "~/lib/hire-purchase";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/trash-inventory";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Trash · Inventory · Yadah Dynamic Enterprise" }];
}

export const handle = {
  title: "Trash",
};

const PAGE_SIZE = 20;

/** `GET /hire-purchase/items/trash` — soft-deleted items, newest first (office). */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: list, headers } = await withAuth(request, (token) =>
    listTrashedItems(token, { page, limit: PAGE_SIZE }),
  );

  const rows = list.items.map((i) => ({
    id: i.id,
    title: i.name,
    subtitle: [
      CONDITION_LABELS[i.condition] ?? i.condition,
      `${formatCount(i.quantityInStock)} in stock`,
    ].join(" · "),
    sellingPrice: i.sellingPrice,
    status: i.status,
    ...trashMeta(i),
  }));

  return data({ rows, page, total: list.total }, { headers });
}

/** `POST /hire-purchase/items/:id/restore` */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  if (!id) return data({ ok: false, message: "Missing item." }, { status: 400 });

  try {
    const { headers } = await withAuth(request, (token) => restoreItem(token, id));
    return data({ ok: true, message: "Item restored." }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ ok: false, message: error.message }, { status: error.status });
    }
    throw error;
  }
}

export default function TrashInventory({ loaderData }: Route.ComponentProps) {
  const { rows, page, total } = loaderData;
  return (
    <Page className="max-w-none">
      <TrashList
        rows={rows.map((r) => ({
          ...r,
          detail: (
            <span className="flex flex-col gap-0.5">
              <span className="tabular">{formatPesewas(r.sellingPrice)}</span>
              <StatusPill
                label={ITEM_STATUS_LABELS[r.status] ?? r.status}
                tone="muted"
                className="text-xs"
              />
            </span>
          ),
        }))}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        hrefFor={(p) => (p > 1 ? `/trash/inventory?page=${p}` : "/trash/inventory")}
        noun="item"
        detailHeading="Selling price"
        emptyTitle="No trashed items"
        emptyDescription="Items moved to the trash from the inventory will wait here."
        backTo="/inventory"
        backLabel="Go to inventory"
        restoreDescription="The item goes back on the shelf with its stock count, prices and condition exactly as they were."
      />
    </Page>
  );
}
