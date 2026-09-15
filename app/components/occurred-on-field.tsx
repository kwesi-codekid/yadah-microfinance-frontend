import { DateField } from "~/components/ui/date-field";
import { Label } from "~/components/ui/label";
import { accraDay } from "~/lib/format";

/**
 * The day a transaction actually happened.
 *
 * Only drawn while the branch is populating its records — see
 * `lib/backdating.server.ts` for why it exists and how it is switched off
 * again. It defaults to today, and a form left on today sends nothing at all,
 * so the everyday collection takes exactly the path it always did.
 *
 * The calendar refuses tomorrow and stops two years back, which is what the
 * API accepts. A year mistyped into the box is the mistake this is guarding
 * against: it would otherwise file a deposit somewhere nobody thinks to look.
 */
export function OccurredOnField({
  enabled,
  noun,
}: {
  enabled: boolean;
  /** What is being recorded, for the line under the field: "deposit", "collection". */
  noun: string;
}) {
  if (!enabled) return null;
  const today = new Date();

  return (
    <div className="space-y-1.5">
      <Label
        htmlFor="occurredOn"
        className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
      >
        Day it happened
      </Label>
      <DateField
        id="occurredOn"
        name="occurredOn"
        defaultValue={accraDay(today)}
        matcher={{ after: today }}
        startMonth={new Date(today.getFullYear() - 2, today.getMonth())}
        endMonth={today}
      />
      <p className="text-xs text-muted-foreground">
        Today, unless you are entering a {noun} from an earlier day. It lands in
        that day&rsquo;s collection sheet and cash count.
      </p>
    </div>
  );
}
