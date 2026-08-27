import { CameraOffIcon, Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

/**
 * Read barcodes off the device camera and hand each one to `onScan`.
 *
 * Uses the browser's own `BarcodeDetector` where it exists (Chrome, Edge,
 * Android) and a WebAssembly ponyfill everywhere else, loaded only in the
 * browser and only when the camera is opened — the till must render on the
 * server and must not carry a decoder for cashiers who scan with a gun.
 *
 * The dialog stays open after a read so a basket of several items is one
 * session, not one permission prompt per item. The same code is not reported
 * twice within `REPEAT_MS` — a barcode held in front of the lens is one scan,
 * however many frames it appears in.
 */
const REPEAT_MS = 1800;
const FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "qr_code",
  "itf",
] as const;

type Phase = "starting" | "live" | "denied" | "unavailable";

export function CameraScanner({
  open,
  onOpenChange,
  onScan,
  lastResult,
  title = "Scan with the camera",
  description = "Hold the label inside the frame. Each read adds one to the order.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Returns true when the code matched something on the shelf. */
  onScan: (code: string) => boolean;
  /** What the till made of the last scan, shown under the viewfinder. */
  lastResult: { ok: boolean; text: string } | null;
  title?: string;
  description?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open && <Viewfinder onScan={onScan} />}
        <p
          aria-live="polite"
          className={cn(
            "min-h-5 text-sm",
            lastResult
              ? lastResult.ok
                ? "text-success"
                : "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {lastResult ? lastResult.text : "Looking for a barcode…"}
        </p>
      </DialogContent>
    </Dialog>
  );
}

function Viewfinder({ onScan }: { onScan: (code: string) => boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [flash, setFlash] = useState<"ok" | "miss" | null>(null);
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let frame = 0;
    const recent = new Map<string, number>();

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase("unavailable");
        return;
      }

      // Native where present, otherwise the ponyfill. Either way the import is
      // deferred so nothing camera-shaped reaches the server bundle.
      const { BarcodeDetector } = await import("barcode-detector/ponyfill");
      const detector = new BarcodeDetector({ formats: [...FORMATS] });

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        setPhase("denied");
        return;
      }
      if (stopped || !video.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.current.srcObject = stream;
      await video.current.play();
      setPhase("live");

      const tick = async () => {
        if (stopped) return;
        const el = video.current;
        if (el && el.readyState >= 2) {
          try {
            const codes = await detector.detect(el);
            const now = performance.now();
            for (const code of codes) {
              const value = code.rawValue.trim();
              if (!value) continue;
              const seen = recent.get(value);
              if (seen && now - seen < REPEAT_MS) continue;
              recent.set(value, now);
              const ok = handler.current(value);
              setFlash(ok ? "ok" : "miss");
              setTimeout(() => setFlash(null), 500);
            }
          } catch {
            // A frame that fails to decode is just a frame; the next one may not.
          }
        }
        frame = window.setTimeout(tick, 120);
      };
      tick();
    })();

    return () => {
      stopped = true;
      clearTimeout(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="relative aspect-4/3 overflow-hidden rounded-xl bg-foreground">
      <video
        ref={video}
        muted
        playsInline
        className={cn(
          "size-full object-cover transition-opacity",
          phase === "live" ? "opacity-100" : "opacity-0",
        )}
      />

      {phase === "live" && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-6 rounded-lg border-2 transition-colors",
            flash === "ok"
              ? "border-success"
              : flash === "miss"
                ? "border-destructive"
                : "border-background/80",
          )}
        >
          <span className="pos-camline absolute inset-x-2 top-0 h-px bg-brand-coral shadow-[0_0_6px_1px_var(--brand-coral)]" />
        </div>
      )}

      {phase !== "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-background">
          {phase === "starting" ? (
            <>
              <Loader2Icon className="size-5 animate-spin" />
              Starting the camera…
            </>
          ) : (
            <>
              <CameraOffIcon className="size-5" />
              {phase === "denied"
                ? "Camera access was refused. Allow it in the browser's site settings, then try again."
                : "This browser can't open a camera. Use a scanner or search by name."}
            </>
          )}
        </div>
      )}

      <style>{`
        @keyframes pos-cam { from { top: 0 } to { top: calc(100% - 1px) } }
        @media (prefers-reduced-motion: no-preference) {
          .pos-camline { animation: pos-cam 2s ease-in-out infinite alternate; }
        }
      `}</style>
    </div>
  );
}
