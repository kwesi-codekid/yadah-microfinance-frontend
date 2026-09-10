import { exportExpenses, type ExportFormat } from "~/api/accounting";
import { asDownload, downloadFailure } from "~/lib/download.server";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  type ExpenseCategory,
  type ExpenseStatus,
} from "~/lib/accounting";
import { accraDay } from "~/lib/format";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/accounting-expenses-export";

/**
 * `GET /accounting/expenses?format=csv|xlsx` as a download, proxied with the
 * session's bearer token — the browser holds none of its own.
 *
 * The filters are read the way the listing reads them, so the file holds
 * exactly what was on screen. A sibling of the listing rather than a child:
 * nesting would run its six queries just to answer a file.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  const url = new URL(request.url);

  const format: ExportFormat =
    url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const day = (key: string) => {
    const v = url.searchParams.get(key) ?? "";
    return DAY_RE.test(v) ? v : undefined;
  };
  const status = url.searchParams.get("status") as ExpenseStatus | null;
  const category = url.searchParams.get("category") as ExpenseCategory | null;

  try {
    const { data: upstream, headers } = await withAuth(request, (token) =>
      exportExpenses(
        token,
        {
          status: status && EXPENSE_STATUSES.includes(status) ? status : undefined,
          category:
            category && EXPENSE_CATEGORIES.includes(category) ? category : undefined,
          cashAccountId: url.searchParams.get("account")?.trim() || undefined,
          search: url.searchParams.get("search")?.trim() || undefined,
          from: day("from"),
          to: day("to"),
        },
        format,
      ),
    );

    return await asDownload(upstream, {
      kind: format,
      filename: `expenses-${accraDay()}.${format}`,
      cookie: headers?.["Set-Cookie"],
    });
  } catch (error) {
    return downloadFailure(error);
  }
}
