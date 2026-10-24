import * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";

import { cn } from "~/lib/utils";

/**
 * A scroll container with a thin glass scrollbar that shows on hover and
 * while scrolling — the app's one scrollbar, after glassyui's Glass Scroll
 * Area. The viewport scrolls natively; only the bar is drawn by us.
 *
 *   <GlassScrollArea className="h-64">…</GlassScrollArea>
 *   <GlassScrollArea scrollbars="horizontal">…</GlassScrollArea>
 *   <GlassScrollArea viewportProps={{ ref, "aria-label": "Notes", tabIndex: 0 }}>
 *
 * When the content holds no links or controls, give the viewport
 * `tabIndex={0}`, `role="region"` and an `aria-label` so a keyboard can scroll it.
 */
export type GlassScrollAreaProps = Omit<
  React.ComponentProps<typeof ScrollAreaPrimitive.Root>,
  "type"
> & {
  /** Which scrollbars to draw. */
  scrollbars?: "vertical" | "horizontal" | "both";
  /**
   * When a bar shows: on hover and while scrolling, only while scrolling,
   * whenever the content overflows, or always.
   */
  type?: "hover" | "scroll" | "auto" | "always";
  /** Milliseconds a bar stays after the pointer leaves or scrolling stops. */
  scrollHideDelay?: number;
  /** Props for the element that scrolls — a ref, role or aria-label. */
  viewportProps?: React.ComponentProps<typeof ScrollAreaPrimitive.Viewport>;
};

function GlassScrollArea({
  className,
  children,
  scrollbars = "vertical",
  type = "hover",
  scrollHideDelay = 600,
  viewportProps,
  ...props
}: GlassScrollAreaProps) {
  const { className: viewportClassName, ...viewportRest } = viewportProps ?? {};
  return (
    <ScrollAreaPrimitive.Root
      data-slot="glass-scroll-area"
      type={type}
      scrollHideDelay={scrollHideDelay}
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="glass-scroll-area-viewport"
        className={cn(
          "size-full rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          // Radix wraps the content in `display: table`, which lets wide
          // children push past the width and breaks `truncate`. With no
          // horizontal bar there is nothing to scroll sideways, so lay it out
          // as a plain block.
          scrollbars === "vertical" && "[&>div]:block!",
          viewportClassName,
        )}
        {...viewportRest}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {scrollbars !== "horizontal" && <GlassScrollBar orientation="vertical" />}
      {scrollbars !== "vertical" && <GlassScrollBar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner className="bg-transparent" />
    </ScrollAreaPrimitive.Root>
  );
}

function GlassScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="glass-scroll-area-scrollbar"
      orientation={orientation}
      // Kept mounted so hiding fades rather than vanishes.
      forceMount
      className={cn(
        "group/bar z-10 flex touch-none p-[3px] select-none",
        "transition-[opacity,padding] duration-[160ms] ease-out hover:p-[2px]",
        "data-[state=hidden]:pointer-events-none data-[state=hidden]:opacity-0 data-[state=hidden]:duration-[240ms]",
        orientation === "vertical" ? "h-full w-2.5" : "h-2.5 flex-col",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="glass-scroll-area-thumb"
        className={cn(
          "relative flex-1 rounded-full",
          "bg-foreground/25 shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.35)] backdrop-blur-md backdrop-saturate-[1.6]",
          "transition-colors duration-[160ms] group-hover/bar:bg-foreground/40",
          // A thin bar is hard to grab; widen the hit area, not the drawing.
          "before:absolute before:top-1/2 before:left-1/2 before:size-full before:min-h-6 before:min-w-6 before:-translate-1/2 before:content-['']",
        )}
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { GlassScrollArea, GlassScrollBar };
