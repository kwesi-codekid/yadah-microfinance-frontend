import { apiFetch } from "~/api/client";
import { queryOf } from "~/api/query";
import { listReconciliations } from "~/api/reconciliation";
import type { CollectorDashboardData } from "~/components/collector-dashboard";
import { accraDay, accraDaysAgo } from "~/lib/format";
import type { CollectorDay, CollectorRound } from "~/lib/collectors";

/**
 * The `/collectors/me` endpoints — the field app's home screen. This module
 * imports the API client, so it is server-only: call it from loaders. Types
 * live in the client-safe `~/lib/collectors`.
 *
 * Collectors are pinned to themselves whatever they pass; office roles
 * **must** name a `collectorId`, and get a 400 without one.
 */

export interface RoundParams {
  /** Accra day, `YYYY-MM-DD`. Defaults to today on the API's side. */
  date?: string;
  collectorId?: string;
}

/**
 * GET /collectors/me/round — who still owes a susu deposit today, how much is
 * due at each stop, and where to find them. Customers with no open susu
 * account are omitted; a deposit recorded by any collector satisfies the day.
 */
export function getRound(
  accessToken: string,
  params: RoundParams = {},
): Promise<CollectorRound> {
  return apiFetch(`/collectors/me/round${queryOf({ ...params })}`, { accessToken });
}

/**
 * GET /collectors/me/day — what has been collected so far, susu and savings
 * together. `cashTotal` counts cash only, which is what reconciliation will
 * expect to be handed over. `reconciliation` is null until the day is declared.
 */
export function getDay(
  accessToken: string,
  params: RoundParams = {},
): Promise<CollectorDay> {
  return apiFetch(`/collectors/me/day${queryOf({ ...params })}`, { accessToken });
}

/* --------------------------------------------------------------- dashboard --- */

/** How far back the collector's dashboard looks. */
export const DASHBOARD_WINDOW_DAYS = 30;

/**
 * Everything the collector's dashboard needs, in one round trip of three
 * calls. The two "today" reads are soft — a failed one blanks its cards
 * rather than the page — while the reconciliation history is the API's own
 * scoping: a collector only ever gets their own days back.
 */
export async function getCollectorDashboardPage(
  accessToken: string,
  collectorId: string,
): Promise<CollectorDashboardData> {
  const today = accraDay();
  const soft = <T,>(p: Promise<T>) => p.catch(() => null);
  const [day, round, history] = await Promise.all([
    soft(getDay(accessToken, { date: today, collectorId })),
    soft(getRound(accessToken, { date: today, collectorId })),
    listReconciliations(accessToken, {
      from: accraDaysAgo(DASHBOARD_WINDOW_DAYS),
      to: today,
      limit: 100,
    }),
  ]);
  return {
    day,
    round,
    history: history.items,
    today,
    windowDays: DASHBOARD_WINDOW_DAYS,
    generatedAt: new Date().toISOString(),
  };
}
