import { Link, type LinkProps } from "react-router";

const TRACK =
  "inline-flex min-h-8 shrink-0 items-stretch gap-1 rounded-full border-2 border-border bg-surface p-0.5";

/** The selected pill's fill; the lighter shade carries it on a dark canvas. */
const FILL = {
  success: "bg-success text-white",
  navy: "bg-navy text-white dark:bg-navy-light",
  teal: "bg-teal-dark text-white dark:bg-teal",
  brand: "bg-brand text-white dark:bg-brand-light dark:text-brand-dark",
} as const;

type TabTone = keyof typeof FILL;

/** Shared by both flavours — the pill itself, selected or not. */
function tabClass(selected: boolean, tone: TabTone) {
  return [
    "flex items-center justify-center gap-1.5 rounded-full px-3.5 text-sm",
    "transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
    selected
      ? `font-semibold ${FILL[tone]}`
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
  /** The panel's own colour, if it has one. See `FILL`. */
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

