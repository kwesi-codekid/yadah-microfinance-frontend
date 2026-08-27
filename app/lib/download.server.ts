/**
 * Shared plumbing for the routes that proxy a binary body out of the API — the
 * registration-form PDF and the CSV/XLSX exports. The browser holds no access
 * token, so it cannot call those endpoints itself; these routes fetch with the
 * session's bearer token and hand the bytes straight back.
 */

import { ApiError } from "~/api/error";

export const CONTENT_TYPES = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

export type DownloadKind = keyof typeof CONTENT_TYPES;

/**
 * Hand the upstream body back to the browser as a download.
 *
 * The body is buffered rather than streamed. These are small files — an export
 * the API caps at 10,000 rows, or a one-page PDF — and buffering means a
 * mid-transfer failure surfaces here, as an error page, instead of as a
 * truncated file on someone's disk.
 *
 * The API sends its own `Content-Disposition` with a sensible filename; the
 * fallbacks are only for the case where it does not.
 */
export async function asDownload(
  upstream: Response,
  { kind, filename, cookie }: { kind: DownloadKind; filename: string; cookie?: string },
): Promise<Response> {
  const body = await upstream.arrayBuffer();

  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("Content-Type") ?? CONTENT_TYPES[kind]);
  headers.set("Content-Length", String(body.byteLength));
  headers.set(
    "Content-Disposition",
    upstream.headers.get("Content-Disposition") ??
      `${kind === "pdf" ? "inline" : "attachment"}; filename="${filename}"`,
  );
  // A download is per-person and per-moment; nothing about it should be cached.
  headers.set("Cache-Control", "no-store");
  if (cookie) headers.append("Set-Cookie", cookie);

  return new Response(body, { status: 200, headers });
}

/**
 * What to show when the download itself fails. A resource route has no error
 * boundary to fall back on, so an unhandled throw here reaches the browser as a
 * blank failed download with nothing to explain it. Answer in plain text
 * instead, carrying the API's own message.
 */
export function downloadFailure(error: unknown): Response {
  if (error instanceof Response) return error;

  const message =
    error instanceof ApiError
      ? error.message
      : "Could not build that file. Try again.";
  // `ApiError` uses status 0 for network and timeout failures.
  const status =
    error instanceof ApiError && error.status >= 400 ? error.status : 502;

  return new Response(`${message}\n`, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
