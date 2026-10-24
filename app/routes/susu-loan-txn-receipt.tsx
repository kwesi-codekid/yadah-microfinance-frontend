import { txnReceiptPdf } from "~/api/susu-loans";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/susu-loan-txn-receipt";

/**
 * `GET /susu-loans/accounts/:id/txns/:txnId/receipt` — the printable slip for
 * any movement on a susu loan account. The API answers with binary
 * `application/pdf`, so this proxies the raw response. Office only, like the
 * product.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      txnReceiptPdf(token, params.id, params.txnId),
    );
    return await asDownload(upstream, {
      kind: "pdf",
      filename: `susu-loan-${params.txnId}.pdf`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
