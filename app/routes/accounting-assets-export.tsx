import { exportAssets, type ExportFormat } from "~/api/accounting";
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  type AssetCategory,
  type AssetStatus,
} from "~/lib/accounting";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/accounting-assets-export";

/**
 * `GET /accounting/fixed-assets?format=csv|xlsx` as a download, proxied with
 * the session's bearer token — the browser holds none of its own.
 *
 * Depreciation in the file is computed as at the same `asOf` the register was
 * read at, so the download matches the screen. A sibling of the register
 * rather than a child: nesting would run its queries just to answer a file.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const format: ExportFormat =
    url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const status = url.searchParams.get("status") as AssetStatus | null;
  const category = url.searchParams.get("category") as AssetCategory | null;
  const asOf = url.searchParams.get("asOf") ?? "";

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportAssets(
        token,
        {
          status: status && ASSET_STATUSES.includes(status) ? status : undefined,
          category:
            category && ASSET_CATEGORIES.includes(category) ? category : undefined,
          asOf: DAY_RE.test(asOf) ? asOf : undefined,
        },
        format,
      ),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `fixed-assets-${DAY_RE.test(asOf) ? asOf : accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
