import { data } from "react-router";
import type { Route } from "./+types/customer-search";
import * as customersApi from "~/lib/api/customers";
import { MIN_QUERY, type CustomerMatch } from "~/lib/customer-search";
import { requireUser, withAuth } from "~/lib/session.server";

/** How many names the picker shows at once. */
const LIMIT = 8;

/**
 * Feeds the customer picker. A resource route — no component, so it sits
 * outside the app layout and a keystroke costs one API call, not a page.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);

  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (query.length < MIN_QUERY) return data({ items: [] as CustomerMatch[] });

  const { data: result, headers } = await withAuth(request, (token) =>
    // Only active customers: the API refuses to open an account for the rest.
    customersApi.listCustomers(token, {
      search: query,
      status: "active",
      limit: LIMIT,
    }),
  );

  return data(
    {
      items: result.items.map(({ id, fullName, phone }) => ({
        id,
        fullName,
        phone,
      })),
    },
    { headers },
  );
}
