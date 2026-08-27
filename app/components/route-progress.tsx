import { useEffect, useRef, useState } from "react";
import { useNavigation } from "react-router";

/**
 * The thin green line across the top of the window while a page is on its way.
 *
 * Every screen in this app is server-rendered behind a loader, and several of
 * them fan out to three or four API calls before they can paint. Without this
 * the app simply sits there after a click, which reads as a dropped press —
 * so people click again, and the second click is the one that gets blamed.
 *
 * It cannot show real progress: there is no byte count to count against. What
 * it shows is *movement*, easing towards a ceiling it never reaches until the
 * navigation actually lands, at which point it snaps to full and fades. That is
 * the honest shape for an unknown duration — it never claims to be nearly done.
 */

/** Nothing is shown before this. Most navigations land inside it, and a bar
 *  that flashes on for 80ms is noise, not feedback. */
const APPEAR_AFTER_MS = 120;

/** How far the trickle is allowed to creep. The last tenth belongs to arrival. */
const CEILING = 92;

/** Long enough for the filled bar to register before it goes. */
const FADE_AFTER_MS = 260;

export function RouteProgress() {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);

  // Timers live in refs so a re-render mid-navigation never orphans one.
  const appear = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trickle = useRef<ReturnType<typeof setInterval> | null>(null);
  const fade = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearAll = () => {
      if (appear.current) clearTimeout(appear.current);
      if (trickle.current) clearInterval(trickle.current);
      if (fade.current) clearTimeout(fade.current);
      appear.current = trickle.current = fade.current = null;
    };

    if (busy) {
      clearAll();
      appear.current = setTimeout(() => {
        setVisible(true);
        setWidth(12);
        // Decelerating: big steps early, barely moving near the ceiling. The
        // bar stays alive without ever implying the wait is nearly over.
        trickle.current = setInterval(() => {
          setWidth((w) => (w >= CEILING ? w : w + Math.max(0.4, (CEILING - w) / 12)));
        }, 160);
      }, APPEAR_AFTER_MS);
    } else {
      clearAll();
      // Never appeared: leave it alone rather than flashing a completed bar
      // for a navigation nobody was waiting on.
      setVisible((wasVisible) => {
        if (!wasVisible) return false;
        setWidth(100);
        fade.current = setTimeout(() => {
          setVisible(false);
          // Reset only once it is invisible, so the next run starts from the
          // left instead of sliding back across the screen.
          fade.current = setTimeout(() => setWidth(0), 200);
        }, FADE_AFTER_MS);
        return true;
      });
    }

    return clearAll;
  }, [busy]);

  if (!visible && width === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-100 h-[3px]"
    >
      <div
        className="h-full bg-primary transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none"
        style={{ width: `${width}%`, opacity: visible ? 1 : 0 }}
      >
        {/* The leading edge, lit. It is what makes the bar read as travelling
            rather than as a static rule someone left across the top. */}
        <div className="float-right h-full w-24 bg-primary blur-[3px]" />
      </div>
    </div>
  );
}
