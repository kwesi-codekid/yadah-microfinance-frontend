import { UserRoundIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { checkCollectorName, checkCollectorPhone } from "~/lib/collected-by";
import { cn } from "~/lib/utils";

/**
 * "Someone else is collecting": the account holder may send another person
 * to take a withdrawal for them. Ticked, it asks for that person's name and
 * phone, which go on the withdrawal, the receipt and the holder's SMS.
 *
 * Submits `onBehalf=1`, `collectorName` and `collectorPhone`;
 * `readCollectedBy` in `~/lib/collected-by` reads them back.
 */
export function CollectedByFields({
  disabled = false,
  onReadyChange,
}: {
  disabled?: boolean;
  /** False while the box is ticked and the name or phone is still wrong. */
  onReadyChange?: (ready: boolean) => void;
}) {
  const [onBehalf, setOnBehalf] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // Said once they leave a field, not on every keystroke on the way.
  const [touched, setTouched] = useState({ name: false, phone: false });

  const nameIssue = checkCollectorName(name);
  const phoneIssue = checkCollectorPhone(phone);
  const ready = !onBehalf || (!nameIssue && !phoneIssue);

  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2.5">
        <Checkbox
          id="onBehalf"
          checked={onBehalf}
          onCheckedChange={(v) => setOnBehalf(v === true)}
          disabled={disabled}
        />
        <Label htmlFor="onBehalf" className="cursor-pointer">
          Someone else is collecting
        </Label>
      </div>

      {onBehalf && (
        <>
          <input type="hidden" name="onBehalf" value="1" />
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="collectorName" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Full name of the person collecting
                <span className="ml-0.5 text-destructive">*</span>
              </Label>
              <div className="relative">
                <UserRoundIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="collectorName"
                  name="collectorName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  autoComplete="off"
                  maxLength={100}
                  autoFocus
                  disabled={disabled}
                  aria-invalid={touched.name && nameIssue ? true : undefined}
                  className={cn("h-11 pl-9", touched.name && nameIssue && "border-destructive")}
                />
              </div>
              {touched.name && nameIssue && (
                <p className="text-xs text-destructive">{nameIssue}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="collectorPhone" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Their phone number<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="collectorPhone"
                name="collectorPhone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                maxLength={16}
                placeholder="0244123456"
                disabled={disabled}
                aria-invalid={touched.phone && phoneIssue ? true : undefined}
                className={cn("tabular h-11", touched.phone && phoneIssue && "border-destructive")}
              />
              {touched.phone && phoneIssue && (
                <p className="text-xs text-destructive">{phoneIssue}</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
