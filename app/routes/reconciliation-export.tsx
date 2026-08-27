import {
  exportReconciliations,
  type ExportFormat,
} from "~/api/reconciliation";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import type { ReconciliationStatus } from "~/lib/reconciliation";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/reconciliation-export";

/**
 * `GET /reconciliation/export?format=csv|xlsx&…` — the handover book as a
 * spreadsheet, proxied with the session's bearer token, which the browser
 * cannot supply.
 *
 * Office only. A collector reads their own days on screen; a file covering
 * everyone's is a different thing and belongs to whoever counts the cash.
 */
const STATUSES = ["declared", "reconciled"];

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const format: ExportFormat =
    url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const statusParam = url.searchParams.get("status") ?? "";

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportReconciliations(
        token,
        {
          status: STATUSES.includes(statusParam)
            ? (statusParam as ReconciliationStatus)
            : undefined,
          collectorId: url.searchParams.get("collectorId") || undefined,
          varianceOnly:
            url.searchParams.get("variance") === "1" ? "true" : undefined,
          from: url.searchParams.get("from") || undefined,
          to: url.searchParams.get("to") || undefined,
        },
        format,
      ),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `cash-handover-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
