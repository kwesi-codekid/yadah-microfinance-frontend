import { ApiError, apiFetch } from "~/api/client";
import { queryOf } from "~/api/query";
import type {
  CashSeries,
  CollectionEfficiency,
  DashboardAlerts,
  DashboardSummary,
  RecentTransactions,
  SeriesBucket,
} from "~/lib/reports";

/**
 * The `/dashboard` endpoints — five reads that exist only to draw the office
 * dashboard. This module imports the API client, so it is server-only; the
 * types live in the client-safe `~/lib/reports`.
 *
 * `/dashboard/summary` replaces `GET /reports/dashboard`, which the API keeps
 * as a deprecated alias. Everything else here is new: the charts used to be
 * assembled by hand from `/reports/collections` and `/reports/transactions`,
 * and now come pre-bucketed from one series so the three of them can never
 * disagree about a period.
 */

export interface SeriesParams {
  /** Inclusive Accra days. Omitted, the API picks a span for the bucket. */
  from?: string;
  to?: string;
  bucket?: SeriesBucket;
}

export interface RangeParams {
  from?: string;
  to?: string;
}

/**
 * GET /dashboard/summary — the headline tiles, today's cash, month-to-date
 * revenue and what the branch is currently holding.
 *
 * This endpoint is the source of truth and is computed fresh on every call.
 * Socket.io money events to the admin room say *when* to read it again;
 * nothing is ever rendered off a socket payload.
 */
export function getDashboardSummary(
  accessToken: string,
): Promise<DashboardSummary> {
  return apiFetch("/dashboard/summary", { accessToken });
}

/**
 * GET /dashboard/series — cash in and out, and collector handovers, bucketed
 * by day, week or month.
 *
 * Every bucket in the range comes back, empty ones included, so a chart can
 * plot the points as given without inventing a slope across a gap.
 */
export function getCashSeries(
  accessToken: string,
  params: SeriesParams = {},
): Promise<CashSeries> {
  return apiFetch(`/dashboard/series${queryOf({ ...params })}`, { accessToken });
}

/**
 * GET /dashboard/efficiency — how much of the recorded field cash reached the
 * office, over a range that defaults to the last 30 days.
 *
 * Susu and savings only: loans and hire purchase are collected at the counter
 * and never pass through a collector's bag.
 */
export function getCollectionEfficiency(
  accessToken: string,
  params: RangeParams = {},
): Promise<CollectionEfficiency> {
  return apiFetch(`/dashboard/efficiency${queryOf({ ...params })}`, {
    accessToken,
  });
}

/**
 * GET /dashboard/alerts — standing conditions that need someone to act, sorted
 * critical → warning → info. Alerts with nothing behind them are omitted, so
 * an empty array means nothing needs attention.
 */
export function getDashboardAlerts(
  accessToken: string,
): Promise<DashboardAlerts> {
  return apiFetch("/dashboard/alerts", { accessToken });
}

export interface RecentParams {
  limit?: number;
  /**
   * Unapplied Paystack charges, on by default on the API's side. They carry
   * `status: "pending"` or `"failed"` and are excluded from `totals`.
   */
  includePending?: boolean;
}

/** GET /dashboard/recent-transactions — the last few money events. */
export function getRecentTransactions(
  accessToken: string,
  params: RecentParams = {},
): Promise<RecentTransactions> {
  return apiFetch(`/dashboard/recent-transactions${queryOf({ ...params })}`, {
    accessToken,
  });
}

/* ------------------------------------------------------------- the screen --- */

export interface DashboardPage {
  summary: DashboardSummary;
  /** Null when that one endpoint failed; its card says so and the rest draws. */
  series: CashSeries | null;
  efficiency: CollectionEfficiency | null;
  alerts: DashboardAlerts | null;
  recent: RecentTransactions | null;
}

/**
 * Everything the dashboard reads, in one round trip's worth of wall time.
 *
 * The four supporting reads are allowed to fail on their own. A dashboard is
 * read at a glance, and losing the whole page because the alerts query timed
 * out costs the office five working figures to save one card — so each card
 * that has no data says so, and the others still draw. The summary is not
 * optional: with no tiles and no portfolio there is no dashboard left.
 *
 * A 401 is never swallowed. `withAuth` renews an expired access token by
 * catching exactly that, and a caught 401 here would leave the screen blank
 * instead of refreshed.
 */
export async function getDashboardPage(
  accessToken: string,
  params: SeriesParams & { recentLimit?: number } = {},
): Promise<DashboardPage> {
  const { from, to, bucket, recentLimit = 8 } = params;

  const soft = <T>(promise: Promise<T>): Promise<T | null> =>
    promise.catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) throw error;
      return null;
    });

  const [summary, series, efficiency, alerts, recent] = await Promise.all([
    getDashboardSummary(accessToken),
    soft(getCashSeries(accessToken, { from, to, bucket })),
    soft(getCollectionEfficiency(accessToken, { from, to })),
    soft(getDashboardAlerts(accessToken)),
    soft(getRecentTransactions(accessToken, { limit: recentLimit })),
  ]);

  return { summary, series, efficiency, alerts, recent };
}
