import { getEligibility } from "~/api/loans";
import { ApiError } from "~/api/error";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/loan-eligibility";

/**
 * `GET /loans/eligibility/:customerId` — a JSON resource route behind the
 * session, so the application form can read a customer's history the moment
 * they are picked.
 *
 * The API summarises roughly four months of susu and savings activity and
 * stops there; there is no automatic decision anywhere in this module. What
 * comes back is material for a person, which is why it is fetched into the
 * form rather than made a page of its own.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);

  try {
    const { data: eligibility } = await withAuth(request, (token) =>
      getEligibility(token, params.customerId),
    );
    return { eligibility, error: null };
  } catch (error) {
    if (error instanceof ApiError) {
      // The form stays usable and says what is missing; the API is the
      // authority on whether the application is accepted either way.
      return { eligibility: null, error: error.message };
    }
    throw error;
  }
}

export type EligibilityData = Awaited<ReturnType<typeof loader>>;
