import { data } from "react-router";

import { listTrashedCustomers, restoreCustomer } from "~/api/customers";
import { ApiError } from "~/api/error";
import { Page } from "~/components/page";
import { TrashList, trashMeta } from "~/components/trash-list";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/trash";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Trash · Customers · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page, and the line under it. */
export const handle = {
  title: "Trash",
  description:
    "Records removed from the listings. Nothing here is deleted for good — restore one and it reappears everywhere.",
};

const PAGE_SIZE = 20;

/**
 * `GET /customers/trash` — customers that were soft-deleted, newest first.
 * Office only. The rail hides this item for collectors; this is what enforces
 * it.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const { data: list, headers } = await withAuth(request, (token) =>
    listTrashedCustomers(token, { page, limit: PAGE_SIZE }),
  );

  const rows = list.items.map((c) => ({
    id: c.id,
    title: c.fullName,
    subtitle: c.phone,
    ...trashMeta(c),
  }));

  return data({ rows, page, total: list.total }, { headers });
}

/** `POST /customers/:id/restore` — bring one back into the listings. */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  if (!id) return data({ ok: false, message: "Missing customer." }, { status: 400 });

  try {
    const { headers } = await withAuth(request, (token) => restoreCustomer(token, id));
    return data({ ok: true, message: "Customer restored." }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return data({ ok: false, message: error.message }, { status: error.status });
    }
    throw error;
  }
}

export default function Trash({ loaderData }: Route.ComponentProps) {
  const { rows, page, total } = loaderData;
  return (
    <Page className="max-w-none">
      <TrashList
        rows={rows}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        hrefFor={(p) => (p > 1 ? `/trash?page=${p}` : "/trash")}
        noun="customer"
        emptyTitle="No trashed customers"
        emptyDescription="Customers moved to the trash from the customer list will wait here."
        backTo="/customers"
        backLabel="Go to customers"
        restoreDescription="They reappear in the customer list and in lookups, with their registration record and history intact."
      />
    </Page>
  );
}
