import { NO_COLLECTOR } from "~/lib/customer-form";

/**
 * The office entering what a collector brought back. Client-safe: the roster
 * itself comes from `GET /collectors` in `~/api/collectors`.
 */

export interface RosterCollector {
  id: string;
  name: string;
}

/**
 * How far back the counter may date a collector's money. The API holds the same
 * line, and the office may go further; this only keeps the calendar honest.
 */
export const ROUND_ENTRY_DAYS = 7;

/** The customer's own collector, when they are still on the roster; else the office. */
export function defaultCollector(
  collectors: readonly RosterCollector[] | null,
  assignedCollectorId: string | null | undefined,
): string {
  return assignedCollectorId && collectors?.some((c) => c.id === assignedCollectorId)
    ? assignedCollectorId
    : NO_COLLECTOR;
}

/** The collector a form named, or undefined when it came in at the office. */
export function readCollectorId(form: FormData): string | undefined {
  const value = String(form.get("collectorId") ?? "").trim();
  return value && value !== NO_COLLECTOR ? value : undefined;
}
