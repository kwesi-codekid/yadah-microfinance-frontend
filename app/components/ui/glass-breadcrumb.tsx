import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * The app's breadcrumb, drawn like glassyui's Glass Tabs: the steps sit in a
 * frosted track, earlier steps are muted links that brighten on hover, a
 * faded chevron follows every step but the last, and the current page is a
 * raised white pill.
 *
 *   <GlassBreadcrumb>
 *     <GlassBreadcrumbItem>
 *       <GlassBreadcrumbLink asChild><Link to="/loans">Loans</Link></GlassBreadcrumbLink>
 *     </GlassBreadcrumbItem>
 *     <GlassBreadcrumbItem>
 *       <GlassBreadcrumbPage>LN-0042</GlassBreadcrumbPage>
 *     </GlassBreadcrumbItem>
 *   </GlassBreadcrumb>
 */
function GlassBreadcrumb({
  className,
  children,
  "aria-label": ariaLabel = "Breadcrumb",
  ...props
}: React.ComponentProps<"nav">) {
  return (
    <nav
      aria-label={ariaLabel}
      data-slot="glass-breadcrumb"
      className={cn("min-w-0 text-sm leading-[1.4] text-muted-foreground", className)}
      {...props}
    >
      {/* A frosted track, like glassyui's tabs list: the steps sit in it and
          the current page rises out of it as a white pill. */}
      <ol className="m-0 inline-flex max-w-full list-none items-center gap-0.5 rounded-full border border-white/70 bg-black/4.5 p-1 shadow-[inset_0_1px_2px_rgb(0_0_0/0.06),0_1px_0_rgb(255_255_255/0.8)] backdrop-blur-md dark:border-white/10 dark:bg-white/6 dark:shadow-[inset_0_1px_2px_rgb(0_0_0/0.3)]">
        {children}
      </ol>
    </nav>
  );
}

/** One step in the track. It draws a chevron after itself, except on the last step. */
function GlassBreadcrumbItem({ className, children, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="glass-breadcrumb-item"
      className={cn("group/crumb inline-flex min-w-0 items-center gap-0.5", className)}
      {...props}
    >
      {children}
      <span
        aria-hidden
        className="inline-flex text-muted-foreground opacity-65 group-last/crumb:hidden rtl:-scale-x-100 [&>svg]:size-4"
      >
        <ChevronRightIcon />
      </span>
    </li>
  );
}

const STEP =
  "box-border inline-flex min-h-8 items-center rounded-full px-4 whitespace-nowrap";

const PRESSABLE =
  "bg-transparent font-medium text-muted-foreground no-underline transition-[background-color,color] duration-180 ease-out outline-none hover:bg-white/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring data-[state=open]:bg-white/50 data-[state=open]:text-foreground dark:hover:bg-white/10 dark:data-[state=open]:bg-white/10";

/** A link step. `asChild` lends the link styles to your own link, such as a router's. */
function GlassBreadcrumbLink({
  asChild = false,
  className,
  ...props
}: React.ComponentProps<"a"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "a";
  return (
    <Comp data-slot="glass-breadcrumb-link" className={cn(STEP, PRESSABLE, className)} {...props} />
  );
}

/** The current page, as text with aria-current="page". */
function GlassBreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-current="page"
      data-slot="glass-breadcrumb-page"
      className={cn(
        STEP,
        // The active pill: white, lifted out of the track.
        "block min-w-0 truncate bg-white leading-8 font-semibold text-neutral-900 shadow-[0_1px_3px_rgb(0_0_0/0.12),0_4px_10px_-4px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.9)] dark:bg-white/90",
        className,
      )}
      {...props}
    />
  );
}

/** A button that stands in for folded steps, so it can open a menu of them. */
function GlassBreadcrumbEllipsis({
  className,
  "aria-label": ariaLabel = "Show hidden pages",
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      data-slot="glass-breadcrumb-ellipsis"
      className={cn(STEP, PRESSABLE, "cursor-pointer border-0 px-1.5 [&>svg]:size-5", className)}
      {...props}
    >
      <MoreHorizontalIcon />
    </button>
  );
}

export {
  GlassBreadcrumb,
  GlassBreadcrumbEllipsis,
  GlassBreadcrumbItem,
  GlassBreadcrumbLink,
  GlassBreadcrumbPage,
};
