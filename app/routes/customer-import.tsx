import {
  CheckCircle2Icon,
  DownloadIcon,
  Loader2Icon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, data, useFetcher } from "react-router";
import { toast } from "sonner";

import { previewImport, runImport } from "~/api/customers";
import { ApiError } from "~/api/error";
import { BackLink, Page } from "~/components/page";
import { Button } from "~/components/ui/button";
import {
  blankValues,
  checkRows,
  isReady,
  issueFor,
  normalizePhone,
  optionsFor,
  rowLevelIssues,
  visibleColumns,
  type Collector,
  type ImportColumn,
  type ImportField,
  type ImportOutcome,
  type ImportPreview,
  type ImportRow,
} from "~/lib/customer-import";
import { requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/customer-import";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Import customers · Yadah Dynamic Enterprise" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  return null;
}

type ActionResult =
  | { ok: true; step: "preview"; preview: ImportPreview }
  | { ok: true; step: "import"; outcome: ImportOutcome }
  | { ok: false; error: string };

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

/** Beyond this many rows on screen the table stops being reviewable anyway. */
const RENDER_CAP = 200;

export default function CustomerImport() {
  const fetcher = useFetcher<ActionResult>();
  const busy = fetcher.state !== "idle";

  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [collectors, setCollectors] = useState<Collector[]>([]);
  const [unknownHeaders, setUnknownHeaders] = useState<string[]>([]);
  const [registered, setRegistered] = useState(0);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const collectorIds = new Set(collectors.map((c) => c.id));

  useEffect(() => {
    const result = fetcher.data;
    if (!result) return;

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    if (result.step === "preview") {
      const { preview } = result;
      setCollectors(preview.collectors);
      setUnknownHeaders(preview.unknownHeaders);
      setRegistered(0);
      const seeded = preview.rows.map((row) => ({
        ...row,
        values: { ...blankValues(), ...row.values },
        issues: row.issues.map((i) => ({ ...i, fromServer: true })),
      }));
      const ids = new Set(preview.collectors.map((c) => c.id));
      const checked = checkRows(seeded, ids);
      setRows(checked);
      setOnlyProblems(checked.some((r) => !isReady(r)));
      return;
    }

    // An import: only what was registered leaves the sheet. A row that failed
    // stays with the reason it failed, and one that was never sent — because
    // it was still flagged — stays exactly as it was.
    const { outcome } = result;
    setRegistered((n) => n + outcome.counts.created);
    const done = new Set(outcome.created.map((c) => c.row));
    const failedBy = new Map(outcome.failed.map((f) => [f.row, f.issues]));
    setRows((current) => {
      if (!current) return current;
      const left = current
        .filter((r) => !done.has(r.row))
        .map((r) =>
          failedBy.has(r.row)
            ? {
                ...r,
                issues: (failedBy.get(r.row) ?? []).map((i) => ({
                  ...i,
                  fromServer: true,
                })),
              }
            : r,
        );
      return checkRows(left, collectorIds);
    });
    if (outcome.counts.created > 0) {
      toast.success(
        `${outcome.counts.created} ${outcome.counts.created === 1 ? "customer" : "customers"} registered.`,
      );
    }
    if (outcome.counts.failed > 0) {
      toast.error(
        `${outcome.counts.failed} ${outcome.counts.failed === 1 ? "row" : "rows"} could not be registered.`,
      );
    }
    // `collectorIds` is derived from state set in the same pass; re-running on
    // it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  function editCell(rowNumber: number, field: ImportField, value: string) {
    setRows((current) => {
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
      return checkRows(next, collectorIds);
    });
  }

  function editCollector(rowNumber: number, collectorId: string) {
    setRows((current) => {
      if (!current) return current;
      const name = collectors.find((c) => c.id === collectorId)?.name ?? "";
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
      return checkRows(next, collectorIds);
    });
  }

  const ready = rows?.filter(isReady) ?? [];
  const blocked = (rows?.length ?? 0) - ready.length;

  return (
    <Page className="max-w-none">
      <BackLink to="/customers" className="mb-4">
        All customers
      </BackLink>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight">
            Import customers
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Register a book of customers from one spreadsheet. Nothing is saved
            until you say so.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href="/customers/import/template?format=xlsx">
            <DownloadIcon /> Download the template
          </a>
        </Button>
      </div>

      {rows === null ? (
        <ChooseFile fetcher={fetcher} busy={busy} />
      ) : (
        <Sheet
          rows={rows}
          collectors={collectors}
          unknownHeaders={unknownHeaders}
          registered={registered}
          ready={ready}
          blocked={blocked}
          onlyProblems={onlyProblems}
          setOnlyProblems={setOnlyProblems}
          busy={busy}
          onEdit={editCell}
          onEditCollector={editCollector}
          onStartOver={() => {
            setRows(null);
            setRegistered(0);
          }}
          onImport={() => {
            fetcher.submit(
              { intent: "import", rows: JSON.stringify(ready) },
              { method: "post" },
            );
          }}
        />
      )}
    </Page>
  );
}

/* ----------------------------------------------------------- choosing a file --- */

function ChooseFile({
  fetcher,
  busy,
}: {
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function send(file: File) {
    const body = new FormData();
    body.append("intent", "preview");
    body.append("file", file);
    fetcher.submit(body, { method: "post", encType: "multipart/form-data" });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="flex h-64 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card text-center transition-colors hover:border-primary/40 hover:bg-accent/50 disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
            <span className="text-sm font-medium">Reading the sheet…</span>
          </>
        ) : (
          <>
            <UploadIcon className="size-6 text-muted-foreground" />
            <span className="text-sm font-medium">
              Choose a spreadsheet, or drop one here
            </span>
            <span className="text-xs text-muted-foreground">
              .xlsx or .csv · up to 5 MB · 1,000 rows
            </span>
          </>
        )}
      </button>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
        <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          What the sheet needs
        </h3>
        <div className="border-t border-border/60 pt-3">
          <p className="text-muted-foreground">
            A name, a phone number and a collector on every row. Everything else
            is optional and can be left blank.
          </p>
          <p className="mt-2 text-muted-foreground">
            Headings are matched loosely, so capitals and spacing do not matter.
            Start from the template if you would rather not guess.
          </p>
          <p className="mt-2 text-muted-foreground">
            No column can carry a customer photo, so imported customers arrive
            without one. Add it at the counter the next time they are in.
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) send(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------- the preview --- */

function Sheet({
  rows,
  collectors,
  unknownHeaders,
  registered,
  ready,
  blocked,
  onlyProblems,
  setOnlyProblems,
  busy,
  onEdit,
  onEditCollector,
  onStartOver,
  onImport,
}: {
  rows: ImportRow[];
  collectors: Collector[];
  unknownHeaders: string[];
  registered: number;
  ready: ImportRow[];
  blocked: number;
  onlyProblems: boolean;
  setOnlyProblems: (v: boolean) => void;
  busy: boolean;
  onEdit: (row: number, field: ImportField, value: string) => void;
  onEditCollector: (row: number, collectorId: string) => void;
  onStartOver: () => void;
  onImport: () => void;
}) {
  const columns = visibleColumns(rows);
  const shown = (onlyProblems ? rows.filter((r) => !isReady(r)) : rows).slice(0, RENDER_CAP);
  const hidden = (onlyProblems ? blocked : rows.length) - shown.length;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <CheckCircle2Icon className="mx-auto size-8 text-success" />
        <p className="mt-3 font-medium">
          {registered} {registered === 1 ? "customer" : "customers"} registered.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Every row went in.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="outline" onClick={onStartOver}>
            Import another sheet
          </Button>
          <Button asChild>
            <Link to="/customers">See the customers</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {unknownHeaders.length > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            {unknownHeaders.length === 1 ? "One heading was" : "These headings were"}{" "}
            not recognised and {unknownHeaders.length === 1 ? "its" : "their"} column
            {unknownHeaders.length === 1 ? " was" : "s were"} skipped:{" "}
            <span className="font-medium">{unknownHeaders.join(", ")}</span>.
          </span>
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {registered > 0 && (
            <span className="font-medium text-success">
              {registered} registered.{" "}
            </span>
          )}
          <span className="font-medium text-foreground">{rows.length}</span>{" "}
          {rows.length === 1 ? "row" : "rows"} on the sheet ·{" "}
          <span className="font-medium text-foreground">{ready.length}</span> ready
          {blocked > 0 && (
            <>
              {" · "}
              <span className="font-medium text-danger">{blocked}</span> need
              attention
            </>
          )}
        </p>
        {blocked > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyProblems}
              onChange={(e) => setOnlyProblems(e.target.checked)}
              className="size-4 rounded border-input"
            />
            Show only rows needing attention
          </label>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Row
              </th>
              {columns.map((column) => (
                <th
                  key={column.field}
                  className="px-2 py-2 text-left text-xs font-semibold tracking-wider text-muted-foreground uppercase"
                >
                  {column.header}
                  {column.required && <span className="ml-0.5 text-destructive">*</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <Row
                key={row.row}
                row={row}
                columns={columns}
                collectors={collectors}
                onEdit={onEdit}
                onEditCollector={onEditCollector}
              />
            ))}
          </tbody>
        </table>
        {hidden > 0 && (
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            {hidden} more {hidden === 1 ? "row is" : "rows are"} not shown. They will
            still be registered.
          </p>
        )}
      </div>

      <div className="sticky bottom-0 z-20 mt-3 flex flex-wrap items-center justify-between gap-4 border-t border-border bg-background py-4">
        <p className="text-sm text-muted-foreground">
          {ready.length === 0
            ? "Nothing can be registered until the flagged cells are fixed."
            : blocked === 0
              ? `All ${ready.length} ${ready.length === 1 ? "row" : "rows"} are ready.`
              : `${ready.length} of ${rows.length} rows will be registered. The rest stay here.`}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onStartOver} disabled={busy}>
            Start over
          </Button>
          <Button onClick={onImport} disabled={busy || ready.length === 0}>
            {busy && <Loader2Icon className="animate-spin" />}
            Register {ready.length} {ready.length === 1 ? "customer" : "customers"}
          </Button>
        </div>
      </div>
    </>
  );
}

function Row({
  row,
  columns,
  collectors,
  onEdit,
  onEditCollector,
}: {
  row: ImportRow;
  columns: ImportColumn[];
  collectors: Collector[];
  onEdit: (row: number, field: ImportField, value: string) => void;
  onEditCollector: (row: number, collectorId: string) => void;
}) {
  const ok = isReady(row);
  const wholeRow = rowLevelIssues(row);

  return (
    <>
      <tr className={cn("border-b border-border/60", !ok && "bg-destructive/[0.03]")}>
        <td className="sticky left-0 z-10 bg-card px-3 py-1.5 align-top">
          <span
            className={cn(
              "tabular text-xs",
              ok ? "text-muted-foreground" : "font-medium text-danger",
            )}
          >
            {row.row}
          </span>
        </td>
        {columns.map((column) => (
          <td key={column.field} className="px-2 py-1.5 align-top">
            <Cell
              row={row}
              column={column}
              collectors={collectors}
              onEdit={onEdit}
              onEditCollector={onEditCollector}
            />
          </td>
        ))}
      </tr>
      {wholeRow.length > 0 && (
        <tr className="border-b border-border/60 bg-destructive/[0.03]">
          <td />
          <td colSpan={columns.length} className="px-2 pb-2">
            <p className="text-xs text-destructive">{wholeRow.join(" · ")}</p>
          </td>
        </tr>
      )}
    </>
  );
}

function Cell({
  row,
  column,
  collectors,
  onEdit,
  onEditCollector,
}: {
  row: ImportRow;
  column: ImportColumn;
  collectors: Collector[];
  onEdit: (row: number, field: ImportField, value: string) => void;
  onEditCollector: (row: number, collectorId: string) => void;
}) {
  const issue = issueFor(row, column.field);
  const value = row.values[column.field];

  const shell = cn(
    "h-8 rounded-md border bg-background px-2 text-sm outline-none",
    "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
    column.width,
    issue ? "border-destructive/60" : "border-input",
  );

  const options = optionsFor(column.input);

  return (
    <div className="space-y-1">
      {column.input === "collector" ? (
        <select
          value={row.assignedCollectorId}
          onChange={(e) => onEditCollector(row.row, e.target.value)}
          className={shell}
          aria-label={`${column.header}, row ${row.row}`}
        >
          <option value="">
            {value.trim() ? `${value} — not found` : "Choose a collector"}
          </option>
          {collectors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      ) : options ? (
        <select
          value={options.some((o) => o.value === value) ? value : ""}
          onChange={(e) => onEdit(row.row, column.field, e.target.value)}
          className={shell}
          aria-label={`${column.header}, row ${row.row}`}
        >
          {/* What the sheet actually said stays visible, even when it is not
              one of the options — otherwise a rejected cell reads as empty. */}
          <option value="">{value.trim() || "—"}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={value}
          type="text"
          // Not a native date input: it renders in the browser's locale, and
          // 04/12/1990 means April here and December in Accra. An ISO date
          // cannot be read two ways.
          placeholder={column.input === "date" ? "1990-04-12" : undefined}
          inputMode={column.input === "phone" ? "numeric" : undefined}
          onChange={(e) => onEdit(row.row, column.field, e.target.value)}
          onBlur={
            column.input === "phone"
              ? (e) => {
                  const tidy = normalizePhone(e.target.value);
                  if (tidy !== e.target.value) onEdit(row.row, column.field, tidy);
                }
              : undefined
          }
          className={shell}
          aria-label={`${column.header}, row ${row.row}`}
          aria-invalid={issue ? true : undefined}
        />
      )}
      {issue && <p className="max-w-56 text-xs text-destructive">{issue}</p>}
    </div>
  );
}

