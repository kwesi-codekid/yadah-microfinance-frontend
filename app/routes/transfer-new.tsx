import { data } from "react-router";
import type { Route } from "./+types/transfer-new";
import { toApiFailure, type ApiFailure } from "~/lib/api/client";
import { readTransferSource } from "~/lib/transfer-client";
import {
  readTransferFailure,
  runTransferIntent,
  type TransferActionData,
} from "~/lib/transfer-intent.server";
import { requireOffice, withAuth } from "~/lib/session.server";

type ActionData = TransferActionData & { failure?: ApiFailure };

/**
 * The one place a transfer is made. The drawer that posts here is opened from a
 * row on the susu or savings book, so `from` names the account it stood on.
 */
export async function action({ request }: Route.ActionArgs) {
  // A savings source is a real withdrawal, and loans are office-only outright.
  await requireOffice(request);

  const form = await request.formData();
  const from = readTransferSource(String(form.get("from") ?? ""));
  if (!from) {
    return data<ActionData>({
      formError: "That account can't send money. Reload the page and try again.",
    });
  }

  try {
    const { data: result, headers } = await withAuth(request, (token) =>
      runTransferIntent({ token, from, form }),
    );
    return data<ActionData>(result, { headers });
  } catch (error) {
    // Redirects (an unrenewable session) must propagate, not become messages.
    if (error instanceof Response) throw error;
    const failure = toApiFailure(error);

    const known = readTransferFailure(failure);
    if (known) return data<ActionData>({ ...known, failure });

    return data<ActionData>({
      intent: "transfer",
      formError:
        failure.status === 0
          ? "Something went wrong. Please try again."
          : failure.message,
      failure,
    });
  }
}
