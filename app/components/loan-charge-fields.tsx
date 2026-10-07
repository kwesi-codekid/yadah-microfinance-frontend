import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/utils";

/**
 * The processing fee and the cash collateral, recorded apart from the loan
 * (client decision, 6 Oct 2026). Both a fixed sum in cedis, both optional —
 * left empty means none was taken. Read on the server with `readLoanCharges`.
 *
 * The fee is paid on top and never comes out of the principal; the collateral
 * is the customer's money, held until the loan is repaid.
 */
export function LoanChargeFields({
  labelClassName,
  defaults,
}: {
  labelClassName?: string;
  /** Cedis as typed, to refill the boxes after a refused submit. */
  defaults?: { processingFee?: string; collateralAmount?: string };
}) {
  const label = cn(
    "text-xs font-medium tracking-wide text-muted-foreground uppercase",
    labelClassName,
  );
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="processingFee" className={label}>
          Processing fee · GH₵
        </Label>
        <Input
          id="processingFee"
          name="processingFee"
          defaultValue={defaults?.processingFee}
          inputMode="decimal"
          autoComplete="off"
          className="tabular"
        />
        <p className="text-xs text-muted-foreground">Paid on top, not taken from the loan.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="collateralAmount" className={label}>
          Collateral · GH₵
        </Label>
        <Input
          id="collateralAmount"
          name="collateralAmount"
          defaultValue={defaults?.collateralAmount}
          inputMode="decimal"
          autoComplete="off"
          className="tabular"
        />
        <p className="text-xs text-muted-foreground">Cash held until the loan is repaid.</p>
      </div>
    </div>
  );
}
