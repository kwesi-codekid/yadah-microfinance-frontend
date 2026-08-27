import { exportTxns, type ExportFormat } from "~/api/savings";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { requireUser, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/savings-transactions-export";

/**
 * `GET /savings/:id/transactions/export?format=csv|xlsx` — one account's
 * statement as a spreadsheet. The date range travels from the statement on
 * screen, so the file matches what was being read.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request);
  const url = new URL(request.url);

  const format: ExportFormat =
    url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : undefined;
  };

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportTxns(token, params.id, { from: day("from"), to: day("to") }, format),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `savings-statement-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
