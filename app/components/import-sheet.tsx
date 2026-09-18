import {
  CheckCircle2Icon,
  Loader2Icon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, type useFetcher } from "react-router";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/**
 * Importing a spreadsheet, for any book that takes one: choose the file, see
 * every row with what is wrong with it, fix the cells in place, send the good
 * rows, and keep the rest on screen with their reasons.
 *
 * What differs between books is the columns and the checks. The columns come
 * in as props; the checks stay in each page's own lib and are run through
 * `onEdit`, which the page implements. Everything else — the chooser, the
 * table, the row numbering, the flagged cells, the footer with its count —
 * is the same job every time and is drawn here once.
 */

export interface SheetIssue<F extends string> {
  /** The column to flag, or null when the fault is the row as a whole. */
  field: F | null;
  message: string;
  /** Only the API can re-answer this one; a client edit clears it. */
  fromServer?: boolean;
}

export interface SheetRow<F extends string> {
  /** The line in the original sheet, so a message can name it. */
  row: number;
  values: Record<F, string>;
  issues: SheetIssue<F>[];
}

/** How the preview edits one cell. */
export type CellKind =
  | "text"
  | "phone"
  | "date"
  | "number"
  | "money"
  | "select"
  /** Drawn by the page — see `renderCell`. */
  | "custom";

export interface SheetColumnSpec<F extends string> {
  field: F;
  header: string;
  required?: boolean;
  input: CellKind;
  /** For `select`: the values a cell may take. */
  options?: readonly { value: string; label: string }[];
  /** Cells are as wide as their content needs, no wider. */
  width: string;
}

export function isReady(row: { issues: unknown[] }): boolean {
  return row.issues.length === 0;
}

export function issueFor<F extends string>(row: SheetRow<F>, field: F): string | undefined {
  return row.issues.find((i) => i.field === field)?.message;
}

/** Issues that belong to no single column, so the row shows them on its own line. */
export function rowLevelIssues<F extends string>(row: SheetRow<F>): string[] {
  return row.issues.filter((i) => i.field === null).map((i) => i.message);
}

/**
 * Which columns the table shows: the ones the sheet actually carried, plus
 * the required ones. A four-column sheet should not be reviewed through
 * sixteen mostly-empty columns.
 */
export function visibleColumns<F extends string, C extends SheetColumnSpec<F>>(
  columns: readonly C[],
  rows: SheetRow<F>[],
): C[] {
  return columns.filter(
    (column) => column.required || rows.some((r) => r.values[column.field].trim() !== ""),
  );
}

/** The one canonical form of a Ghanaian number, as the API stores it. */
export function normalizePhone(raw: string): string {
  const compact = raw.replace(/[\s().-]/g, "");
  const local = compact.replace(/^(?:\+233|233)/, "");
  return local.startsWith("0") ? local : local ? `0${local}` : "";
}

/* ------------------------------------------------------------- the results --- */

export interface ImportOutcomeLike {
  created: { row: number }[];
  failed: { row: number; issues: { field: string | null; message: string }[] }[];
  counts: { total: number; created: number; failed: number };
}

export type ImportActionResult<P, O extends ImportOutcomeLike> =
  | { ok: true; step: "preview"; preview: P }
  | { ok: true; step: "import"; outcome: O }
  | { ok: false; error: string };

/**
 * The rows on screen, and what an answer from the API does to them.
 *
 * A preview replaces the sheet. An import takes only what went in off it: a
 * row that failed stays with the reason it failed, and one that was never
 * sent — because it was still flagged — stays exactly as it was.
 */
export function useImportRows<F extends string, R extends SheetRow<F>, P, O extends ImportOutcomeLike>({
  result,
  seed,
  check,
  noun,
}: {
  result: ImportActionResult<P, O> | undefined;
  /** The preview's rows as this page keeps them, server issues marked as such. */
  seed: (preview: P) => R[];
  /** Re-run the page's own checks over the sheet, keeping server issues that still apply. */
  check: (rows: R[]) => R[];
  noun: { one: string; many: string };
}) {
  const [rows, setRows] = useState<R[] | null>(null);
  const [preview, setPreview] = useState<P | null>(null);
  const [registered, setRegistered] = useState(0);

  useEffect(() => {
    if (!result) return;
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (result.step === "preview") {
      setPreview(result.preview);
      setRegistered(0);
      setRows(check(seed(result.preview)));
      return;
    }
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
                  field: i.field as F | null,
                  message: i.message,
                  fromServer: true,
                })),
              }
            : r,
        );
      return check(left);
    });
    if (outcome.counts.created > 0) {
      toast.success(
        `${outcome.counts.created} ${outcome.counts.created === 1 ? noun.one : noun.many} added.`,
      );
    }
    if (outcome.counts.failed > 0) {
      toast.error(
        `${outcome.counts.failed} ${outcome.counts.failed === 1 ? "row" : "rows"} could not be added.`,
      );
    }
    // `seed` and `check` are stable per page; re-running on them would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  return {
    rows,
    setRows,
    preview,
    registered,
    reset: () => {
      setRows(null);
      setPreview(null);
      setRegistered(0);
    },
  };
}

/* ----------------------------------------------------------- choosing a file --- */

export function ChooseFile({
  fetcher,
  busy,
  requirements,
}: {
  fetcher: ReturnType<typeof useFetcher>;
  busy: boolean;
  /** The two or three lines that say what the sheet needs. */
  requirements: ReactNode;
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
            <span className="text-sm font-medium">Choose a spreadsheet</span>
            <span className="text-xs text-muted-foreground">
              .xlsx or .csv · up to 5 MB · 1,000 rows
            </span>
          </>
        )}
      </button>

      <div className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        {requirements}
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

