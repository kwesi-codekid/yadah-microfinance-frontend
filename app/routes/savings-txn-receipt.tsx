import { txnReceiptPdf } from "~/api/savings";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { requireUser, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/savings-txn-receipt";

/**
 * `GET /savings/accounts/:id/txns/:txnId/receipt` — the printable slip for a
 * deposit, a withdrawal or a closure. The API answers with binary
 * `application/pdf`, so this proxies the raw response.
 *
 * Any signed-in role, for the same reason as the susu deposit slip: a collector
 * who took the deposit is the one who has to hand over a receipt for it. The
 * API answers `403` if it disagrees.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request);

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      txnReceiptPdf(token, params.id, params.txnId),
    );

    return await asDownload(upstream, {
      kind: "pdf",
      filename: `savings-${params.txnId}.pdf`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
