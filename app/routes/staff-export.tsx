import { exportUsers, type ExportFormat } from "~/api/users";
import { ROLES, type Role } from "~/lib/auth";
import { asDownload, downloadFailure } from "~/lib/download.server";
import { accraDay } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { StaffStatus } from "~/lib/staff";
import type { Route } from "./+types/staff-export";

/**
 * `GET /staff/export?format=csv|xlsx&…` — the staff listing as a spreadsheet,
 * proxied with the session's bearer token, which the browser cannot supply.
 *
 * The filters are forwarded verbatim from the listing's own query string, minus
 * pagination — the API ignores it on an export and caps the file at 10,000 rows.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const format: ExportFormat =
    url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const statusParam = url.searchParams.get("status");
  const roleParam = url.searchParams.get("role");
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : undefined;
  };

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportUsers(
        token,
        {
          status:
            statusParam === "active" || statusParam === "disabled"
              ? (statusParam as StaffStatus)
              : undefined,
          role: ROLES.includes(roleParam as Role) ? (roleParam as Role) : undefined,
          search: url.searchParams.get("search")?.trim() || undefined,
          from: day("from"),
          to: day("to"),
        },
        format,
      ),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `staff-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
