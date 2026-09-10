import { paymentReceiptPdf } from "~/api/hire-purchase";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/hp-payment-receipt";

/**
 * `GET /hire-purchase/:id/payments/:paymentId/receipt` — the printable slip for
 * a deposit, an instalment or a redemption payment; the same document under a
 * different title. The API answers with binary `application/pdf`, so this
 * proxies the raw response rather than going through the JSON layer.
 *
 * Office-only, like everything under hire purchase.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireCounter(request);

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      paymentReceiptPdf(token, params.id, params.paymentId),
    );

    return await asDownload(upstream, {
      kind: "pdf",
      filename: `hp-payment-${params.paymentId}.pdf`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
