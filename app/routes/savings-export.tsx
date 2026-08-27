import { exportAccounts, type ExportFormat } from "~/api/savings";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { requireUser, withAuth } from "~/lib/session.server";
import type { SavingsAccountType, SavingsStatus } from "~/lib/savings";
import type { Route } from "./+types/savings-export";

/**
 * `GET /savings/export?format=csv|xlsx&…` — the savings book as a spreadsheet,
 * proxied with the session's bearer token, which the browser cannot supply.
 *
 * The filters are forwarded verbatim from the listing's own query string, minus
 * pagination — the API ignores it on an export and caps the file at 10,000 rows.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["active", "closed"];
const TYPES = ["standard", "student"];

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  const url = new URL(request.url);

  const format: ExportFormat =
    url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const statusParam = url.searchParams.get("status") ?? "";
  // The listing calls it `type`; the API calls it `accountType`.
  const typeParam = url.searchParams.get("type") ?? "";
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
            ? (statusParam as SavingsStatus)
            : undefined,
          accountType: TYPES.includes(typeParam)
            ? (typeParam as SavingsAccountType)
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
      filename: `savings-accounts-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
