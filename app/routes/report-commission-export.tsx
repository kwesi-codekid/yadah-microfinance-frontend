import { exportCommission, type ExportFormat } from "~/api/reports";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/report-commission-export";

/**
 * `GET /reports/commission?format=csv|xlsx` as a download, proxied with the
 * session's bearer token — the browser holds none of its own.
 *
 * A sibling of the report rather than a child: nesting would run the report's
 * own queries just to answer a file.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const format: ExportFormat =
    url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : undefined;
  };

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportCommission(token, { from: day("from"), to: day("to") }, format),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `commission-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
