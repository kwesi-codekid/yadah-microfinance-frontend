import { exportItems, type ExportFormat } from "~/api/hire-purchase";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import type { ItemStatus } from "~/lib/hire-purchase";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/inventory-export";

/**
 * `GET /inventory/export?format=csv|xlsx&…` — the shelf as a spreadsheet,
 * proxied with the session's bearer token, which the browser cannot supply.
 *
 * The file carries the cost price, which the on-screen listing keeps covered
 * until asked. The shelf is the counter's, and so is its export — but it is a
 * file with Yadah's figures in it and should be handled as one.
 */
const STATUSES = ["active", "discontinued"];

export async function loader({ request }: Route.LoaderArgs) {
  await requireCounter(request);
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
          brandId: url.searchParams.get("brand")?.trim() || undefined,
          categoryId: url.searchParams.get("category")?.trim() || undefined,
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
