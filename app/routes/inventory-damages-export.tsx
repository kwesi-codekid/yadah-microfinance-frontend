import { exportDamages, type ExportFormat } from "~/api/hire-purchase";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { DAMAGE_CAUSES, DAMAGE_STATUSES } from "~/lib/hire-purchase";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/inventory-damages-export";

/**
 * `GET /hire-purchase/damages?format=csv|xlsx&…` — the damage register as a
 * spreadsheet, proxied with the session's bearer token, which the browser
 * cannot supply.
 *
 * The same filters the screen was showing go up with it, so the file and the
 * page agree. It carries the cost of each write-off, which is an office figure.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireCounter(request);
  const url = new URL(request.url);

  const format: ExportFormat = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const status = url.searchParams.get("status") ?? "";
  const cause = url.searchParams.get("cause") ?? "";

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportDamages(
        token,
        {
          status: (DAMAGE_STATUSES as readonly string[]).includes(status) ? status : undefined,
          cause: (DAMAGE_CAUSES as readonly string[]).includes(cause) ? cause : undefined,
          search: url.searchParams.get("search")?.trim() || undefined,
        },
        format,
      ),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `damages-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
