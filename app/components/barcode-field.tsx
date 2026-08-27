import { CameraIcon, ScanBarcodeIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { CameraScanner } from "~/components/camera-scanner";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useBarcodeWedge } from "~/hooks/use-barcode-wedge";
import { cn } from "~/lib/utils";

/**
 * The barcode on an item form. Filled three ways, all landing in the same
 * box: a scanner gun (the page is listening the moment it opens), the camera,
 * or typing the digits off the label.
 *
 * Whatever is scanned replaces what was there — an item has one barcode, and
 * scanning is how you correct a wrong one.
 */
export function BarcodeField({
  name = "barcode",
  defaultValue = "",
  className,
}: {
  name?: string;
  defaultValue?: string;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [camera, setCamera] = useState(false);
  const [justScanned, setJustScanned] = useState(false);

  const { report } = useBarcodeWedge((code) => {
    setValue(code);
    setJustScanned(true);
    setTimeout(() => setJustScanned(false), 1200);
    return true;
  });

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label
        htmlFor={name}
        className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"
      >
        Barcode
        <span className="flex items-center gap-1 text-[10px] font-normal normal-case tracking-normal">
          <span
            aria-hidden
            className="size-1.5 rounded-full bg-brand-coral motion-safe:animate-pulse"
          />
          Scanner live
        </span>
      </Label>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanBarcodeIcon
            className={cn(
              "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 transition-colors",
              justScanned ? "text-success" : "text-muted-foreground",
            )}
          />
          <Input
            id={name}
            name={name}
            value={value}
            onChange={(e) => setValue(e.target.value.trim())}
            placeholder="Scan the label, or type it"
            autoComplete="off"
            inputMode="numeric"
            maxLength={64}
            className={cn(
              "tabular pl-9 pr-8 transition-colors",
              justScanned && "border-success",
            )}
          />
          {value && (
            <button
              type="button"
              onClick={() => setValue("")}
              aria-label="Clear barcode"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCamera(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-medium text-background transition-colors hover:bg-foreground/85 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <CameraIcon className="size-4" />
          Camera
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        {justScanned
          ? "Got it. Scan again to replace it."
          : "Optional. With one, the till adds this item the moment it is scanned."}
      </p>

      <CameraScanner
        open={camera}
        onOpenChange={setCamera}
        onScan={(code) => {
          report(code);
          // One label, one read: the form wants a value, not a session.
          setCamera(false);
          return true;
        }}
        lastResult={null}
        title="Scan the item's barcode"
        description="Hold the label inside the frame. The first read fills the field."
      />
    </div>
  );
}
