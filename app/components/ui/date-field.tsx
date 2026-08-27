import { CalendarIcon } from "lucide-react";
import * as React from "react";
import type { Matcher } from "react-day-picker";

import { Button } from "~/components/ui/button";
import { Calendar } from "~/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";

/** A `yyyy-mm-dd` string parsed to a local Date, or undefined if empty/invalid. */
function parseDay(day: string | undefined): Date | undefined {
  if (!day) return undefined;
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** A local Date formatted back to the `yyyy-mm-dd` the form and API expect. */
function toDay(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const DISPLAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * A date field that reads like the rest of the form instead of the browser's
 * native `<input type="date">`. It renders a shadcn-styled trigger and a
 * calendar popover, and keeps a hidden input carrying the `yyyy-mm-dd` value so
 * an uncontrolled `<Form>` submits exactly as it did before.
 */
export function DateField({
  name,
  id,
  defaultValue,
  placeholder = "Pick a date",
  required,
  disabled,
  /** Restrict selectable days — e.g. no future dates for a birthday. */
  matcher,
  /** `dropdown` gives month/year menus, handy for dates far in the past. */
  captionLayout = "dropdown",
  /** Bounds for the year dropdown. */
  startMonth,
  endMonth,
  className,
}: {
  name: string;
  id?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  matcher?: Matcher | Matcher[];
  captionLayout?: React.ComponentProps<typeof Calendar>["captionLayout"];
  startMonth?: Date;
  endMonth?: Date;
  className?: string;
}) {
  const [value, setValue] = React.useState<Date | undefined>(() =>
    parseDay(defaultValue),
  );
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <input type="hidden" name={name} value={value ? toDay(value) : ""} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            id={id}
            disabled={disabled}
            data-empty={!value}
            aria-required={required}
            className={cn(
              "h-9 w-full justify-start border-input bg-card px-2.5 font-normal data-[empty=true]:text-muted-foreground",
              className,
            )}
          >
            <CalendarIcon className="size-4 opacity-70" />
            {value ? DISPLAY.format(value) : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            defaultMonth={value}
            onSelect={(date) => {
              setValue(date);
              setOpen(false);
            }}
            disabled={matcher}
            captionLayout={captionLayout}
            startMonth={startMonth}
            endMonth={endMonth}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
