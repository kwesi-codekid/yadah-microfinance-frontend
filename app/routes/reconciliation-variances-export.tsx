import { exportVariances, type ExportFormat } from "~/api/reconciliation";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/reconciliation-variances-export";

/**
 * `GET /reconciliation/variances/export?format=csv|xlsx&…` — the variance
 * report as a spreadsheet, proxied with the session's bearer token.
 *
 * Office only, like the report it comes from: it is about the collectors rather
 * than for them.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const format: ExportFormat =
    url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportVariances(
        token,
        {
          from: url.searchParams.get("from") || undefined,
          to: url.searchParams.get("to") || undefined,
          collectorId: url.searchParams.get("collectorId") || undefined,
        },
        format,
      ),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `cash-variances-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
