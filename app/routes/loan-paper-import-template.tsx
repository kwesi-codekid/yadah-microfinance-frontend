import { paperImportTemplate } from "~/api/loans";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/loan-paper-import-template";

/**
 * `GET /loans/paper-import/template?format=csv|xlsx` — the blank paper-loan
 * sheet, proxied with the session's bearer token because the browser holds none.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const format =
    new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      paperImportTemplate(token, format),
    );
    return await asDownload(upstream, {
      kind: format,
      filename: `paper-loans-template.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
