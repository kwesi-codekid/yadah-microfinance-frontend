import { exportOutstandingLoans, type ExportFormat } from "~/api/reports";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/report-loans-export";

/**
 * `GET /reports/loans/outstanding?format=csv|xlsx` as a download. The endpoint takes no
 * range — it is a position as at now — so there is nothing to read off the
 * query string but the format.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);

  const format: ExportFormat =
    new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportOutstandingLoans(token, format),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `outstanding-loans-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
