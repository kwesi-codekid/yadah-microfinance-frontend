import { withdrawalReceiptPdf } from "~/api/susu";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/susu-withdrawal-receipt";

/**
 * `GET /susu/accounts/:id/withdrawals/:payoutId/receipt` — the printable slip
 * for a partial withdrawal or a payout. Both go through the one endpoint, so
 * both come through here.
 *
 * Office-only, because both are: handing susu money back is not a field errand.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOffice(request);

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      withdrawalReceiptPdf(token, params.id, params.payoutId),
    );

    return await asDownload(upstream, {
      kind: "pdf",
      filename: `susu-withdrawal-${params.payoutId}.pdf`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
