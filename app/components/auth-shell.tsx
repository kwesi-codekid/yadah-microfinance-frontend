import { useEffect, useLayoutEffect } from "react";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { ThemeToggle } from "~/components/theme-toggle";

/**
 * The signed-out chrome: backdrop photo, brand, and the card the form sits in.
 *
 * Shared by every page you can reach without a session — /login and the OTP
 * step — so moving between them doesn't repaint the background or shift the
 * logo. Everything here is decoration; the page supplies the form as children.
 */

// Backdrop photo. Declared once and used by both breakpoints — the mobile
// full-bleed layer and the desktop left column — so they can't drift apart.
const LOGIN_BG = "url('/money.jpg')";

// Company mark. Same file the splash screen uses, so the two entry points to
// the app open on the same logo.
const LOGO_SRC = "/favicon.png";

/**
 * Field treatment for the auth forms: soft fill, green border, no focus ring.
 * Exported because /login and the OTP step must look identical — a field that
 * changed shape between the two steps would read as a different app.
 */
export const AUTH_FIELD_CLASS =
  "min-h-[40px] rounded-md dark:bg-white/5 border-2 border-success/50 focus:ring-0";

// Green submit actions. HeroUI v3 has no `success` button variant — the set is
// primary / secondary / tertiary / ghost / outline / danger / danger-soft — so
// `variant="success"` emitted a `button--success` class with no rule behind it
// and these buttons rendered unfilled. They use the real `primary` variant for
// its sizing, focus and disabled behaviour, with the fill repainted from the
// `--success` token.
export const AUTH_SUBMIT_CLASS = "rounded-md bg-success/90 text-white";

// useLayoutEffect on the client (runs before paint, so the entrance never
// flashes), useEffect on the server (avoids the SSR warning).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** The centred mark + wordmark, over the photo. */
function Brand({ className }: { className?: string }) {
  return (
    <div
      className={["flex flex-col items-center gap-4 text-center text-white", className]
        .filter(Boolean)
        .join(" ")}
    >
      <img
        src={LOGO_SRC}
        alt=""
        className="size-20 select-none rounded-2xl bg-white/90 p-2.5 ring-1 ring-white/25"
        draggable={false}
      />
      <div className="leading-tight space-y-2">
        <p className="font-heading text-2xl font-bold tracking-tight text-success">
          YADAH
        </p>
        <p className="font-heading text-[0.7rem] font-semibold uppercase tracking-[0.25em] text-white/70">
          Dynamic Enterprise
        </p>
      </div>
    </div>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  // Subtle "bottom sheet" entrance — only on mobile, where the card is docked
  // to the bottom. Driven imperatively (rather than via `initial`) so it plays
  // whether or not the page was server-rendered, and honours reduced motion.
  const sheetControls = useAnimationControls();
  const reduceMotion = useReducedMotion();
  useIsomorphicLayoutEffect(() => {
    const isMobile = window.matchMedia("(max-width: 1023px)").matches;
    if (!isMobile || reduceMotion) return;
    // Start fully below its docked position, then slide up into place.
    sheetControls.set({ y: "100%" });
    sheetControls.start({
      y: 0,
      transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
    });
  }, [sheetControls, reduceMotion]);

  return (
    <main className="relative min-h-dvh w-full overflow-hidden lg:grid lg:grid-cols-2">
      {/* Mobile / tablet only: full-bleed background photo behind the docked
          card, over a dark base so it reads cleanly before the image loads. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-zinc-900 bg-cover bg-center lg:hidden"
        style={{ backgroundImage: LOGIN_BG }}
      />
      {/* Legibility wash — same flat black as the desktop left column. */}
      <div aria-hidden className="absolute inset-0 bg-black/60 lg:hidden" />

      {/* Large screens only: the photo becomes the left column of the grid. */}
      <aside
        className="relative hidden overflow-hidden bg-cover bg-center lg:block"
        style={{ backgroundImage: LOGIN_BG }}
      >
        {/* Dark overlay: adds depth and keeps the content legible over the photo. */}
        <div aria-hidden className="absolute inset-0 bg-black/60" />

        <div className="relative flex h-full flex-col items-center justify-center gap-8 p-10 text-center xl:p-12">
          <Brand />
        </div>
      </aside>

      {/* Theme switcher — floats top-right. */}
      <ThemeToggle className="absolute right-4 top-4 z-20" />

      {/* Layout: card docked to the bottom over the photo on mobile; a plain,
          theme-aware panel filling the right grid column on large screens. */}
      <div className="relative z-10 flex min-h-dvh flex-col justify-end sm:items-center sm:justify-center sm:p-6 lg:min-h-0 lg:bg-white lg:p-0 dark:lg:bg-zinc-950">
        {/* Below lg the brand sits on the photo, in the space above the card —
            at lg the left column carries it, so it drops out here. It takes the
            free height only while the card is docked to the bottom (max-sm);
            once the card centres it just rides directly above it. */}
        <div className="flex items-center justify-center p-8 max-sm:flex-1 lg:hidden">
          <Brand />
        </div>

        {/* Below lg: a translucent, theme-aware card. At lg: chrome falls away
            and it becomes a centered form panel. */}
        <motion.section
          initial={false}
          animate={sheetControls}
          className="login-sheet relative w-full overflow-hidden text-foreground max-lg:rounded-t-[2.5rem] max-lg:bg-white max-lg:px-6 max-lg:pb-[max(2rem,env(safe-area-inset-bottom))] max-lg:pt-8 max-lg:ring-1 max-lg:ring-black/5 max-lg:backdrop-blur-xl sm:max-w-md sm:max-lg:rounded-[2rem] sm:max-lg:pb-8 lg:max-w-sm lg:px-6 lg:py-12 dark:max-lg:bg-zinc-950/85 dark:max-lg:ring-white/10"
        >
          <div className="relative z-10">{children}</div>
        </motion.section>
      </div>
    </main>
  );
}
