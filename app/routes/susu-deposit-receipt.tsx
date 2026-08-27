import { depositReceiptPdf } from "~/api/susu";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { requireUser, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/susu-deposit-receipt";

/**
 * `GET /susu/accounts/:id/deposits/:depositId/receipt` — the printable slip for
 * one deposit. The API answers with binary `application/pdf`, so this proxies
 * the raw response rather than going through the JSON layer.
 *
 * Any signed-in role: a collector who took the deposit in the field is exactly
 * the person who needs to hand over a receipt for it. The API has the final
 * word, and answers `403` if it disagrees.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request);

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      depositReceiptPdf(token, params.id, params.depositId),
    );

    return await asDownload(upstream, {
      kind: "pdf",
      filename: `susu-deposit-${params.depositId}.pdf`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
