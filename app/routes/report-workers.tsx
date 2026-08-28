import { ActivityIcon, CircleAlertIcon, CircleCheckIcon, CircleDashedIcon } from "lucide-react";
import { data } from "react-router";

import { getWorkers } from "~/api/reports";
import { ListingCard, StatusPill, type Tone } from "~/components/listing";
import { BackLink, Page } from "~/components/page";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { formatAccraDateTime, formatCount } from "~/lib/format";
import { requireAdmin, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/report-workers";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Background workers · Yadah Dynamic Enterprise" }];
}

export const handle = {
  title: "Background workers",
  description: "Whether the jobs that run on their own — SMS, escalation, arrears, recovery — are alive.",
};

/** The API's worker keys, in the words the office would use for them. */
const WORKER_LABELS: Record<string, { label: string; blurb: string }> = {
  sms: { label: "SMS", blurb: "Sends the receipts and reminders customers get on their phones." },
  "loan-escalation": {
    label: "Loan escalation",
    blurb: "Climbs the rate ladder on loans that fall behind.",
  },
  "hp-arrears": {
    label: "Hire purchase arrears",
    blurb: "Flags agreements whose instalment is late.",
  },
  "debt-recovery": {
    label: "Debt recovery",
    blurb: "Forfeits repossessions whose redemption window has lapsed.",
  },
};

/**
 * `GET /reports/workers` — heartbeats. Admin only.
 *
 * The API keeps these in memory, so a fresh deploy shows every worker as
 * just started with no history; each runs a pass immediately on boot.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const { data: report, headers } = await withAuth(request, (token) => getWorkers(token));

  const workers = Object.entries(report.workers ?? {}).map(([key, w]) => {
    const meta = WORKER_LABELS[key] ?? { label: key, blurb: "" };
    const state: "ok" | "failed" | "idle" =
      w.lastOk === true ? "ok" : w.lastOk === false ? "failed" : "idle";
    return {
      key,
      label: meta.label,
      blurb: meta.blurb,
      state,
      startedAt: w.startedAt,
      lastRunAt: w.lastRunAt,
      lastError: w.lastError,
      runs: w.runs ?? null,
      changes: Object.entries(w.lastChanges ?? {}).map(([k, v]) => ({ key: k, count: v })),
    };
  });

  return data({ workers }, { headers });
}

const STATE: Record<"ok" | "failed" | "idle", { label: string; tone: Tone }> = {
  ok: { label: "Healthy", tone: "success" },
  failed: { label: "Last run failed", tone: "danger" },
  idle: { label: "Not run yet", tone: "muted" },
};

export default function ReportWorkers({ loaderData }: Route.ComponentProps) {
  const { workers } = loaderData;
  const failing = workers.filter((w) => w.state === "failed").length;

  return (
    <Page>
      <BackLink to="/reports" className="mb-4">
        All reports
      </BackLink>

      {workers.length === 0 ? (
        <ListingCard>
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ActivityIcon className="size-6" />
              </EmptyMedia>
              <EmptyTitle>No workers reported</EmptyTitle>
              <EmptyDescription>
                The API has not started any background job yet.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </ListingCard>
      ) : (
        <div className="space-y-4">
          <p
            className={
              failing > 0
                ? "rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                : "rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
            }
          >
            {failing > 0
              ? `${formatCount(failing)} worker${failing === 1 ? "" : "s"} failed on the last run. The error is printed under each.`
              : "Every worker succeeded on its last run. Counters reset whenever the API restarts."}
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            {workers.map((w) => {
              const s = STATE[w.state];
              const Icon =
                w.state === "ok" ? CircleCheckIcon : w.state === "failed" ? CircleAlertIcon : CircleDashedIcon;
              return (
                <section
                  key={w.key}
                  className="rounded-xl border border-border bg-card p-4 text-card-foreground"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-heading text-base font-bold tracking-tight">{w.label}</h3>
                      {w.blurb ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">{w.blurb}</p>
                      ) : null}
                    </div>
                    <StatusPill label={s.label} tone={s.tone} className="shrink-0" />
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">Last run</dt>
                    <dd className="tabular">{w.lastRunAt ? formatAccraDateTime(w.lastRunAt) : "—"}</dd>
                    <dt className="text-muted-foreground">Running since</dt>
                    <dd className="tabular">{w.startedAt ? formatAccraDateTime(w.startedAt) : "—"}</dd>
                    {w.runs != null && (
                      <>
                        <dt className="text-muted-foreground">Runs</dt>
                        <dd className="tabular">{formatCount(w.runs)}</dd>
                      </>
                    )}
                  </dl>

                  {w.changes.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {w.changes.map((c) => (
                        <li
                          key={c.key}
                          className="tabular rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {c.key}: <span className="font-semibold text-foreground">{formatCount(c.count)}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {w.lastError && (
                    <p className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      <Icon className="mt-0.5 size-3.5 shrink-0" />
                      <span className="break-words">{w.lastError}</span>
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </Page>
  );
}
