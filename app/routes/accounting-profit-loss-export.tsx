import { exportProfitAndLoss, type StatementFormat } from "~/api/accounting";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/accounting-profit-loss-export";

/**
 * `GET /accounting/profit-loss?format=csv|xlsx|pdf` as a download, proxied
 * with the session's bearer token — the browser holds none of its own.
 *
 * The PDF is the laid-out A4 statement on Yadah letterhead. A sibling of the
 * statement rather than a child — nesting would run its query just to answer
 * a file.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const raw = url.searchParams.get("format");
  const format: StatementFormat =
    raw === "xlsx" ? "xlsx" : raw === "pdf" ? "pdf" : "csv";
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : undefined;
  };
  const from = day("from");
  const to = day("to");

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportProfitAndLoss(token, { from, to }, format),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `profit-and-loss-${from ?? ""}${from && to ? "-to-" : ""}${to ?? accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
