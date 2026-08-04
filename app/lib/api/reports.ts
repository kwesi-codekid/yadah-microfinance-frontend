import { apiFetch, apiFetchRaw } from "~/lib/api/client";
import {
  REPORTS,
  type ReportName,
  type ReportRange,
} from "~/lib/report-client";

/**
 * The four report endpoints. Their JSON responses are declared as a
 * propertyless object in the spec, so nothing here claims to know their shape —
 * [report-shape.ts](app/lib/report-shape.ts) reads whatever comes back.
 * `format=csv` is fully specified and needs no shape at all, which is why the
 * download is offered beside every one of them.
 */
function query(name: ReportName, range: ReportRange, format?: "csv"): string {
  const q = new URLSearchParams();
  if (REPORTS[name].ranged) {
    if (range.from) q.set("from", range.from);
    if (range.to) q.set("to", range.to);
  }
  if (format) q.set("format", format);
  const qs = q.toString();
  return `${REPORTS[name].path}${qs ? `?${qs}` : ""}`;
}

/** The report as JSON — shape unknown, deliberately typed as such. */
export function getReport(
  accessToken: string,
  name: ReportName,
  range: ReportRange = {},
): Promise<unknown> {
  return apiFetch<unknown>(query(name, range), { accessToken });
}

/** The same report as a CSV response, for streaming back as a download. */
export function getReportCsv(
  accessToken: string,
  name: ReportName,
  range: ReportRange = {},
): Promise<Response> {
  return apiFetchRaw(query(name, range, "csv"), { accessToken });
}
