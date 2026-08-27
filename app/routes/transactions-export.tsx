import { exportTransactions, type ExportFormat } from "~/api/reports";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { MODULES, type TxnModule } from "~/lib/reports";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/transactions-export";

/**
 * `GET /transactions/export?format=csv|xlsx&…` — the ledger as a spreadsheet,
 * proxied with the session's bearer token, which the browser cannot supply.
 *
 * The filters come straight off the listing's own query string, minus
 * pagination — the API ignores it on an export and caps the file at 10,000
 * rows. A sibling of the listing rather than a child of it: nesting would run
 * the ledger's own queries just to answer a download.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const format: ExportFormat =
    url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const moduleParam = url.searchParams.get("module") as TxnModule | null;
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : undefined;
  };

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportTransactions(
        token,
        {
          module:
            moduleParam && MODULES.includes(moduleParam) ? moduleParam : undefined,
          customerId: url.searchParams.get("customerId")?.trim() || undefined,
          from: day("from"),
          to: day("to"),
        },
        format,
      ),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `transactions-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