/** Beyond this many rows on screen the table stops being reviewable anyway. */
const RENDER_CAP = 200;

export function ImportSheet<F extends string, R extends SheetRow<F>>({
  rows,
  columns,
  unknownHeaders,
  registered,
  noun,
  busy,
  onEdit,
  renderCell,
  onStartOver,
  onImport,
  doneTo,
}: {
  rows: R[];
  columns: readonly SheetColumnSpec<F>[];
  unknownHeaders: string[];
  registered: number;
  noun: { one: string; many: string };
  busy: boolean;
  onEdit: (row: number, field: F, value: string) => void;
  /** A cell the page draws itself — a picker over its own options. */
  renderCell?: (row: R, column: SheetColumnSpec<F>, shell: string) => ReactNode | undefined;
  onStartOver: () => void;
  onImport: (ready: R[]) => void;
  /** Where "see them" goes once every row is in. */
  doneTo: { to: string; label: string };
}) {
  const [onlyProblems, setOnlyProblems] = useState(false);

  const shown = visibleColumns(columns, rows);
  const ready = rows.filter(isReady);
  const blocked = rows.length - ready.length;
  const listed = (onlyProblems ? rows.filter((r) => !isReady(r)) : rows).slice(0, RENDER_CAP);
  const hidden = (onlyProblems ? blocked : rows.length) - listed.length;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <CheckCircle2Icon className="mx-auto size-8 text-success" />
        <p className="mt-3 font-medium">
          {registered} {registered === 1 ? noun.one : noun.many} added.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="outline" onClick={onStartOver}>
            Import another sheet
          </Button>
          <Button asChild>
            <Link to={doneTo.to}>{doneTo.label}</Link>
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
            Skipped {unknownHeaders.length === 1 ? "a column" : "columns"} with no matching heading:{" "}
            <span className="font-medium">{unknownHeaders.join(", ")}</span>.
          </span>
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {registered > 0 && (
            <span className="font-medium text-success">{registered} added. </span>
          )}
          <span className="font-medium text-foreground">{rows.length}</span>{" "}
          {rows.length === 1 ? "row" : "rows"} ·{" "}
          <span className="font-medium text-foreground">{ready.length}</span> ready
          {blocked > 0 && (
            <>
              {" · "}
              <span className="font-medium text-danger">{blocked}</span> to fix
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
            Only rows to fix
          </label>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                Row
              </th>
              {shown.map((column) => (
                <th
                  key={column.field}
                  className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground"
                >
                  {column.header}
                  {column.required && <span className="ml-0.5 text-destructive">*</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {listed.map((row) => (
              <Row
                key={row.row}
                row={row}
                columns={shown}
                onEdit={onEdit}
                renderCell={renderCell}
              />
            ))}
          </tbody>
        </table>
        {hidden > 0 && (
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            {hidden} more {hidden === 1 ? "row" : "rows"} not shown; they still go in.
          </p>
        )}
      </div>

      <div className="sticky bottom-0 z-20 mt-3 flex flex-wrap items-center justify-between gap-4 border-t border-border bg-background py-4">
        <p className="text-sm text-muted-foreground">
          {ready.length === 0
            ? "Fix the flagged cells first."
            : blocked === 0
              ? "Every row is ready."
              : `${ready.length} of ${rows.length} rows go in. The rest stay here.`}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onStartOver} disabled={busy}>
            Start over
          </Button>
          <Button onClick={() => onImport(ready)} disabled={busy || ready.length === 0}>
            {busy && <Loader2Icon className="animate-spin" />}
            Add {ready.length} {ready.length === 1 ? noun.one : noun.many}
          </Button>
        </div>
      </div>
    </>
  );
}

function Row<F extends string, R extends SheetRow<F>>({
  row,
  columns,
  onEdit,
  renderCell,
}: {
  row: R;
  columns: readonly SheetColumnSpec<F>[];
  onEdit: (row: number, field: F, value: string) => void;
  renderCell?: (row: R, column: SheetColumnSpec<F>, shell: string) => ReactNode | undefined;
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
            <Cell row={row} column={column} onEdit={onEdit} renderCell={renderCell} />
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

function Cell<F extends string, R extends SheetRow<F>>({
  row,
  column,
  onEdit,
  renderCell,
}: {
  row: R;
  column: SheetColumnSpec<F>;
  onEdit: (row: number, field: F, value: string) => void;
  renderCell?: (row: R, column: SheetColumnSpec<F>, shell: string) => ReactNode | undefined;
}) {
  const issue = issueFor(row, column.field);
  const value = row.values[column.field];

  const shell = cn(
    "h-8 rounded-md border bg-background px-2 text-sm outline-none",
    "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
    column.width,
    issue ? "border-destructive/60" : "border-input",
  );

  const custom = renderCell?.(row, column, shell);
  const options = column.input === "select" ? column.options : undefined;

  return (
    <div className="space-y-1">
      {custom !== undefined ? (
        custom
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
          inputMode={
            column.input === "phone" || column.input === "number"
              ? "numeric"
              : column.input === "money"
                ? "decimal"
                : undefined
          }
          onChange={(e) => onEdit(row.row, column.field, e.target.value)}
          onBlur={
            column.input === "phone"
              ? (e) => {
                  const tidy = normalizePhone(e.target.value);
                  if (tidy !== e.target.value) onEdit(row.row, column.field, tidy);
                }
              : undefined
          }
          className={cn(shell, (column.input === "number" || column.input === "money") && "tabular text-right")}
          aria-label={`${column.header}, row ${row.row}`}
          aria-invalid={issue ? true : undefined}
        />
      )}
      {issue && <p className="max-w-56 text-xs text-destructive">{issue}</p>}
    </div>
  );
}
