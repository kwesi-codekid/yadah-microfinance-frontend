import { TriangleAlert } from "lucide-react";
import { LOAN_STATUS_LABELS, type Loan, type LoanStatus } from "~/lib/loan-client";

const TONE: Record<LoanStatus, string> = {
  pending: "bg-warning/15 text-warning-foreground dark:text-warning",
  active: "bg-success/15 text-success",
  repaid: "bg-navy/15 text-navy dark:text-navy-light",
  rejected: "bg-muted/15 text-muted",
  arrears: "bg-red-500/15 text-red-600 dark:text-red-400",
};

export function LoanStatusPill({ loan }: { loan: Loan }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONE[loan.status]}`}
      >
        {loan.status === "arrears" && <TriangleAlert size={12} />}
        {LOAN_STATUS_LABELS[loan.status]}
      </span>
      {loan.frozen && (
        <span className="rounded-full bg-border px-2 py-0.5 text-xs text-muted">
          Frozen
        </span>
      )}
    </span>
  );
}
