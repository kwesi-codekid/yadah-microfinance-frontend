import { listCustomers } from "~/api/customers";
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
    })),
  };
}

export type CustomerHit = Awaited<ReturnType<typeof loader>>["items"][number];
