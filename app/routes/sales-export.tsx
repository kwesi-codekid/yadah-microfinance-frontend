import { exportSales, type ExportFormat } from "~/api/sales";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import type { SaleStatus } from "~/lib/sales";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/sales-export";

/**
 * `GET /sales/export?format=csv|xlsx&…` — the day book as a spreadsheet,
 * proxied with the session's bearer token, which the browser cannot supply.
 *
 * The file carries cost and profit per sale, which the JSON listing never
 * exposes. That is the API's own export and there is no way to ask it for a
 * version without — so the file is office-only, like the profit tile above the
 * listing it came from.
 */
const STATUSES = ["completed", "voided"];

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const format: ExportFormat =
    url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const statusParam = url.searchParams.get("status") ?? "";

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportSales(
        token,
        {
          status: STATUSES.includes(statusParam)
            ? (statusParam as SaleStatus)
            : undefined,
          search: url.searchParams.get("search")?.trim() || undefined,
          walkInOnly: url.searchParams.get("walkIn") === "1" ? "true" : undefined,
          from: url.searchParams.get("from") || undefined,
          to: url.searchParams.get("to") || undefined,
        },
        format,
      ),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `counter-sales-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
