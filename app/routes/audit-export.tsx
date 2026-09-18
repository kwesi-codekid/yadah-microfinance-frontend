import { exportAuditLogs } from "~/api/audit";
import type { ExportFormat } from "~/api/query";
import { AUDIT_AREAS, AUDIT_AREA_KEYS, type AuditArea } from "~/lib/audit";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/audit-export";

/**
 * `GET /audit-logs?format=csv|xlsx` as a download, proxied with the session's
 * bearer token — the browser holds none of its own.
 *
 * The filters are read the way the trail's own page reads them, so the file
 * holds exactly what was on screen. A sibling of the page rather than a
 * child: nesting would run its queries just to answer a file.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[0-9a-f]{24}$/;

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const format: ExportFormat =
    url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : undefined;
  };
  const id = (key: string) => {
    const v = url.searchParams.get(key)?.trim() ?? "";
    return ID_RE.test(v) ? v : undefined;
  };
  const area = url.searchParams.get("area") as AuditArea | null;
  const prefixes =
    area && AUDIT_AREA_KEYS.includes(area)
      ? AUDIT_AREAS.find((a) => a.key === area)?.prefixes.join(",")
      : undefined;
  const entityType = url.searchParams.get("entityType")?.trim() ?? "";

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportAuditLogs(
        token,
        {
          action: prefixes,
          actorId: id("actorId"),
          entityType: /^[a-z][a-z-]*$/.test(entityType) ? entityType : undefined,
          entityId: id("entityId"),
          from: day("from"),
          to: day("to"),
        },
        format,
      ),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `audit-log-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
