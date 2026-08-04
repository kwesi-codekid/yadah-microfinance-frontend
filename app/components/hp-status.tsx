import { PackageX, TriangleAlert } from "lucide-react";
import {
  HP_AGREEMENT_STATUS_LABELS,
  type HpAgreement,
  type HpAgreementStatus,
} from "~/lib/hp-client";

const TONE: Record<HpAgreementStatus, string> = {
  pending: "bg-warning/15 text-warning-foreground dark:text-warning",
  active: "bg-success/15 text-success",
  "in-arrears": "bg-red-500/15 text-red-600 dark:text-red-400",
  repossessed: "bg-red-500/15 text-red-600 dark:text-red-400",
  "closed-completed": "bg-navy/15 text-navy dark:text-navy-light",
  "closed-redeemed": "bg-navy/15 text-navy dark:text-navy-light",
  "closed-forfeited": "bg-muted/15 text-muted",
  rejected: "bg-muted/15 text-muted",
};

export function HpStatusPill({ agreement }: { agreement: HpAgreement }) {
  const status = agreement.status;

  return (
    <span className="flex flex-wrap items-center gap-1">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONE[status]}`}
      >
        {status === "in-arrears" && <TriangleAlert size={12} />}
        {status === "repossessed" && <PackageX size={12} />}
        {HP_AGREEMENT_STATUS_LABELS[status]}
      </span>
      {/* Until the deposit lands the item is still on the shelf, not with them. */}
      {status === "pending" && (
        <span className="rounded-full bg-border px-2 py-0.5 text-xs text-muted">
          Not released
        </span>
      )}
    </span>
  );
}
