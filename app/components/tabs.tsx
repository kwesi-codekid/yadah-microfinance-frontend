import { Link, type LinkProps } from "react-router";

const TRACK =
  "inline-flex min-h-8 shrink-0 items-stretch gap-1 rounded-full border-2 border-border bg-surface p-0.5";

const RING = {
  success: "ring-success",
  navy: "ring-navy dark:ring-navy-light",
  teal: "ring-teal-dark dark:ring-teal",
  brand: "ring-brand dark:ring-brand-light",
} as const;

export type TabTone = keyof typeof RING;

/** Shared by both flavours — the pill itself, selected or not. */
function tabClass(selected: boolean, tone: TabTone) {
  return [
    "flex items-center justify-center gap-1.5 rounded-full px-3.5 text-sm",
    "transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
    selected
      ? // No fill of its own — the track is already the surface colour, so a
        `font-semibold text-foreground ring-2 ${RING[tone]}`
      : "font-medium text-muted hover:bg-surface-tertiary hover:text-foreground",
  ].join(" ");
}

export function TabList({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={`${TRACK} ${className}`}>
      {children}
    </div>
  );
}

export function TabLink({
  selected,
  controls,
  icon,
  tone = "success",
  children,
  ...props
}: {
  selected: boolean;
  /** `id` of the panel this tab swaps. */
  controls?: string;
  icon?: React.ReactNode;
  /** The panel's own colour, if it has one. See `RING`. */
  tone?: TabTone;
  children: React.ReactNode;
} & Omit<LinkProps, "children">) {
  return (
    <Link
      role="tab"
      aria-selected={selected}
      aria-controls={controls}
      preventScrollReset
      {...props}
      className={tabClass(selected, tone)}
    >
      {icon && (
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
      )}
      {children}
    </Link>
  );
}

/** A tab whose state is local — no URL, no navigation. */
export function TabButton({
  selected,
  controls,
  icon,
  tone = "success",
  children,
  onClick,
}: {
  selected: boolean;
  controls?: string;
  icon?: React.ReactNode;
  /** The panel's own colour, if it has one. See `RING`. */
  tone?: TabTone;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={controls}
      onClick={onClick}
      className={tabClass(selected, tone)}
    >
      {icon && (
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
