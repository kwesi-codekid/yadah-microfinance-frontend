import { itemImportTemplate } from "~/api/hire-purchase";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/inventory-import-template";

/**
 * `GET /inventory/import/template?format=csv|xlsx` — the blank stock sheet,
 * proxied with the session's bearer token because the browser holds none.
 *
 * A sibling of the import page rather than a child: nesting would run the
 * page's own work to answer a download.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireCounter(request);
  const format =
    new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      itemImportTemplate(token, format),
    );
    return await asDownload(upstream, {
      kind: format,
      filename: `inventory-import-template.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
