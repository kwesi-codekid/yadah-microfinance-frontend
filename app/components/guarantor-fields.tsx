import { PlusIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/utils";

/**
 * The people standing behind a loan: one block of name, phone and ID number
 * each, with a button to add another — the way payments are added on the
 * paper-loan form. Anybody may stand, customer of the branch or not.
 *
 * The blocks submit as three parallel lists (`guarantorName`, `guarantorPhone`,
 * `guarantorIdNumber`); `readGuarantors` in `~/lib/guarantors` reads them back.
 */
export function GuarantorFields({
  legendClassName,
  required = false,
  onFirstChange,
}: {
  legendClassName?: string;
  /** Marks the first guarantor's name and phone as required. */
  required?: boolean;
  /** Told what the first block holds, for forms that gate on it. */
  onFirstChange?: (first: { fullName: string; phone: string }) => void;
}) {
  const nextKey = useRef(1);
  const [blocks, setBlocks] = useState<number[]>([0]);
  const first = useRef({ fullName: "", phone: "" });

  const star = required ? <span className="ml-0.5 text-destructive">*</span> : null;

  function firstChanged(patch: Partial<{ fullName: string; phone: string }>) {
    first.current = { ...first.current, ...patch };
    onFirstChange?.(first.current);
  }

  return (
    <fieldset className="space-y-3">
      <legend className={cn(legendClassName, "mb-1.5")}>
        {blocks.length > 1 ? "Guarantors" : "Guarantor"}
      </legend>
      {blocks.map((key, i) => (
        <div key={key} className={cn("space-y-3", i > 0 && "border-t border-border pt-3")}>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor={`guarantorName-${key}`} className="text-xs font-medium">
                Full name{i === 0 && star}
              </Label>
              <Input
                id={`guarantorName-${key}`}
                name="guarantorName"
                autoComplete="off"
                maxLength={120}
                onChange={i === 0 ? (e) => firstChanged({ fullName: e.target.value }) : undefined}
              />
            </div>
            {i > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove guarantor ${i + 1}`}
                onClick={() => setBlocks((b) => b.filter((k) => k !== key))}
              >
                <XIcon />
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`guarantorPhone-${key}`} className="text-xs font-medium">
                Phone{i === 0 && star}
              </Label>
              <Input
                id={`guarantorPhone-${key}`}
                name="guarantorPhone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                maxLength={16}
                onChange={i === 0 ? (e) => firstChanged({ phone: e.target.value }) : undefined}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`guarantorIdNumber-${key}`} className="text-xs font-medium">
                ID number
              </Label>
              <Input
                id={`guarantorIdNumber-${key}`}
                name="guarantorIdNumber"
                autoComplete="off"
                maxLength={40}
              />
            </div>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setBlocks((b) => [...b, nextKey.current++])}
      >
        <PlusIcon /> Add guarantor
      </Button>
    </fieldset>
  );
}
