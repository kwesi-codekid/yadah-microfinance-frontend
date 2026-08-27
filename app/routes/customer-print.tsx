import { registrationFormPdf } from "~/api/customers";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/customer-print";

/**
 * `GET /customers/:id/registration-form` — the A4 registration PDF. The API
 * answers with binary `application/pdf`, so this proxies the raw response
 * rather than going through the JSON layer. This is the row's "Print".
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOffice(request);

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      registrationFormPdf(token, params.id),
    );

    return await asDownload(upstream, {
      kind: "pdf",
      filename: `registration-${params.id}.pdf`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
