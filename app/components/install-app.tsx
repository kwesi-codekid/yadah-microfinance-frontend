import { DownloadIcon, PlusSquareIcon, ShareIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

/**
 * Putting Yadah on the device it is being used on.
 *
 * Two browsers, two different jobs. Chromium decides for itself that the app
 * qualifies and hands over a prompt to fire — so there the control is one tap.
 * Safari on iOS fires nothing and never will: installing is a menu item in the
 * share sheet, so there the control opens directions to it instead.
 *
 * Nothing is drawn at all in an already-installed copy, or in a browser that
 * offers neither route — an install button that cannot install is worse than
 * no button.
 */

/** Chromium's "this qualifies" event. No DOM lib type covers it. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    /** Stashed by the inline script in root.tsx — see the note there. */
    __yadahInstallPrompt?: InstallPromptEvent | null;
  }
}

/** The event that script fires once it has something to hand us. */
const READY = "yadah:installable";

export interface InstallOffer {
  /** Draw the control at all? */
  offered: boolean;
  /** iOS — the control opens directions rather than installing. */
  manual: boolean;
  /** Fire Chromium's prompt. A no-op when `manual`. */
  install: () => Promise<void>;
}

export function useInstallApp(): InstallOffer {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    // An installed copy has nothing to offer. `standalone` is iOS's own flag,
    // which it sets instead of matching the display-mode query.
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (installed) return;

    // The event usually lands before React has hydrated, so the script in the
    // document head catches it and we read what it kept.
    const take = () => setPrompt(window.__yadahInstallPrompt ?? null);
    take();

    const onInstalled = () => {
      window.__yadahInstallPrompt = null;
      setPrompt(null);
      setManual(false);
    };

    window.addEventListener(READY, take);
    window.addEventListener("appinstalled", onInstalled);

    if (isAppleMobile()) setManual(true);

    return () => {
      window.removeEventListener(READY, take);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    // The prompt is single-use either way: a dismissal means Chromium will
    // hand us a fresh one later, so drop this one rather than re-firing it.
    window.__yadahInstallPrompt = null;
    setPrompt(null);
    if (outcome === "dismissed") setManual(false);
  };

  return { offered: prompt !== null || manual, manual: prompt === null && manual, install };
}

/** iPhone, and the iPad that claims to be a Mac. */
function isAppleMobile(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

/**
 * Where the button lives on iOS. Drawn as two steps because that is what it
 * is — the share sheet, then the item down the list — and the icons are the
 * ones actually on the screen they are looking at.
 */
export function InstallInstructions({
  open,
  onOpenChange,
  name = "Yadah",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add {name} to your home screen</DialogTitle>
          <DialogDescription>
            It then opens like any other app on the phone, with no address bar.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-3 text-sm">
          <li className="flex items-start gap-3">
            <ShareIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              Tap <span className="font-medium">Share</span> at the bottom of Safari.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <PlusSquareIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              Scroll down and choose{" "}
              <span className="font-medium">Add to Home Screen</span>.
            </span>
          </li>
        </ol>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The standalone control, for surfaces with no menu to hang off — the portal
 * header. The staff app puts the same offer in the profile menu instead, which
 * composes the pieces above itself.
 */
export function InstallAppButton({
  className,
  name,
  compact = false,
}: {
  className?: string;
  name?: string;
  /** Drop the label on narrow screens, for headers with no room for it. */
  compact?: boolean;
}) {
  const { offered, manual, install } = useInstallApp();
  const [showing, setShowing] = useState(false);

  if (!offered) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={className}
        onClick={() => (manual ? setShowing(true) : install())}
      >
        <DownloadIcon />
        <span className={compact ? "hidden sm:inline" : undefined}>Install app</span>
      </Button>
      <InstallInstructions open={showing} onOpenChange={setShowing} name={name} />
    </>
  );
}
