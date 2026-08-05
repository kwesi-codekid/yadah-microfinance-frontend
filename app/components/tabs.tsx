import { Link, type LinkProps } from "react-router";

/** HeroUI's solid tabs: a padded track with a pill behind the selected tab. */
const TRACK =
  "inline-flex shrink-0 items-center gap-1 rounded-[calc(var(--radius)*2.5)] bg-default p-1";

/** The selected tab's pill. */
const PILL = {
  brand: "bg-brand text-brand-foreground",
  success: "bg-success text-success-foreground",
  navy: "bg-navy text-white",
  teal: "bg-teal text-white",
} as const;

type TabTone = keyof typeof PILL;

/** Shared by both flavours — the tab itself, selected or not. */
function tabClass(selected: boolean, tone: TabTone) {
  return [
    "relative flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-3xl px-4 text-sm",
    "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    selected
      ? `font-semibold ${PILL[tone]}`
      : "font-medium text-muted hover:text-foreground",
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
  /** The pill's colour; green unless overridden. See `PILL`. */
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
