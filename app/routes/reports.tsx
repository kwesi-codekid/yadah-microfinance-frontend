import {
  ArrowLeftRightIcon,
  ChevronRightIcon,
  CoinsIcon,
  LandmarkIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";

import { Page } from "~/components/page";
import { requireOffice } from "~/lib/session.server";
import type { Route } from "./+types/reports";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Reports · Yadah Dynamic Enterprise" }];
}

/** What the layout header calls this page, and the line under it. */
export const handle = {
  title: "Reports",
  description: "The questions that cut across more than one module.",
};

export async function loader({ request }: Route.LoaderArgs) {
  // The whole `/reports` surface is office-only on the API's side; a collector
  // reconciles their own day on the susu summary, which is scoped to them.
  await requireOffice(request);
  return null;
}

/**
 * The way in to the four questions the office asks of the books that the module
 * screens cannot answer, because each of them cuts across several modules at
 * once: who collected, what is still owed, how late it is, and what was kept.
 *
 * A hub rather than four rail entries. They are read occasionally and in
 * answer to a question, not worked in — putting each one a click from the
 * others is what makes them read as a set.
 */
const REPORTS: {
  to: string;
  label: string;
  blurb: string;
  icon: LucideIcon;
}[] = [
  {
    to: "/reports/collections",
    label: "Collections by staff",
    blurb:
      "Susu and savings deposits grouped by whoever recorded them. What a collector counts their bag against.",
    icon: UsersIcon,
  },
  {
    to: "/reports/loans",
    label: "Loan portfolio",
    blurb:
      "Every open loan, soonest due first, under the 1–30 / 31–90 / 90+ arrears buckets.",
    icon: LandmarkIcon,
  },
  {
    to: "/reports/commission",
    label: "Commission and fees",
    blurb:
      "Susu commissions and savings fees — the part of the money that stays with the branch.",
    icon: CoinsIcon,
  },
  {
    to: "/transactions",
    label: "Transaction ledger",
    blurb:
      "Every movement of money across all modules, newest first. Transfers appear as internal legs.",
    icon: ArrowLeftRightIcon,
  },
];

export default function Reports() {
  return (
    <Page>
      <div className="grid gap-3 sm:grid-cols-2">
        {REPORTS.map((report) => (
          <Link
            key={report.to}
            to={report.to}
            prefetch="intent"
            className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-muted/40"
          >
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
              <report.icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 font-semibold">
                {report.label}
                <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                {report.blurb}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </Page>
  );
}
