/**
 * The three things every list endpoint in this API has in common: a page
 * envelope, a spreadsheet format, and a query string built the same way.
 *
 * Nineteen list endpoints across eight modules share the shape — `page`,
 * `limit`, `search`, `from`, `to`, `format`, plus whatever that module filters
 * on. Writing the serialiser once is what keeps `page=1` out of every URL and
 * an empty filter out of every query string, in all of them, forever.
 *
 * Server-only by association: it is imported by the modules that call the API.
 */

export type ExportFormat = "csv" | "xlsx";

/** The envelope every paginated endpoint answers with. */
export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

/** What every list endpoint accepts, whatever else it adds on top. */
export interface ListParams {
  page?: number;
  limit?: number;
  /** Fuzzy and typo-tolerant, server-side. */
  search?: string;
  /** Inclusive Accra days, `YYYY-MM-DD`. */
  from?: string;
  to?: string;
}

/**
 * Parameters as a query string, or an empty string when there are none.
 *
 * Empty values are dropped rather than sent blank — the API treats `status=`
 * as a filter on nothing — and `page=1` is dropped because it is the default,
 * which keeps the first page of every listing on a clean URL.
 */
export function queryOf(
  params: Record<string, string | number | boolean | undefined>,
  format?: ExportFormat,
): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    if (key === "page" && Number(value) <= 1) continue;
    q.set(key, String(value));
  }
  if (format) q.set("format", format);
  const s = q.toString();
  return s ? `?${s}` : "";
}
