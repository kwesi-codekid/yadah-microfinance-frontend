import { useEffect } from "react";
import { PrefetchPageLinks, useNavigate } from "react-router";

import { SplashScreen } from "~/components/splash-screen";
import {
  DEFAULT_LANDING,
  getOptionalUser,
  LOGIN_PATH,
} from "~/lib/session.server";
import type { Route } from "./+types/splash";

/** How long the ring takes to close. Also how long this screen stays up. */
const SPLASH_MS = 2000;

/** Per tab, not per device: the moment is for opening the app, not every visit. */
const SEEN_KEY = "yadah.splashSeen";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Yadah Dynamic Enterprise" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getOptionalUser(request);
  return { destination: user ? DEFAULT_LANDING : LOGIN_PATH };
}

export default function Splash({ loaderData }: Route.ComponentProps) {
  const { destination } = loaderData;
  const navigate = useNavigate();

  useEffect(() => {
    let seen = false;
    try {
      seen = window.sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      // Private browsing, or storage switched off. Show the splash.
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wait = seen || reduced ? 0 : SPLASH_MS;

    const timer = setTimeout(() => {
      try {
        window.sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        // Not being able to remember only costs one more splash.
      }
      navigate(destination, { replace: true });
    }, wait);

    return () => clearTimeout(timer);
  }, [destination, navigate]);

  return (
    <>
      {/* Load the next page's assets while the ring closes, so the hand-off
          lands on a rendered screen rather than a spinner. */}
      <PrefetchPageLinks page={destination} />
      <SplashScreen durationMs={SPLASH_MS} />
    </>
  );
}
