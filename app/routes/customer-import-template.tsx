import { importTemplate } from "~/api/customers";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/customer-import-template";

/**
 * `GET /customers/import/template?format=csv|xlsx` — the blank import sheet,
 * proxied with the session's bearer token because the browser holds none.
 *
 * A sibling of the import page rather than a child: nesting would run the
 * page's own work to answer a download.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const format =
    new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      importTemplate(token, format),
    );
    return await asDownload(upstream, {
      kind: format,
      filename: `customer-import-template.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
