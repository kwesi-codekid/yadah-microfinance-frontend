import { transferReceiptPdf } from "~/api/transfers";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/transfer-receipt";

/**
 * `GET /transfers/:id/receipt` — proof of a move between two of one customer's
 * own products. No cash crossed the counter, so the document names both legs
 * rather than an amount received or paid out. The API answers with binary
 * `application/pdf`, so this proxies the raw response rather than going through
 * the JSON layer.
 *
 * Office-only, like the transfer itself.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOffice(request);

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      transferReceiptPdf(token, params.id),
    );

    return await asDownload(upstream, {
      kind: "pdf",
      filename: `transfer-${params.id}.pdf`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
