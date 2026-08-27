import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileTextIcon,
  Loader2Icon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Form, Link } from "react-router";

import { Button } from "~/components/ui/button";
import { DateField } from "~/components/ui/date-field";
import { Input } from "~/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Label } from "~/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { TableHead } from "~/components/ui/table";
import { formatCount, formatDayRange } from "~/lib/format";
import { MODULE_VAR, type TxnModule } from "~/lib/reports";
import { cn } from "~/lib/utils";

/**
 * The chrome every listing in the app is built out of: a bordered card, a row
 * of status tabs with live counts, a debounced search box, a day-range filter,
 * an export menu, the chips that say what is currently narrowing the list, and
 * a pager.
 *
 * Nine listings share this shape — customers, staff, susu, savings, the ledger,
 * loans, agreements, inventory, trash. Every one of them keeps its own idea of
 * what a filter *means*: these components know how to draw a filter and hand
 * back what was picked, and nothing else. The route owns its `Filters` type and
 * the function that turns one into a query string, which is the only place the
 * module's own vocabulary belongs.
 *
 * The API's cap on an export is 10,000 rows and it is stated in the menu rather
 * than discovered when a file comes back short.
 */

/* ------------------------------------------------------------------ tables --- */

/**
 * The column heading every table in the app uses. Defined once so no two
 * modules drift into two different table styles.
 */
export function Th({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <TableHead
      className={cn(
        "h-10 px-4 text-xs font-bold tracking-wider text-foreground uppercase",
        className,
      )}
    >
      {children}
    </TableHead>
  );
}

/**
 * One end of a pager. Takes `to` where a page is a URL — a listing, whose pages
 * come from the API — and `onClick` where it is not, as on a susu account,
 * whose whole 31-deposit history is already in hand.
 */
export function PagerButton({
  to,
  onClick,
  disabled,
  label,
  children,
}: {
  to?: string;
  onClick?: () => void;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  if (disabled || (!to && !onClick)) {
    return (
      <Button variant="outline" size="sm" disabled aria-label={label}>
        {children}
      </Button>
    );
  }
  if (to) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link to={to} aria-label={label} prefetch="intent" preventScrollReset>
          {children}
        </Link>
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" aria-label={label} onClick={onClick}>
      {children}
    </Button>
  );
}

/**
 * One figure, boxed. Most screens in this app are mostly figures — a balance,
 * what is available, a fee, a payout, what a loan still owes — and they only
 * read as a set when they are drawn as one.
 */
export function Figure({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "success" | "warning" | "danger" | "info" | "revenue" | "muted";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-muted/40 px-3 py-2.5",
        className,
      )}
    >
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "tabular mt-0.5 font-semibold",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
          tone === "info" && "text-info",
          tone === "revenue" && "text-revenue-foreground",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </dd>
      {hint ? (
        <p className="mt-0.5 text-xs font-normal text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export type Tone = "success" | "info" | "warning" | "danger" | "muted";

const TONE_DOT: Record<Tone, string> = {
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  danger: "bg-danger",
  muted: "bg-muted-foreground/50",
};

const TONE_TEXT: Record<Tone, string> = {
  success: "text-foreground",
  info: "text-foreground",
  warning: "text-warning",
  danger: "text-danger",
  muted: "text-muted-foreground",
};

/**
 * A record's state: a dot and a word. Every status in the app is drawn this way
 * — susu, savings, loans, agreements — so that a status in one module is
 * recognisable as a status in another before it is read.
 */
export function StatusPill({
  label,
  blurb,
  tone,
  className,
}: {
  label: string;
  blurb?: string;
  tone: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-sm whitespace-nowrap", className)}
      title={blurb}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
      <span className={TONE_TEXT[tone]}>{label}</span>
    </span>
  );
}

/**
 * The dot that stands for one of the five modules, in that module's own colour.
 *
 * Both ledgers draw it — the business-wide one and a customer's statement — and
 * a colour that meant susu on one screen and savings on the other would be
 * worse than no colour at all, so it is defined once and read off the same
 * `--module-*` names the charts use.
 */
export function ModuleDot({
  module,
  className,
}: {
  module: TxnModule;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: MODULE_VAR[module] }}
    />
  );
}

/* ------------------------------------------------------------------- shell --- */

