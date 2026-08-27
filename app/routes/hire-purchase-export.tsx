import { exportAgreements, type ExportFormat } from "~/api/hire-purchase";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import type { AgreementStatus } from "~/lib/hire-purchase";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/hire-purchase-export";

/**
 * `GET /hire-purchase/export?format=csv|xlsx&…` — the contract book as a
 * spreadsheet, proxied with the session's bearer token, which the browser
 * cannot supply.
 *
 * The filters come straight off the listing's query string, minus pagination —
 * the API ignores it on an export and caps the file at 10,000 rows.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const STATUSES = [
  "pending",
  "rejected",
  "active",
  "in-arrears",
  "repossessed",
  "closed-redeemed",
  "closed-forfeited",
  "closed-completed",
];

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
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
      exportAgreements(
        token,
        {
          status: STATUSES.includes(statusParam)
            ? (statusParam as AgreementStatus)
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
      filename: `hire-purchase-agreements-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
