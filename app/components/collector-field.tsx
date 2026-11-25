import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { RosterCollector } from "~/lib/collector-entry";
import { NO_COLLECTOR } from "~/lib/customer-form";

/**
 * Whose round this money came from, for the office typing in what a collector
 * brought back. The money is filed under them; whoever is signed in stays on
 * the record as the person who entered it. Only the counter is shown this — a
 * collector signed in on their own account is always themselves.
 */
export function CollectorField({
  collectors,
  value,
  onChange,
  disabled,
}: {
  collectors: RosterCollector[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Collected by
      </Label>
      <Select name="collectorId" value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_COLLECTOR}>Office / walk-in</SelectItem>
          {collectors.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value === NO_COLLECTOR ? (
        // The usual way money ended up under the attendant: the picker left
        // on the office for a customer with no collector of their own.
        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
          Filed under your name, not a collector&rsquo;s. If a collector brought this in, pick
          them above.
        </p>
      ) : null}
    </div>
  );
}
