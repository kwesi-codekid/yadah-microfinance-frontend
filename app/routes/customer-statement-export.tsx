import { exportCustomerStatement, type ExportFormat } from "~/api/customers";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/customer-statement-export";

/**
 * `GET /customers/:id/statement/export?format=csv|xlsx&from=&to=` — the
 * statement's transaction rows as a spreadsheet. Proxied for the same reason
 * the listing export is: the browser holds no access token.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function loader({ request, params }: Route.LoaderArgs) {
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
      exportCustomerStatement(
        token,
        params.id,
        { from: day("from"), to: day("to") },
        format,
      ),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `statement-${params.id}-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
