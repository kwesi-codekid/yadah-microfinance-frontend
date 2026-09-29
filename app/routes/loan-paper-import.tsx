import { CheckCircle2Icon, CircleAlertIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Link, useFetcher } from "react-router";
import { toast } from "sonner";

import { ApiError } from "~/api/error";
import { previewPaperImport, runPaperImport } from "~/api/loans";
import { ChooseFile } from "~/components/import-sheet";
import { BackLink, Page } from "~/components/page";
import { Button } from "~/components/ui/button";
import { formatCount, formatPesewas } from "~/lib/format";
import type { PaperImportOutcome, PaperImportPreview } from "~/lib/loans";
import { requireOffice, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/loan-paper-import";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Import paper loans · Yadah Dynamic Enterprise" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOffice(request);
  return null;
}

type ActionResult =
  | { ok: true; step: "preview"; preview: PaperImportPreview }
  | { ok: true; step: "import"; outcome: PaperImportOutcome }
  | { ok: false; error: string };

/**
 * Two steps, and only the second writes: check the sheet, then record the
 * loans that are ready. A loan with a problem is fixed in the spreadsheet and
 * the sheet uploaded again — the paper number stops anything being entered
 * twice.
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
        previewPaperImport(token, file),
      );
      return data<ActionResult>({ ok: true, step: "preview", preview }, { headers });
    }

    if (intent === "import") {
      const rows = JSON.parse(String(form.get("rows") ?? "[]")) as {
        row: number;
        values: Record<string, string>;
      }[];
      if (rows.length === 0) {
        return data<ActionResult>({ ok: false, error: "No loans to record." }, { status: 400 });
      }
      const { data: outcome, headers } = await withAuth(request, (token) =>
        runPaperImport(token, rows),
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

export default function LoanPaperImport() {
  const fetcher = useFetcher<ActionResult>();
  const busy = fetcher.state !== "idle";
  const [preview, setPreview] = useState<PaperImportPreview | null>(null);
  const [outcome, setOutcome] = useState<PaperImportOutcome | null>(null);

  useEffect(() => {
    const result = fetcher.data;
    if (!result) return;
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (result.step === "preview") {
      setPreview(result.preview);
      setOutcome(null);
      return;
    }
    setOutcome(result.outcome);
    const { created, failed } = result.outcome.counts;
    if (created > 0) toast.success(`${formatCount(created)} paper loan${created === 1 ? "" : "s"} recorded.`);
    if (failed > 0) toast.error(`${formatCount(failed)} could not be recorded.`);
  }, [fetcher.data]);

  const ready = preview?.loans.filter((l) => l.issues.length === 0) ?? [];

  function record() {
    if (!preview) return;
    const rowsOf = new Set(ready.flatMap((l) => l.rows));
    const rows = preview.rows
      .filter((r) => rowsOf.has(r.row))
      .map((r) => ({ row: r.row, values: r.values }));
    fetcher.submit({ intent: "import", rows: JSON.stringify(rows) }, { method: "post" });
  }

  function startOver() {
    setPreview(null);
    setOutcome(null);
  }

  return (
    <Page className="max-w-none">
      <BackLink to="/loans" className="mb-4">
        All loans
      </BackLink>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-heading text-2xl font-bold tracking-tight">Import paper loans</h2>
        <Button asChild variant="outline">
          <a href="/loans/paper-import/template?format=xlsx">
            <DownloadIcon /> Download the template
          </a>
        </Button>
      </div>

      {outcome ? (
        <Outcome outcome={outcome} onStartOver={startOver} />
      ) : preview === null ? (
        <ChooseFile
          fetcher={fetcher}
          busy={busy}
          requirements={
            <>
              <p>One row per payment. Rows with the same paper no are one loan.</p>
              <p>
                The first row of a loan carries the customer's phone, amount, months, rate owed
                now and date given.
              </p>
              <p>Customers must be registered first — they are found by phone.</p>
            </>
          }
        />
      ) : (
        <div className="space-y-4">
          {preview.unknownHeaders.length > 0 && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              Columns not recognised and ignored: {preview.unknownHeaders.join(", ")}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <span className="font-semibold">{formatCount(preview.counts.ready)}</span> of{" "}
              {formatCount(preview.counts.loans)} loans ready
              {preview.counts.blocked > 0 && (
                <span className="text-danger">
                  {" "}
                  · {formatCount(preview.counts.blocked)} need fixing in the sheet
                </span>
              )}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={startOver} disabled={busy}>
                Upload another sheet
              </Button>
              <Button onClick={record} disabled={busy || ready.length === 0}>
                {busy && <Loader2Icon className="animate-spin" />}
                Record {formatCount(ready.length)} loan{ready.length === 1 ? "" : "s"}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl bg-card">
            <table className="w-full min-w-3xl text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-xs font-bold text-foreground [&>th]:px-3 [&>th]:py-3">
                  <th>Paper no</th>
                  <th>Customer</th>
                  <th className="text-right">Borrowed</th>
                  <th className="text-right">Owed</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Payments</th>
                  <th>Status</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {preview.loans.map((loan) => {
                  const ok = loan.issues.length === 0;
                  return (
                    <tr
                      key={loan.paperRef}
                      className="border-b border-border/60 align-top last:border-0 [&>td]:px-3 [&>td]:py-3"
                    >
                      <td className="font-medium whitespace-nowrap">{loan.paperRef}</td>
                      <td>{loan.customerName ?? "—"}</td>
                      <td className="tabular text-right whitespace-nowrap">
                        {loan.principal != null ? formatPesewas(loan.principal) : "—"}
                      </td>
                      <td className="tabular text-right whitespace-nowrap">
                        {loan.totalDue != null ? formatPesewas(loan.totalDue) : "—"}
                      </td>
                      <td className="tabular text-right whitespace-nowrap">
                        {formatPesewas(loan.totalRepaid)}
                      </td>
                      <td className="tabular text-right">{loan.payments}</td>
                      <td className="whitespace-nowrap">
                        {loan.status === "repaid" ? "Repaid" : loan.status === "active" ? "Running" : "—"}
                      </td>
                      <td className={cn(ok ? "text-success" : "text-danger")}>
                        {ok ? (
                          <span className="inline-flex items-center gap-1.5">
                            <CheckCircle2Icon className="size-4" /> Ready
                          </span>
                        ) : (
                          <ul className="space-y-1">
                            {loan.issues.map((issue) => (
                              <li key={issue} className="flex items-start gap-1.5">
                                <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                                {issue}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Page>
  );
}

function Outcome({
  outcome,
  onStartOver,
}: {
  outcome: PaperImportOutcome;
  onStartOver: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <span className="font-semibold">{formatCount(outcome.counts.created)}</span> paper loan
        {outcome.counts.created === 1 ? "" : "s"} recorded
        {outcome.counts.failed > 0 && (
          <span className="text-danger">
            {" "}
            · {formatCount(outcome.counts.failed)} not recorded
          </span>
        )}
      </p>

      {outcome.failed.length > 0 && (
        <ul className="space-y-2 rounded-2xl bg-card p-4 text-sm">
          {outcome.failed.map((f) => (
            <li key={f.paperRef}>
              <span className="font-medium">{f.paperRef}</span>
              <span className="text-danger"> — {f.issues.join("; ")}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onStartOver}>
          Import another sheet
        </Button>
        <Button asChild>
          <Link to="/loans">See the loans</Link>
        </Button>
      </div>
    </div>
  );
}
