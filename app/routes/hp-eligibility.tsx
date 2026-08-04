import { data } from "react-router";
import type { Route } from "./+types/hp-eligibility";
import { toApiFailure } from "~/lib/api/client";
import * as hpApi from "~/lib/api/hire-purchase";
import { readHpEligibility } from "~/lib/hp-client";
import { requireOffice, withAuth } from "~/lib/session.server";

/**
 * Whether a customer may sign at all: an active susu or savings account, three
 * months of history, no live loan, no open agreement. A resource route, so the
 * sign drawer costs one call when a name is picked rather than a page load.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);

  const customerId = new URL(request.url).searchParams.get("customerId");
  if (!customerId) {
    return data({ eligible: null, reasons: [] as string[], error: null });
  }

  try {
    const { data: payload, headers } = await withAuth(request, (token) =>
      hpApi.getHpEligibility(token, customerId),
    );
    return data({ ...readHpEligibility(payload), error: null }, { headers });
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    return data({
      eligible: null,
      reasons: [] as string[],
      error: toApiFailure(error).message,
    });
  }
}
