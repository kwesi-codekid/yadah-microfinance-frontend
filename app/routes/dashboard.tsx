import { data, Link, useNavigation, useSearchParams } from "react-router";
import { HandCoins } from "lucide-react";
import type { Route } from "./+types/dashboard";
import { DataTable, Table } from "~/components/data-table";
import { FIELD, FilterSelect } from "~/components/form-fields";
import { formatGhs } from "~/lib/money";
import { accraToday, formatDate, formatTime } from "~/lib/format";
import * as susuApi from "~/lib/api/susu";
import * as usersApi from "~/lib/api/users";
import { ROLE_LABELS } from "~/lib/auth-client";
import { isOffice, requireUser, withAuth } from "~/lib/session.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Dashboard · YADAH Dynamic Enterprise" }];
}

/**
 * The day's collections — what a collector is holding, and what the office
 * counts it against. This used to print the session user back at them; the
 * reconciliation summary is what anyone actually opens the app for.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const office = isOffice(user);

  const sp = new URL(request.url).searchParams;
  const date = sp.get("date")?.trim() || undefined;
  // Collectors always see their own figures — the API ignores the parameter for
  // them, so there is no point sending it.
  const collectorId = office
    ? sp.get("collector")?.trim() || undefined
    : undefined;

  const { data: result, headers } = await withAuth(request, async (token) => {
    const [summary, collectors] = await Promise.all([
      susuApi.getSusuSummary(token, { date, collectorId }),
      office
        ? usersApi.listUsers(token, {
            role: "collector",
            status: "active",
            limit: 100,
          })
        : null,
    ]);
    return { summary, collectors: collectors?.items ?? [] };
  });

  return data(
    {
      user,
      summary: result.summary,
      collectors: result.collectors,
      canManage: office,
      // Computed on the server so the date field can't offer tomorrow, and so
      // "today" is one value rather than one per rendering environment.
      today: accraToday(),
      filters: {
        date: date ?? result.summary.date,
        collector: collectorId ?? "",
      },
    },
    { headers },
  );
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { user, summary, collectors, canManage, today, filters } = loaderData;
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();

  const collectorNames = new Map(collectors.map((c) => [c.id, c.name]));
  const isToday = summary.date === today;

  function setParam(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { preventScrollReset: true });
  }

  return (
    <div className="mx-auto w-full px-6 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            Welcome back, {user.name.split(" ")[0]}.
          </h1>
          <p className="mt-1 text-sm text-muted">
            {canManage
              ? `Collections for ${isToday ? "today" : formatDate(summary.date)}.`
              : `What you have collected ${isToday ? "today" : `on ${formatDate(summary.date)}`}.`}{" "}
            Signed in as {ROLE_LABELS[user.role]}.
          </p>
        </div>
      </div>

      {/* The two numbers a day is reconciled on: what was taken, and how many
          times. Everything below is the detail behind them. */}
      <div className="mb-6 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border-2 border-border bg-border sm:grid-cols-2">
        <Stat label="Collected" value={formatGhs(summary.totalCollected)} />
        <Stat label="Deposits" value={String(summary.depositCount)} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="date"
          name="date"
          aria-label="Collections for this day"
          value={filters.date}
          max={today}
          onChange={(e) => setParam({ date: e.target.value || null })}
          className={`${FIELD} border-2 border-border bg-field px-3 py-1 text-foreground outline-none`}
        />

        {/* Collectors get their own figures whatever they ask for, so the filter
            is only shown to the roles it does something for. */}
        {canManage && (
          <FilterSelect
            name="collector"
            label="Filter by collector"
            value={filters.collector}
            onChange={(value) => setParam({ collector: value })}
            options={[
              { value: "", label: "Everyone" },
              ...collectors.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        )}
      </div>

      <DataTable
        columns={
          canManage
            ? ["Time", "Customer", "Days", "Amount", "Collector"]
            : ["Time", "Customer", "Days", "Amount"]
        }
        ariaLabel="Deposits collected"
        isLoading={navigation.state === "loading"}
        emptyContent={{
          icon: <HandCoins size={20} />,
          title: "Nothing collected yet",
          subtext: isToday
            ? "Deposits recorded today will appear here."
            : `No deposits were recorded on ${formatDate(summary.date)}.`,
        }}
      >
        {summary.deposits.map((line) => (
          <Table.Row key={line.depositId} id={line.depositId}>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {formatTime(line.at)}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 font-medium text-foreground">
              <Link
                to={`/susu/${line.accountId}`}
                className="hover:text-success hover:underline"
              >
                {line.customerName}
              </Link>
            </Table.Cell>
            <Table.Cell className="px-4 py-2 tabular-nums text-muted">
              {line.daysCovered}
            </Table.Cell>
            <Table.Cell className="px-4 py-2 font-medium tabular-nums text-foreground">
              {formatGhs(line.amount)}
            </Table.Cell>
            {canManage && (
              <Table.Cell className="px-4 py-2 text-muted">
                {/* A deposit recorded by an admin or manager won't be in the
                    collector list — that isn't an unknown user, it's the office. */}
                {collectorNames.get(line.collectorId) ?? "Office"}
              </Table.Cell>
            )}
          </Table.Row>
        ))}
      </DataTable>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="mt-1 font-heading text-3xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}
