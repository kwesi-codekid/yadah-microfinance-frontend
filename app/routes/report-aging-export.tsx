import { exportLoanAging, type ExportFormat } from "~/api/reports";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/report-aging-export";

/**
 * `GET /reports/loans/aging?format=csv|xlsx` as a download. The endpoint takes no
 * range — it is a position as at now — so there is nothing to read off the
 * query string but the format.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);

  const format: ExportFormat =
    new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportLoanAging(token, format),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `loan-aging-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