/** The bordered card a listing lives in. */
export function ListingCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Tabs on the left, filters on the right, stacking on a narrow screen. */
export function ListingToolbar({
  tabs,
  children,
}: {
  tabs?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border p-3 lg:flex-row lg:items-center lg:justify-between">
      {tabs ?? <div />}
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export interface TabSpec {
  key: string;
  label: string;
  /** Omit where a count would be meaningless or too costly to fetch. */
  count?: number;
}

/**
 * The status tabs. Counts survive the other filters — an "Active 3" beside a
 * filtered list showing one row is a contradiction people notice immediately,
 * so the loader scopes each count the same way it scopes the rows.
 */
export function StatusTabs({
  tabs,
  active,
  hrefFor,
}: {
  tabs: readonly TabSpec[];
  active: string;
  hrefFor: (key: string) => string;
}) {
  return (
    <div className="inline-flex w-fit flex-wrap items-center gap-1 rounded-lg bg-muted/60 p-1">
      {tabs.map((tab) => {
        const current = active === tab.key;
        return (
          <Link
            key={tab.key}
            to={hrefFor(tab.key)}
            aria-current={current ? "page" : undefined}
            preventScrollReset
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              current
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.count === undefined ? null : (
              <span
                className={cn(
                  "tabular rounded-full px-1.5 py-px text-xs font-semibold",
                  current
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {formatCount(tab.count)}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ search --- */

const DEBOUNCE_MS = 300;

/**
 * Searches as you type. The term lives in the URL so the result is linkable and
 * survives a reload, but typing must not push a history entry per keystroke —
 * which is what `replace` on the caller's `submit` is for. The API's search is
 * fuzzy and typo-tolerant, server-side.
 *
 * `hidden` carries the rest of the filters so the form still works as a plain
 * GET when JavaScript has not loaded.
 */
export function SearchBox({
  value: applied,
  apply,
  hidden,
  placeholder,
  label,
  busy = false,
  className,
}: {
  value: string;
  apply: (next: string) => void;
  hidden?: Record<string, string>;
  placeholder: string;
  label: string;
  busy?: boolean;
  className?: string;
}) {
  const [value, setValue] = useState(applied);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue((current) => (current === applied ? current : applied));
  }, [applied]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onChange = (next: string) => {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(next), DEBOUNCE_MS);
  };

  const clear = () => {
    clearTimeout(timer.current);
    setValue("");
    apply("");
    inputRef.current?.focus();
  };

  const pending = busy && value.trim() !== applied;

  return (
    <Form
      method="get"
      role="search"
      className={cn("relative w-full sm:w-64", className)}
      onSubmit={(event) => {
        event.preventDefault();
        clearTimeout(timer.current);
        apply(value);
      }}
    >
      {Object.entries(hidden ?? {}).map(([name, v]) =>
        v ? <input key={name} type="hidden" name={name} value={v} /> : null,
      )}

      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="text"
        name="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        maxLength={100}
        className="pr-9 pl-9"
      />
      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center">
        {pending ? (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        ) : value ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear the search"
            className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <XIcon className="size-4" />
          </button>
        ) : null}
      </div>
    </Form>
  );
}

/* ----------------------------------------------------------------- filters --- */

/**
 * An inclusive Accra-day range. `title` names what is being dated — a listing
 * filters on when a record was opened, the ledger on when money moved — because
 * "From / To" on its own leaves people guessing which date it means.
 */
export function DayRangeFilter({
  from,
  to,
  apply,
  title,
  align = "end",
}: {
  from: string;
  to: string;
  apply: (next: { from: string; to: string }) => void;
  title: string;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const active = Boolean(from || to);

  const commit = (next: { from: string; to: string }) => {
    setOpen(false);
    apply(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(active && "border-primary/50 text-primary")}
        >
          <SlidersHorizontalIcon />
          {active ? formatDayRange(from, to) : title}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72 space-y-3">
        <div ref={fieldsRef} key={`${from}|${to}`} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {title} from
            </Label>
            <DateField
              name="from"
              defaultValue={from || undefined}
              placeholder="Any date"
              endMonth={new Date()}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {title} to
            </Label>
            <DateField
              name="to"
              defaultValue={to || undefined}
              placeholder="Any date"
              endMonth={new Date()}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!active}
            onClick={() => commit({ from: "", to: "" })}
          >
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const read = (name: string) =>
                fieldsRef.current?.querySelector<HTMLInputElement>(
                  `input[name='${name}']`,
                )?.value ?? "";
              commit({ from: read("from"), to: read("to") });
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A reporting period that always names itself.
 *
 * The difference from `DayRangeFilter` above is the default. A listing with no
 * date filter shows everything, so the button can say "Registered" and mean it.
 * A report has no such state: ask for no range and the API quietly answers with
 * the last thirty days, and a total with no period beside it is a figure nobody
 * can check. So the route resolves the default itself, this button prints the
 * range whether it was chosen or defaulted, and `active` — set only once
 * somebody picks — is what decides the tint and whether Clear can be pressed.
 *
 * Both ledgers use it, the business-wide one and a customer's statement.
 */
export function PeriodFilter({
  from,
  to,
  active,
  title = "Period",
  apply,
  align = "end",
}: {
  /** The resolved range — never blank, defaulted or not. */
  from: string;
  to: string;
  /** True once somebody has set the range rather than taking the default. */
  active: boolean;
  title?: string;
  /** Clear hands back two empty strings, which is the route's cue to default. */
  apply: (next: { from: string; to: string }) => void;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const fieldsRef = useRef<HTMLDivElement>(null);

  const commit = (next: { from: string; to: string }) => {
    setOpen(false);
    apply(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(active && "border-primary/50 text-primary")}
        >
          <SlidersHorizontalIcon />
          {formatDayRange(from, to)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72 space-y-3">
        {/* Keyed on the applied range so reopening after a Clear shows it. */}
        <div ref={fieldsRef} key={`${from}|${to}`} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="eyebrow text-muted-foreground">{title} from</Label>
            <DateField name="from" defaultValue={from} endMonth={new Date()} />
          </div>
          <div className="space-y-1.5">
            <Label className="eyebrow text-muted-foreground">{title} to</Label>
            <DateField name="to" defaultValue={to} endMonth={new Date()} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!active}
            onClick={() => commit({ from: "", to: "" })}
          >
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              // Each DateField keeps its value in a hidden input; read those on
              // apply rather than mirroring every calendar click into state.
              const read = (name: string) =>
                fieldsRef.current?.querySelector<HTMLInputElement>(
                  `input[name='${name}']`,
                )?.value ?? "";
              commit({ from: read("from"), to: read("to") });
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A one-of dropdown filter — a status, a type, a module. */
export function ChoiceFilter<T extends string>({
  value,
  options,
  apply,
  title,
  allLabel,
  icon,
  width = "w-44",
}: {
  value: T | "";
  options: readonly { value: T; label: string }[];
  apply: (next: T | "") => void;
  title: string;
  allLabel: string;
  icon?: ReactNode;
  width?: string;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(value && "border-primary/50 text-primary")}
        >
          {icon}
          {selected ? selected.label : title}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={width}>
        <DropdownMenuItem onSelect={() => apply("")}>{allLabel}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => apply(option.value)}>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The strip under the toolbar that says what is currently narrowing the list,
 * and lets each one go. It only appears when something is applied — an empty
 * strip on every listing would be a row of nothing.
 */
export function FilterBar({
  total,
  noun = "match",
  plural = "matches",
  children,
}: {
  total: number;
  noun?: string;
  plural?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-sm">
      <span className="text-muted-foreground">
        {formatCount(total)} {total === 1 ? noun : plural}
      </span>
      {children}
    </div>
  );
}

export function FilterChip({
  label,
  onDrop,
}: {
  label: ReactNode;
  onDrop: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium">
      {label}
      <button
        type="button"
        onClick={onDrop}
        className="text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Remove this filter"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}

/** The chip a day range gets, with the calendar mark that says what it is. */
export function DayRangeChip({
  from,
  to,
  onDrop,
}: {
  from: string;
  to: string;
  onDrop: () => void;
}) {
  return (
    <FilterChip
      onDrop={onDrop}
      label={
        <>
          <CalendarIcon className="size-3" />
          {formatDayRange(from, to)}
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ export --- */

/**
 * CSV or Excel of exactly what is on screen, filters and all. The API ignores
 * pagination on an export and caps it at 10,000 rows, so the menu says how many
 * rows are coming rather than letting a truncated file be the first hint.
 *
 * A plain `<a>` rather than a `Link`: the target is a resource route that
 * answers with bytes, and the router must not try to navigate to it.
 */
export function ExportMenu({
  path,
  query,
  total,
  noun = "row",
}: {
  path: string;
  query: string;
  total: number;
  noun?: string;
}) {
  const suffix = query ? `&${query}` : "";
  const capped = Math.min(total, 10_000);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={total === 0}>
          <DownloadIcon />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal text-muted-foreground">
          {formatCount(capped)} {noun}
          {capped === 1 ? "" : "s"}, matching the filters above
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={`${path}?format=csv${suffix}`}>
            <FileTextIcon />
            CSV
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`${path}?format=xlsx${suffix}`}>
            <DownloadIcon />
            Excel (.xlsx)
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------- pager --- */

/**
 * The footer under a listing: where in the set these rows are, and the two ways
 * out of it. Hidden entirely when there is nothing to page through — a pager
 * over an empty table is furniture.
 */
export function ListingFooter({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
      <p>
        Showing <span className="tabular font-medium text-foreground">{first}</span>–
        <span className="tabular font-medium text-foreground">{last}</span> of{" "}
        <span className="tabular font-medium text-foreground">
          {formatCount(total)}
        </span>
      </p>
      <div className="flex items-center gap-2">
        <PagerButton
          to={hrefFor(page - 1)}
          disabled={page <= 1}
          label="Previous page"
        >
          <ChevronLeftIcon />
          Prev
        </PagerButton>
        <PagerButton
          to={hrefFor(page + 1)}
          disabled={last >= total}
          label="Next page"
        >
          Next
          <ChevronRightIcon />
        </PagerButton>
      </div>
    </div>
  );
}
