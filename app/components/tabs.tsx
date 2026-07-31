import { Link, type LinkProps } from "react-router";

/**
 * The tab bar, for the whole app.
 *
 * One shape everywhere: a bordered pill track on the surface colour, holding
 * pill tabs, the selected one ringed. It replaces the segmented control that
 * filled the selected segment with solid green — a fill that heavy reads as a
 * button somebody pressed rather than as which of two lists is on screen, and
 * it left no room for an icon.
 *
 * Nothing here is painted a fixed colour, so the bar needs no dark-mode branch
 * of its own: track and tabs are all `--surface`, and the ring and the muted
 * text move with the theme. The old grey-well-and-white-pill version did need
 * one — a well has to go *darker* than the page in one theme and lighter in the
 * other, and that inversion is exactly the rule this drops.
 *
 * Colour never carries the state alone. The ring is the signal a glance
 * catches, but the selected tab is also the only one at semibold, and
 * `aria-selected` says so outright.
 *
 * Two flavours because the app has two kinds of tab and they are different
 * elements, not one element with a prop: `TabLink` when the choice lives in the
 * URL (a filter, a product) and `TabButton` when it is local state (an auth
 * method). Anything else — a div with an onClick — is not a tab.
 */

/**
 * The track: the surface colour, not a grey well.
 *
 * It carries the same `border-2 border-border` the inputs and selects it shares
 * a filter row with carry — on a white card a white track with no edge has
 * nothing to be, and the border is what makes it read as one control holding
 * two tabs rather than two loose pills.
 *
 * `min-h-8` matches `FIELD`, so the bar and the fields beside it agree on a
 * height by sharing the number rather than by two numbers that happen to be
 * equal today. Border-box, so the 2px edge is inside the 32px, and `p-0.5` is
 * the 2px the selected pill's ring needs to sit in without being clipped.
 */
const TRACK =
  "inline-flex min-h-8 shrink-0 items-stretch gap-1 rounded-full border-2 border-border bg-surface p-0.5";

/**
 * What the selected ring is coloured, when the tab reveals something that has a
 * colour of its own.
 *
 * The savings cards are navy and the susu cards are teal, so a tab bar over
 * them rings itself in whichever it is about to show — the ring becomes a
 * preview of the panel rather than a generic "this one" marker, and the switch
 * is legible from the colour alone once you have seen either list.
 *
 * Each one lifts in the dark theme. `navy` is #014171: it reads on a white
 * track and all but disappears on the near-black one, so the dark variant is
 * the lighter step off the same hue rather than the same value in both.
 *
 * `success` stays the default — a tab bar over two things that *aren't*
 * colour-coded shouldn't invent a code for them.
 */
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
        // pill painted the same thing would be invisible. The ring draws the
        // pill instead. Never the red accent: red is this app's danger colour,
        // and "which list am I looking at" is not a warning. Weight and
        // `aria-selected` back the ring up, so the state does not rest on one
        // hue alone — which matters more here than usual, since the hue is now
        // the tab's own rather than one constant the eye can learn.
        `font-semibold text-foreground ring-2 ${RING[tone]}`
      : "font-medium text-muted hover:bg-surface-tertiary hover:text-foreground",
  ].join(" ");
}

/**
 * The bar itself. `aria-label` is required rather than optional — a tablist
 * with no name is read out as "tab list" and nothing else, which tells someone
 * on a screen reader that there is a choice here but not what it is about.
 */
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

/**
 * A tab whose state is a URL.
 *
 * `preventScrollReset` by default: a tab swaps the panel that is already under
 * the cursor, and jumping to the top of the page to do it loses the reader's
 * place for no gain. Pass it explicitly to override.
 */
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
