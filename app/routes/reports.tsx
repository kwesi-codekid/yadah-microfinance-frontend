import { data, Form, useNavigation, useSearchParams } from "react-router";
import { Download, FileWarning } from "lucide-react";
import type { Route } from "./+types/reports";
import { DataTable, Table } from "~/components/data-table";
import { FIELD } from "~/components/form-fields";
import { Kpi } from "~/components/kpi";
import { TabLink, TabList } from "~/components/tabs";
import { toApiFailure, type ApiFailure } from "~/lib/api/client";
import { getReport } from "~/lib/api/reports";
import { isReportName, REPORTS, type ReportName } from "~/lib/report-client";
import {
  formatCell,
  isNumericColumn,
  labelOf,
  readReport,
  type ReportView,
} from "~/lib/report-shape";
import { requireOffice, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Reports · YADAH Dynamic Enterprise" }];
}

const LIST_ID = "report-body";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readDate(value: string | null): string | undefined {
  return value && ISO_DATE.test(value) ? value : undefined;
}

export async function loader({ request }: Route.LoaderArgs) {
  // Every report reads across the whole book; office roles only.
  await requireOffice(request);

  const sp = new URL(request.url).searchParams;
  const nameParam = sp.get("report");
  const name: ReportName = isReportName(nameParam) ? nameParam : "collections";
  const range = { from: readDate(sp.get("from")), to: readDate(sp.get("to")) };

  const { data: payload, headers } = await withAuth(request, async (token) => {
    try {
      return { report: await getReport(token, name, range), failure: null };
    } catch (error) {
      if (error instanceof Response) throw error;
      // One failing report shouldn't take the page with it — say so in place.
      return { report: null, failure: toApiFailure(error) };
    }
  });

  return data(
    {
      name,
      range: { from: range.from ?? "", to: range.to ?? "" },
      view: payload.report === null ? null : readReport(payload.report),
      failure: payload.failure as ApiFailure | null,
    },
    { headers },
  );
}

export default function Reports({ loaderData }: Route.ComponentProps) {
  const { name, range, view, failure } = loaderData;
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const report = REPORTS[name];

  function reportHref(value: string) {
    const next = new URLSearchParams(searchParams);
    next.set("report", value);
    // The range belongs to the report that took one; don't carry it across.
    if (!REPORTS[value as ReportName].ranged) {
      next.delete("from");
      next.delete("to");
    }
    return `/reports?${next.toString()}`;
  }

  const download = new URLSearchParams({ report: name });
  if (report.ranged) {
    if (range.from) download.set("from", range.from);
    if (range.to) download.set("to", range.to);
  }

  return (
    <div className="mx-auto w-full px-6 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Reports
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{report.blurb}</p>
        </div>

        {/* A real link, not a fetch: the browser saves the file itself. */}
        <a
          href={`/reports/download?${download.toString()}`}
          className="flex min-h-9 items-center gap-1.5 rounded-md border-2 border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-secondary"
        >
          <Download size={14} />
          Download CSV
        </a>
      </div>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <TabList label="Report" className="max-w-full overflow-x-auto">
          {Object.entries(REPORTS).map(([value, meta]) => (
            <TabLink
              key={value}
              to={reportHref(value)}
              selected={value === name}
              controls={LIST_ID}
            >
              {meta.label}
            </TabLink>
          ))}
        </TabList>

        {report.ranged && (
          // A GET form, so the range is in the URL and the page is shareable.
          <Form method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="report" value={name} />
            <DateField name="from" label="From" defaultValue={range.from} />
            <DateField name="to" label="To" defaultValue={range.to} />
            <button
              type="submit"
              className="min-h-9 rounded-md border-2 border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-secondary"
            >
              Apply
            </button>
          </Form>
        )}
      </div>

      {failure && (
        <p className="mb-4 flex gap-2 rounded-lg border-2 border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
          <FileWarning size={16} className="mt-0.5 shrink-0" />
          <span>
            This report couldn't be read
            {failure.status ? ` (${failure.status})` : ""}: {failure.message}
          </span>
        </p>
      )}

      {view && <ReportBody view={view} loading={navigation.state === "loading"} />}
    </div>
  );
}

function ReportBody({ view, loading }: { view: ReportView; loading: boolean }) {
  return (
    <div id={LIST_ID} className="space-y-6">
      {view.figures.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {view.figures.map((figure) => (
            <Kpi
              key={figure.key}
              label={labelOf(figure.key)}
              value={formatCell(figure.key, figure.value)}
            />
          ))}
        </div>
      )}

      <RowTable
        columns={view.columns}
        rows={view.rows}
        loading={loading}
        label="Report"
      />

      {view.sections.map((section) => (
        <section key={section.key}>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
            {labelOf(section.key)}
          </h2>
          <RowTable
            columns={section.columns}
            rows={section.rows}
            loading={false}
            label={labelOf(section.key)}
          />
        </section>
      ))}
    </div>
  );
}

function RowTable({
  columns,
  rows,
  loading,
  label,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
  loading: boolean;
  label: string;
}) {
  // Column names come from the payload, so an empty report has none at all.
  const headers = columns.length ? columns.map(labelOf) : ["Result"];

  return (
    <DataTable
      columns={headers}
      ariaLabel={label}
      isLoading={loading}
      heightClass="max-h-none"
      emptyContent={{
        title: "Nothing to report",
        subtext: "No rows came back for this range.",
      }}
    >
      {rows.map((row, index) => (
        <Table.Row key={index} id={String(index)}>
          {columns.map((column) => (
            <Table.Cell
              key={column}
              className={`px-4 py-2 text-muted ${
                isNumericColumn(column, rows) ? "tabular-nums" : ""
              }`}
            >
              {formatCell(column, row[column])}
            </Table.Cell>
          ))}
        </Table.Row>
      ))}
    </DataTable>
  );
}

function DateField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <input
        type="date"
        name={name}
        defaultValue={defaultValue}
        className={`${FIELD} min-h-9 px-2 text-sm text-foreground`}
      />
    </label>
  );
}
