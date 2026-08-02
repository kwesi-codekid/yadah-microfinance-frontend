import { useEffect, useLayoutEffect } from "react";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { ThemeToggle } from "~/components/theme-toggle";

const LOGIN_BG = "url('/money.jpg')";

const LOGO_SRC = "/favicon.png";

export const AUTH_FIELD_CLASS =
  "min-h-[40px] rounded-md dark:bg-white/5 border-2 border-success/50 focus:ring-0";

export const AUTH_SUBMIT_CLASS = "rounded-md bg-success/90 text-white";

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

      <div className="relative z-10 flex min-h-dvh flex-col justify-end sm:items-center sm:justify-center sm:p-6 lg:min-h-0 lg:bg-white lg:p-0 dark:lg:bg-zinc-950">
        <div className="flex items-center justify-center p-8 max-sm:flex-1 lg:hidden">
          <Brand />
        </div>

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
