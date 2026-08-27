import { ApiError } from "~/api/error";
import { getEligibility } from "~/api/hire-purchase";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/hp-eligibility";

/**
 * `GET /hire-purchase/eligibility/:customerId` — a JSON resource route behind
 * the session, so the signing form can check the conditions as soon as a
 * customer is picked.
 *
 * Four conditions: an active susu or savings account, three months of saving
 * history, no active loan, and no agreement already open. Loans and hire
 * purchase block each other, which is the one people forget.
 *
 * The spec leaves this response open, so what comes back is read defensively
 * and the form never treats a missing field as a refusal — the API re-checks
 * everything when the agreement is actually signed.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOffice(request);

  try {
    const { data: eligibility } = await withAuth(request, (token) =>
      getEligibility(token, params.customerId),
    );
    return { eligibility, error: null };
  } catch (error) {
    if (error instanceof ApiError) {
      return { eligibility: null, error: error.message };
    }
    throw error;
  }
}
