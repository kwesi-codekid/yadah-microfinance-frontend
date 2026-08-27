import { LayersIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { data, Link, useSubmit } from "react-router";

import { throwAsRouteError } from "~/api/client";
import { getSummary } from "~/api/susu";
import { BackLink, Page } from "~/components/page";
import { Button } from "~/components/ui/button";
import { DateField } from "~/components/ui/date-field";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { isOffice } from "~/lib/auth";
import { accraDay, formatAccraDate, formatAmount, formatCount } from "~/lib/format";
import { requireUser, withAuth } from "~/lib/session.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/susu-summary";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Day summary · Yadah Dynamic Enterprise" }];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What was collected on one Accra day, for cashing up at the end of it.
 *
 * A collector sees their own round and nothing else — the API decides that, not
 * this page. The office sees everyone's unless they name a collector.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const param = url.searchParams.get("date") ?? "";
  const date = DAY_RE.test(param) ? param : accraDay();
  const collectorId = url.searchParams.get("collectorId")?.trim() || undefined;

  const { data: summary, headers } = await withAuth(request, async (token) => {
    try {
      return await getSummary(token, { date, collectorId });
    } catch (error) {
      throwAsRouteError(error);
    }
  });

  return data(
    { summary, date, isOwnRound: !isOffice(user) },
    { headers },
  );
}

export default function SusuSummary({ loaderData }: Route.ComponentProps) {
  const { summary, date, isOwnRound } = loaderData;
  const rows = summary.deposits;

  return (
    <Page className="max-w-none">
      <BackLink to="/susu" className="mb-4">
        All susu accounts
      </BackLink>

      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold tracking-tight">
            Day summary
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatAccraDate(`${date}T12:00:00Z`)}
            {isOwnRound && " · your round"}
          </p>
        </div>
        <DayPicker date={date} />
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Tile label="Deposits" value={formatCount(summary.depositCount)} />
        <Tile
          label="Collected · GH₵"
          value={formatAmount(summary.totalCollected)}
          tone="cash-in"
        />
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <LayersIcon className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nothing was collected on this day.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <Th>Customer</Th>
                <Th className="hidden sm:table-cell">Days</Th>
                <Th className="hidden md:table-cell">Time</Th>
                <Th className="text-right">Amount · GH₵</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.depositId} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      to={`/susu/${row.accountId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.customerName}
                    </Link>
                  </td>
                  <td className="tabular hidden px-4 py-3 text-muted-foreground sm:table-cell">
                    {row.daysCovered}
                  </td>
                  <td className="tabular hidden px-4 py-3 text-muted-foreground md:table-cell">
                    {timeInAccra(row.at)}
                  </td>
                  <td className="tabular px-4 py-3 text-right font-medium">
                    {formatAmount(row.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/40">
                <td className="px-4 py-3 font-medium" colSpan={3}>
                  Total
                </td>
                <td className="tabular px-4 py-3 text-right font-bold">
                  {formatAmount(summary.totalCollected)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>
    </Page>
  );
}

/** The clock time the cash came in, in Accra — the branch's own clock. */
function timeInAccra(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Accra",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function DayPicker({ date }: { date: string }) {
  const submit = useSubmit();
  const [open, setOpen] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <Link to={`/susu/summary?date=${accraDay()}`}>Today</Link>
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            {formatAccraDate(`${date}T12:00:00Z`)}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-3">
          <div ref={fieldRef} key={date} className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Collection day
            </Label>
            <DateField name="date" defaultValue={date} endMonth={new Date()} />
          </div>
          <Button
            type="button"
            size="sm"
            className="w-full"
            onClick={() => {
              const value =
                fieldRef.current?.querySelector<HTMLInputElement>("input[name='date']")
                  ?.value ?? "";
              setOpen(false);
              submit(value ? { date: value } : {}, {
                replace: true,
                preventScrollReset: true,
              });
            }}
          >
            Show this day
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "cash-in";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        tone === "cash-in" ? "border-cash-in/25 bg-cash-in-subtle" : "border-border bg-card",
      )}
    >
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={cn(
          "font-heading mt-1 text-xl font-bold tabular",
          tone === "cash-in" && "text-cash-in",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Th({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2.5 text-left text-xs font-medium tracking-wider text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </th>
  );
}
