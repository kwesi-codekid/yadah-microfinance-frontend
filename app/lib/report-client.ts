/**
 * The four reports, named and described. Client-safe: the page reads this to
 * build its tabs, while [reports.ts](app/lib/api/reports.ts) reads the same
 * paths to call them.
 */
export const REPORTS = {
  collections: {
    path: "/reports/collections",
    label: "Collections by staff",
    blurb:
      "Susu and savings deposits recorded per person — who brought in what. Defaults to the last 30 Accra days.",
    ranged: true,
  },
  "loans-outstanding": {
    path: "/reports/loans/outstanding",
    label: "Loans outstanding",
    blurb: "Active and arrears loans, soonest due first, with days overdue.",
    ranged: false,
  },
  "loans-aging": {
    path: "/reports/loans/aging",
    label: "Arrears aging",
    blurb: "How far behind the book is: 1–30, 31–90 and 90+ days.",
    ranged: false,
  },
  commission: {
    path: "/reports/commission",
    label: "Commission earned",
    blurb:
      "Revenue: susu closure commissions and savings withdrawal or closure fees.",
    ranged: true,
  },
} as const;

export type ReportName = keyof typeof REPORTS;

export function isReportName(value: unknown): value is ReportName {
  return typeof value === "string" && value in REPORTS;
}

export interface ReportRange {
  /** `YYYY-MM-DD`, Accra days. Only the ranged reports read these. */
  from?: string;
  to?: string;
}
