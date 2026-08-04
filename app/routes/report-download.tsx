import type { Route } from "./+types/report-download";
import { getReportCsv } from "~/lib/api/reports";
import { isReportName } from "~/lib/report-client";
import { requireOffice, withAuth } from "~/lib/session.server";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readDate(value: string | null): string | undefined {
  return value && ISO_DATE.test(value) ? value : undefined;
}

/**
 * Streams a report's CSV back as a download. It exists because the browser
 * can't call the API itself — the access token lives in an httpOnly cookie and
 * never reaches client JavaScript.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);

  const sp = new URL(request.url).searchParams;
  const name = sp.get("report");
  if (!isReportName(name)) {
    throw new Response("Unknown report", { status: 404 });
  }

  const range = { from: readDate(sp.get("from")), to: readDate(sp.get("to")) };

  const { data: csv, headers: session } = await withAuth(
    request,
    async (token) => {
      const response = await getReportCsv(token, name, range);
      return response.text();
    },
  );

  const stamp = [range.from, range.to].filter(Boolean).join("_");
  const filename = `${name}${stamp ? `_${stamp}` : ""}.csv`;

  const headers = new Headers();
  headers.set("Content-Type", "text/csv; charset=utf-8");
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  // A report is a snapshot of live figures; caching it would age silently.
  headers.set("Cache-Control", "no-store");
  // A rotated refresh token has to travel back, or the next request signs out.
  if (session) headers.append("Set-Cookie", session["Set-Cookie"]);

  return new Response(csv, { headers });
}
