import { repaymentReceiptPdf } from "~/api/loans";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/loan-repayment-receipt";

/**
 * `GET /loans/:id/repayments/:repaymentId/receipt` — proof the customer paid.
 * The API answers with binary `application/pdf`, so this proxies the raw
 * response rather than going through the JSON layer. A reprint shows the
 * balances as they stood at that repayment, not as they stand today.
 *
 * Office-only, like the rest of the loans router.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOffice(request);

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      repaymentReceiptPdf(token, params.id, params.repaymentId),
    );

    return await asDownload(upstream, {
      kind: "pdf",
      filename: `loan-repayment-${params.repaymentId}.pdf`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
