import { Link, type LinkProps } from "react-router";

const TRACK = "inline-flex shrink-0 items-stretch gap-6";

/** The selected tab's ink — text and the rule under it. */
const INK = {
  brand: {
    text: "text-brand dark:text-brand-light",
    rule: "bg-brand dark:bg-brand-light",
  },
  success: { text: "text-success", rule: "bg-success" },
  navy: {
    text: "text-navy dark:text-navy-light",
    rule: "bg-navy dark:bg-navy-light",
  },
  teal: {
    text: "text-teal-dark dark:text-teal",
    rule: "bg-teal-dark dark:bg-teal",
  },
} as const;

type TabTone = keyof typeof INK;

/** Shared by both flavours — the tab itself, selected or not. */
function tabClass(selected: boolean, tone: TabTone) {
  return [
    "relative flex items-center justify-center gap-1.5 whitespace-nowrap px-0.5 pb-2 pt-1 text-sm",
    "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    selected
      ? `font-semibold ${INK[tone].text}`
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
  tone = "brand",
  children,
  ...props
}: {
  selected: boolean;
  /** `id` of the panel this tab swaps. */
  controls?: string;
  icon?: React.ReactNode;
  /** The panel's own colour, if it has one. See `INK`. */
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
      {selected && (
        <span
          aria-hidden="true"
          className={`absolute inset-x-0 bottom-0 h-0.5 rounded-full ${INK[tone].rule}`}
        />
      )}
    </Link>
  );
}
