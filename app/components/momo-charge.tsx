import { InfoIcon, SmartphoneIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { Figure } from "~/components/listing";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { formatAmount, formatPesewas, parseCedis, toCedisInput } from "~/lib/format";
import {
  checkPhone,
  needsAmount,
  PROVIDER_OPTIONS,
  type ChargeKind,
} from "~/lib/payments";
import { cn } from "~/lib/utils";

/**
 * The body of every "charge a wallet" drawer — six kinds of charge, one form.
 *
 * Nothing is credited here. The customer approves a prompt on their own handset
 * and the money reaches the record when Paystack confirms it, so this form's
 * only job is to be right about *whose* wallet and *how much* before the prompt
 * goes out. What happens next belongs to the charge screen.
 *
 * `hp-redemption` takes no amount at all: redeeming is always the full
 * remaining balance, computed server-side. The field is not rendered rather
 * than rendered and disabled — there is no number to give.
 */
/** Whatever the API refused the charge with, above the form that caused it. */
export function ChargeFault({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mb-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
    >
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
      {message}
    </div>
  );
}

export function MomoFields({
  kind,
  phone,
  amountLabel = "Amount",
  suggested,
  cap,
  capLabel,
  note,
}: {
  kind: ChargeKind;
  /** The customer's own number, pre-filled — most charges go to it. */
  phone?: string;
  amountLabel?: string;
  /** Pre-fills the box: the instalment due, the balance owing. */
  suggested?: number;
  /** The most the target can take, when it has a ceiling. */
  cap?: number;
  capLabel?: string;
  note?: string;
}) {
  const [value, setValue] = useState(
    suggested != null ? toCedisInput(suggested) : "",
  );
  const [number, setNumber] = useState(phone ?? "");

  const pesewas = parseCedis(value);
  const phoneFault = number === "" ? null : checkPhone(number);
  const amountFault =
    !needsAmount(kind) || value === ""
      ? null
      : pesewas == null || pesewas <= 0
        ? "Enter an amount."
        : cap != null && pesewas > cap
          ? `More than the ${capLabel ?? "balance"} — the most that can be taken is GH₵ ${formatAmount(cap)}.`
          : null;

  return (
    <div className="space-y-6">
      {cap != null && (
        <dl className="grid grid-cols-1 gap-3">
          <Figure
            label={capLabel ?? "Still owing"}
            value={formatPesewas(cap)}
            tone="warning"
          />
        </dl>
      )}

      <div className="space-y-1.5">
        <Label
          htmlFor="phone"
          className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >
          Wallet to charge<span className="ml-0.5 text-destructive">*</span>
        </Label>
        <Input
          id="phone"
          name="phone"
          value={number}
          onChange={(event) => setNumber(event.target.value)}
          inputMode="tel"
          placeholder="024 000 0000"
          autoComplete="off"
          autoFocus
          aria-invalid={phoneFault ? true : undefined}
          className={cn("tabular", phoneFault && "border-destructive")}
        />
        <p
          className={cn(
            "text-xs",
            phoneFault ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {phoneFault ?? "Ten digits starting 02 or 05. The prompt goes to this handset."}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Network
        </Label>
        <Select name="provider" defaultValue="mtn">
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {needsAmount(kind) ? (
        <div className="space-y-1.5">
          <Label
            htmlFor="amount"
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            {amountLabel} · GH₵<span className="ml-0.5 text-destructive">*</span>
          </Label>
          <Input
            id="amount"
            name="amount"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
            aria-invalid={amountFault ? true : undefined}
            className={cn("tabular", amountFault && "border-destructive")}
          />
          {amountFault && <p className="text-xs text-destructive">{amountFault}</p>}
        </div>
      ) : (
        // Redemption is always the full remaining balance, computed server-side.
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">
          <SmartphoneIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            <strong>The full remaining balance.</strong>{" "}
            <span className="text-muted-foreground">
              Redeeming is all-or-nothing, and the figure is worked out by the
              API at the moment the money lands.
            </span>
          </span>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {note ??
            "Nothing is credited yet. The customer approves a prompt on their handset, and the money reaches the record when Paystack confirms it."}
        </span>
      </div>
    </div>
  );
}
