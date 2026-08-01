import { TriangleAlert } from "lucide-react";
import { LOAN_STATUS_LABELS, type Loan, type LoanStatus } from "~/lib/loan-client";

/**
 * A loan's status, plus the one thing that qualifies it.
 *
 * Here rather than in a route because three pages show it — the book, the
 * customer's history and the loan itself — and a status that looked different
 * on one of them would read as a different status.
 *
 * `arrears` carries the warning triangle because it is the only status that
 * costs the customer money: the rate escalates on the original principal, so
 * the total repayable grows while it sits there. `frozen` rides beside it
 * rather than replacing it — a frozen loan is one the ladder can no longer
 * punish, which makes it a loan that needs a person rather than a wait, and
 * that is a different fact from its status.
 *
 * Colour never carries the state alone: every pill is also its own word.
 */
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
