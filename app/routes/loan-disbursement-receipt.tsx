import { disbursementReceiptPdf } from "~/api/loans";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/loan-disbursement-receipt";

/**
 * `GET /loans/:id/disbursement/receipt` — proof the customer received the
 * money. The API answers with binary `application/pdf`, so this proxies the raw
 * response rather than going through the JSON layer, and passes on the API's
 * `422 NOT_DISBURSED` for a loan that has not been paid out yet.
 *
 * Office-only, like the rest of the loans router: loans are handled at the
 * counter, never on a round.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      disbursementReceiptPdf(token, params.id),
    );

    return await asDownload(upstream, {
      kind: "pdf",
      filename: `loan-disbursement-${params.id}.pdf`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
