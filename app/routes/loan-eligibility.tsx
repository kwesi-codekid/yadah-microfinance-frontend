import { data } from "react-router";
import type { Route } from "./+types/loan-eligibility";
import * as loansApi from "~/lib/api/loans";
import { toApiFailure } from "~/lib/api/client";
import { requireOffice, withAuth } from "~/lib/session.server";

/**
 * What the apply drawer needs once a customer is picked: whether they may
 * borrow at all, and how far up the tiers. A resource route, so choosing a
 * name costs one call rather than a page load.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);

  const customerId = new URL(request.url).searchParams.get("customerId");
  if (!customerId) return data({ eligibility: null, error: null });

  try {
    const { data: eligibility, headers } = await withAuth(request, (token) =>
      loansApi.getLoanEligibility(token, customerId),
    );
    return data({ eligibility, error: null }, { headers });
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    return data({ eligibility: null, error: toApiFailure(error).message });
  }
}
