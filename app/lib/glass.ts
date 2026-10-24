/**
 * The round "bead of lit glass" the sign-in page's theme switch wears, shared
 * by the header's round buttons — theme, notifications and account — so they
 * read as one set. A white rim, a frosted fill and an inner highlight; in the
 * dark theme a faint glass ring.
 */
export const GLASS_BEAD = [
  "relative size-9 rounded-full border-2 border-white bg-white/55 text-foreground backdrop-blur-md outline-none",
  "shadow-[inset_0_1px_0_rgb(255_255_255/0.9),0_1px_3px_rgb(0_0_0/0.08),0_6px_16px_-6px_rgb(0_0_0/0.18)]",
  "transition-colors hover:bg-white/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
  "dark:border-white/35 dark:bg-white/5 dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_6px_16px_-6px_rgb(0_0_0/0.6)] dark:hover:bg-white/10",
].join(" ");
