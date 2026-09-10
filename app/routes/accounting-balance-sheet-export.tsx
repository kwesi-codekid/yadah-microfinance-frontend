import { exportBalanceSheet, type StatementFormat } from "~/api/accounting";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/accounting-balance-sheet-export";

/**
 * `GET /accounting/balance-sheet?format=csv|xlsx|pdf` as a download, proxied
 * with the session's bearer token — the browser holds none of its own.
 *
 * The PDF is the laid-out A4 statement on Yadah letterhead, and it opens in
 * the tab rather than saving, the way every receipt does: it is meant to be
 * looked at and printed, not filed. A sibling of the statement rather than a
 * child — nesting would run its query just to answer a file.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const raw = url.searchParams.get("format");
  const format: StatementFormat =
    raw === "xlsx" ? "xlsx" : raw === "pdf" ? "pdf" : "csv";
  const asOf = url.searchParams.get("asOf") ?? "";

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportBalanceSheet(token, { asOf: DAY_RE.test(asOf) ? asOf : undefined }, format),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `balance-sheet-${DAY_RE.test(asOf) ? asOf : accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
