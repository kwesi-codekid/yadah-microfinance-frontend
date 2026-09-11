import { exportLoanAging, type ExportFormat } from "~/api/reports";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { readDay } from "~/lib/period";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/report-aging-export";

/**
 * `GET /reports/loans/aging?format=csv|xlsx` as a download. The endpoint takes no
 * The range is forwarded so the file covers the same loans the screen does:
 * without it the download would quietly be the whole book while the screen
 * showed one month of it.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);

  const params = new URL(request.url).searchParams;
  const format: ExportFormat = params.get("format") === "xlsx" ? "xlsx" : "csv";
  const from = readDay(params, "from");
  const to = readDay(params, "to");
  const range = { ...(from ? { from } : {}), ...(to ? { to } : {}) };

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportLoanAging(token, format, range),
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
