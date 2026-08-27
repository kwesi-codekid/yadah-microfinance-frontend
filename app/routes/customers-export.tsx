import { exportCustomers, type ExportFormat } from "~/api/customers";
import type { CustomerStatus } from "~/lib/customers";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { requireUser, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/customers-export";

/**
 * `GET /customers/export?format=csv|xlsx&…` — the customer listing as a
 * spreadsheet, proxied with the session's bearer token.
 *
 * The filters are forwarded verbatim from the listing's own query string, minus
 * pagination — the API ignores it on an export and caps the file at 10,000 rows.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  const url = new URL(request.url);

  const format: ExportFormat =
    url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const statusParam = url.searchParams.get("status");
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : undefined;
  };

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportCustomers(
        token,
        {
          status:
            statusParam === "active" || statusParam === "inactive"
              ? (statusParam as CustomerStatus)
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
      filename: `customers-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
