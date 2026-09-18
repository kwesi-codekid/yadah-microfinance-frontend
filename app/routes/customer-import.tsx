import { DownloadIcon } from "lucide-react";
import { useRef } from "react";
import { data, useFetcher } from "react-router";

import { previewImport, runImport } from "~/api/customers";
import { ApiError } from "~/api/error";
import {
  ChooseFile,
  ImportSheet,
  useImportRows,
  type ImportActionResult,
} from "~/components/import-sheet";
import { BackLink, Page } from "~/components/page";
import { Button } from "~/components/ui/button";
import {
  IMPORT_COLUMNS,
  blankValues,
  checkRows,
  type Collector,
  type ImportField,
  type ImportOutcome,
  type ImportPreview,
  type ImportRow,
} from "~/lib/customer-import";
import { requireOffice, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/customer-import";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Import customers · Yadah Dynamic Enterprise" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  return null;
}

type ActionResult = ImportActionResult<ImportPreview, ImportOutcome>;

/**
 * Two steps, and only the second writes: check the sheet, then register what
 * the office accepted. Both go through the API — the browser holds no token,
 * and the rules that matter are the API's.
 */
export async function action({ request }: Route.ActionArgs) {
  await requireOffice(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "preview") {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return data<ActionResult>({ ok: false, error: "Choose a file first." }, { status: 400 });
      }
      const { data: preview, headers } = await withAuth(request, (token) =>
        previewImport(token, file),
      );
      return data<ActionResult>({ ok: true, step: "preview", preview }, { headers });
    }

    if (intent === "import") {
      const rows = JSON.parse(String(form.get("rows") ?? "[]")) as ImportRow[];
      if (rows.length === 0) {
        return data<ActionResult>({ ok: false, error: "No rows to register." }, { status: 400 });
      }
      const { data: outcome, headers } = await withAuth(request, (token) =>
        runImport(
          token,
          rows.map((r) => ({ row: r.row, values: r.values })),
        ),
      );
      return data<ActionResult>({ ok: true, step: "import", outcome }, { headers });
    }

    return data<ActionResult>({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (error) {
    if (error instanceof ApiError) {
      return data<ActionResult>({ ok: false, error: error.message }, { status: error.status });
    }
    throw error;
  }
}

const NOUN = { one: "customer", many: "customers" };

export default function CustomerImport() {
  const fetcher = useFetcher<ActionResult>();
  const busy = fetcher.state !== "idle";

  // The collectors a row may be put on, as the last preview offered them.
  // A ref rather than state: the checks read it in the same pass that sets it.
  const collectors = useRef<Collector[]>([]);
  const collectorIds = () => new Set(collectors.current.map((c) => c.id));

  const sheet = useImportRows<ImportField, ImportRow, ImportPreview, ImportOutcome>({
    result: fetcher.data,
    seed: (preview) => {
      collectors.current = preview.collectors;
      return preview.rows.map((row) => ({
        ...row,
        values: { ...blankValues(), ...row.values },
        issues: row.issues.map((i) => ({ ...i, fromServer: true })),
      }));
    },
    check: (rows) => checkRows(rows, collectorIds()),
    noun: NOUN,
  });

  function editCell(rowNumber: number, field: ImportField, value: string) {
    sheet.setRows((current) => {
      if (!current) return current;
      const next = current.map((row) =>
        row.row !== rowNumber
          ? row
          : {
              ...row,
              values: { ...row.values, [field]: value },
              // The API's verdict was about what used to be in this box.
              issues: row.issues.filter((i) => !(i.fromServer && i.field === field)),
            },
      );
      return checkRows(next, collectorIds());
    });
  }

  function editCollector(rowNumber: number, collectorId: string) {
    sheet.setRows((current) => {
      if (!current) return current;
      const name = collectors.current.find((c) => c.id === collectorId)?.name ?? "";
      const next = current.map((row) =>
        row.row !== rowNumber
          ? row
          : {
              ...row,
              assignedCollectorId: collectorId,
              values: { ...row.values, collector: name },
              issues: row.issues.filter((i) => !(i.fromServer && i.field === "collector")),
            },
      );
      return checkRows(next, collectorIds());
    });
  }

  return (
    <Page className="max-w-none">
      <BackLink to="/customers" className="mb-4">
        All customers
      </BackLink>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-heading text-2xl font-bold tracking-tight">Import customers</h2>
        <Button asChild variant="outline">
          <a href="/customers/import/template?format=xlsx">
            <DownloadIcon /> Download the template
          </a>
        </Button>
      </div>

      {sheet.rows === null ? (
        <ChooseFile
          fetcher={fetcher}
          busy={busy}
          requirements={
            <>
              <p>Every row needs a name, a phone number and a collector.</p>
              <p>Headings are matched loosely — start from the template if in doubt.</p>
              <p>Photos cannot come from a sheet; add them at the counter.</p>
            </>
          }
        />
      ) : (
        <ImportSheet
          rows={sheet.rows}
          columns={IMPORT_COLUMNS}
          unknownHeaders={sheet.preview?.unknownHeaders ?? []}
          registered={sheet.registered}
          noun={NOUN}
          busy={busy}
          onEdit={editCell}
          renderCell={(row, column, shell) =>
            column.field === "collector" ? (
              <select
                value={row.assignedCollectorId}
                onChange={(e) => editCollector(row.row, e.target.value)}
                className={shell}
                aria-label={`Collector, row ${row.row}`}
              >
                <option value="">
                  {row.values.collector.trim()
                    ? `${row.values.collector} — not found`
                    : "Choose a collector"}
                </option>
                {collectors.current.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : undefined
          }
          onStartOver={sheet.reset}
          onImport={(ready) =>
            fetcher.submit(
              { intent: "import", rows: JSON.stringify(ready) },
              { method: "post" },
            )
          }
          doneTo={{ to: "/customers", label: "See the customers" }}
        />
      )}
    </Page>
  );
}
