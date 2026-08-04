import { data } from "react-router";
import type { Route } from "./+types/transfer-destinations";
import { newIdempotencyKey } from "~/lib/idempotency";
import { loadTransferDestinations } from "~/lib/transfer-intent.server";
import { requireOffice, withAuth } from "~/lib/session.server";

/**
 * Feeds the transfer drawer on a susu or savings account. It lives out here so
 * the four calls it takes to build the list only run when a drawer opens.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId")?.trim();
  const exclude = url.searchParams.get("exclude")?.trim() || undefined;

  if (!customerId) return data({ destinations: [], transferKey: "" });

  const { data: destinations, headers } = await withAuth(request, (token) =>
    loadTransferDestinations(token, customerId, exclude),
  );

  return data(
    {
      destinations,
      /** Minted here, not per submit: a key made at submit protects nothing. */
      transferKey: newIdempotencyKey(),
    },
    { headers },
  );
}
