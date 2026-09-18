import { listCustomers } from "~/api/customers";
import { hasIdDocument } from "~/lib/customers";
import { requireUser, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/customer-search";

/**
 * `GET /customers/search?q=…` — a JSON resource route behind the session, so a
 * picker in the browser can look customers up without holding an access token
 * of its own.
 *
 * Only active customers come back: every module that picks a customer is about
 * to open an account or take money for one, and the API refuses both on a
 * deactivated record (`CUSTOMER_INACTIVE`). Offering them would be offering a
 * choice that cannot be carried out.
 *
 * Each hit carries how much of an ID the record holds, because a loan guarantor
 * has to have both halves on file. Sending it with the search means the form
 * can say so on the row, before somebody is chosen and then refused.
 */
const LIMIT = 8;

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return { items: [] };

  const { data: result } = await withAuth(request, (token) =>
    listCustomers(token, { search: q.slice(0, 100), status: "active", limit: LIMIT }),
  );

  return {
    items: result.items.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      phone: c.phone,
      /** The ID type and number are recorded. */
      hasIdNumber: Boolean(c.identification?.idNumber),
      /** Both sides of it are uploaded. One side alone counts for nothing. */
      hasIdDocument: hasIdDocument(c),
    })),
  };
}

export type CustomerHit = Awaited<ReturnType<typeof loader>>["items"][number];
