import { saleReceiptPdf } from "~/api/sales";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/sale-receipt";

/**
 * `GET /hire-purchase/sales/:id/receipt` — the A4 till receipt, one line per
 * basket item. A discounted line prints the list price beside what was charged,
 * and a voided sale still prints, stamped VOIDED with its reason.
 *
 * Office-only, like the till itself.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOffice(request);

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      saleReceiptPdf(token, params.id),
    );

    return await asDownload(upstream, {
      kind: "pdf",
      filename: `receipt-${params.id}.pdf`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
