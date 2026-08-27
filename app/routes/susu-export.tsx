import { exportAccounts, type ExportFormat } from "~/api/susu";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { requireUser, withAuth } from "~/lib/session.server";
import type { SusuStatus } from "~/lib/susu";
import type { Route } from "./+types/susu-export";

/**
 * `GET /susu/export?format=csv|xlsx&…` — the susu book as a spreadsheet,
 * proxied with the session's bearer token, which the browser cannot supply.
 *
 * The filters are forwarded verbatim from the listing's own query string, minus
 * pagination — the API ignores it on an export and caps the file at 10,000 rows.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["active", "completed", "pending-payout", "closed", "terminated"];

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  const url = new URL(request.url);

  const format: ExportFormat =
    url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const statusParam = url.searchParams.get("status") ?? "";
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : undefined;
  };

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportAccounts(
        token,
        {
          status: STATUSES.includes(statusParam)
            ? (statusParam as SusuStatus)
            : undefined,
          search: url.searchParams.get("search")?.trim() || undefined,
          from: day("from"),
          to: day("to"),
        },
        format,
      ),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `susu-accounts-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
