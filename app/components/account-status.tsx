import {
  SAVINGS_ACCOUNT_STATUS_LABELS,
  type SavingsAccountStatus,
} from "~/lib/savings-client";
import {
  SUSU_ACCOUNT_STATUS_LABELS,
  type SusuAccountStatus,
} from "~/lib/susu-client";

const PILL =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";

const SUSU_TONE: Record<SusuAccountStatus, string> = {
  active: "bg-success/15 text-success",
  completed: "bg-navy/15 text-navy dark:text-navy-light",
  closed: "bg-muted/15 text-muted",
};

const SAVINGS_TONE: Record<SavingsAccountStatus, string> = {
  active: "bg-success/15 text-success",
  closed: "bg-muted/15 text-muted",
};

export function SusuStatusPill({ status }: { status: SusuAccountStatus }) {
  return (
    <span className={`${PILL} ${SUSU_TONE[status]}`}>
      {SUSU_ACCOUNT_STATUS_LABELS[status]}
    </span>
  );
}

export function SavingsStatusPill({ status }: { status: SavingsAccountStatus }) {
  return (
    <span className={`${PILL} ${SAVINGS_TONE[status]}`}>
      {SAVINGS_ACCOUNT_STATUS_LABELS[status]}
    </span>
  );
}
