import { exportItems, type ExportFormat } from "~/api/hire-purchase";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import type { ItemStatus } from "~/lib/hire-purchase";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/inventory-export";

/**
 * `GET /inventory/export?format=csv|xlsx&…` — the shelf as a spreadsheet,
 * proxied with the session's bearer token, which the browser cannot supply.
 *
 * The file carries the cost price, which the on-screen listing keeps covered.
 * That is the API's own export and there is no way to ask it for a version
 * without — so treat the file the way the column is treated: office only.
 */
const STATUSES = ["active", "discontinued"];

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const format: ExportFormat =
    url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const statusParam = url.searchParams.get("status") ?? "";

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportItems(
        token,
        {
          status: STATUSES.includes(statusParam)
            ? (statusParam as ItemStatus)
            : undefined,
          search: url.searchParams.get("search")?.trim() || undefined,
          inStockOnly: url.searchParams.get("inStock") === "1" || undefined,
        },
        format,
      ),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `inventory-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
