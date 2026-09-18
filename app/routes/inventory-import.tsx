import { DownloadIcon } from "lucide-react";
import { useRef } from "react";
import { data, useFetcher } from "react-router";

import { ApiError } from "~/api/error";
import { previewItemImport, runItemImport } from "~/api/hire-purchase";
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
  type ImportField,
  type ImportOutcome,
  type ImportPreview,
  type ImportRow,
  type LabelOption,
} from "~/lib/inventory-import";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/inventory-import";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Import stock · Yadah Dynamic Enterprise" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireCounter(request);
  return null;
}

type ActionResult = ImportActionResult<ImportPreview, ImportOutcome>;

/**
 * Two steps, and only the second writes: check the sheet, then stock what was
 * accepted. Both go through the API — the browser holds no token, and the
 * rules that matter are the API's.
 */
export async function action({ request }: Route.ActionArgs) {
  await requireCounter(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "preview") {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return data<ActionResult>({ ok: false, error: "Choose a file first." }, { status: 400 });
      }
      const { data: preview, headers } = await withAuth(request, (token) =>
        previewItemImport(token, file),
      );
      return data<ActionResult>({ ok: true, step: "preview", preview }, { headers });
    }

    if (intent === "import") {
      const rows = JSON.parse(String(form.get("rows") ?? "[]")) as ImportRow[];
      if (rows.length === 0) {
        return data<ActionResult>({ ok: false, error: "No rows to add." }, { status: 400 });
      }
      const { data: outcome, headers } = await withAuth(request, (token) =>
        runItemImport(
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

const NOUN = { one: "item", many: "items" };

export default function InventoryImport() {
  const fetcher = useFetcher<ActionResult>();
  const busy = fetcher.state !== "idle";

  // The brands and categories a row may be filed under, as the last preview
  // offered them. A ref rather than state: read in the same pass that sets it.
  const labels = useRef<{ brands: LabelOption[]; categories: LabelOption[] }>({
    brands: [],
    categories: [],
  });

  const sheet = useImportRows<ImportField, ImportRow, ImportPreview, ImportOutcome>({
    result: fetcher.data,
    seed: (preview) => {
      labels.current = { brands: preview.brands, categories: preview.categories };
      return preview.rows.map((row) => ({
        ...row,
        values: { ...blankValues(), ...row.values },
        issues: row.issues.map((i) => ({ ...i, fromServer: true })),
      }));
    },
    check: checkRows,
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
      return checkRows(next);
    });
  }

  /** A picker writes both the id the API wants and the name the cell shows. */
  function pickLabel(rowNumber: number, field: "brand" | "category", id: string) {
    const options = field === "brand" ? labels.current.brands : labels.current.categories;
    const name = options.find((o) => o.id === id)?.name ?? "";
    sheet.setRows((current) => {
      if (!current) return current;
      const next = current.map((row) =>
        row.row !== rowNumber
          ? row
          : {
              ...row,
              [field === "brand" ? "brandId" : "categoryId"]: id,
              values: { ...row.values, [field]: name },
              issues: row.issues.filter((i) => !(i.fromServer && i.field === field)),
            },
      );
      return checkRows(next);
    });
  }

  return (
    <Page className="max-w-none">
      <BackLink to="/inventory" className="mb-4">
        Inventory
      </BackLink>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-heading text-2xl font-bold tracking-tight">Import stock</h2>
        <Button asChild variant="outline">
          <a href="/inventory/import/template?format=xlsx">
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
              <p>Every row needs an item name, a quantity, a cost price and a selling price.</p>
              <p>Prices in cedis. Brand and category cells must name ones already on the lists.</p>
              <p>An item already on the shelf is flagged; adjust its stock instead.</p>
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
          renderCell={(row, column, shell) => {
            if (column.field !== "brand" && column.field !== "category") return undefined;
            const field = column.field;
            const options = field === "brand" ? labels.current.brands : labels.current.categories;
            const chosen = field === "brand" ? row.brandId : row.categoryId;
            const typed = row.values[field].trim();
            return (
              <select
                value={chosen}
                onChange={(e) => pickLabel(row.row, field, e.target.value)}
                className={shell}
                aria-label={`${column.header}, row ${row.row}`}
              >
                {/* What the sheet said stays visible even when it matched
                    nothing — otherwise a rejected cell reads as empty. */}
                <option value="">{typed && !chosen ? `${typed} — not found` : "None"}</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            );
          }}
          onStartOver={sheet.reset}
          onImport={(ready) =>
            fetcher.submit(
              { intent: "import", rows: JSON.stringify(ready) },
              { method: "post" },
            )
          }
          doneTo={{ to: "/inventory", label: "See the shelf" }}
        />
      )}
    </Page>
  );
}
