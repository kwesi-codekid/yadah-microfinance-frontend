import {
  CameraIcon,
  CheckCircle2Icon,
  Loader2Icon,
  SwitchCameraIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

/**
 * One picture on a record — a customer's photo, a side of their ID, the
 * signature on an agreement — taken on the spot or chosen from a file, and
 * uploaded the moment it is chosen so the form that follows only carries a
 * URL. Every form that needs a picture draws this rather than its own.
 */

export type UploadKind = "photo" | "document" | "signature";


export type Slot = {
  status: "idle" | "uploading" | "done" | "error";
  url?: string;
  publicId?: string;
  preview?: string;
  error?: string;
  /** Uploaded in this session, so removing it should delete it from storage. */
  fresh?: boolean;
};

export const IDLE: Slot = { status: "idle" };

/** An image already on the record — shown as done, but not ours to delete. */
export function existing(url?: string): Slot {
  return url ? { status: "done", url, preview: url } : IDLE;
}

const MAX_BYTES = 5 * 1024 * 1024;

/** Upload into a slot. Resolves to whether the image is now on the server. */
async function uploadTo(
  kind: UploadKind,
  file: File,
  set: (s: Slot) => void,
): Promise<boolean> {
  if (file.size > MAX_BYTES) {
    set({ status: "error", error: "That file is larger than 5 MB." });
    return false;
  }
  const preview = URL.createObjectURL(file);
  set({ status: "uploading", preview });
  try {
    const body = new FormData();
    body.append("image", file);
    const res = await fetch(`/uploads?kind=${kind}`, { method: "POST", body });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      set({
        status: "error",
        preview,
        error: e.error ?? "Upload failed. Try again.",
      });
      return false;
    }
    const { url, publicId } = (await res.json()) as {
      url: string;
      publicId: string;
    };
    set({ status: "done", url, publicId, preview, fresh: true });
    return true;
  } catch {
    set({ status: "error", preview, error: "Network error. Try again." });
    return false;
  }
}

/**
 * Upload over a slot that already holds an image. If the new one fails the old
 * one stays — a scan that backs an open loan must never end up blank because a
 * replacement did not take. One uploaded earlier this session is deleted from
 * storage once it has been replaced.
 */
async function replaceUpload(
  kind: UploadKind,
  file: File,
  previous: Slot,
  set: (s: Slot) => void,
) {
  const ok = await uploadTo(kind, file, (next) =>
    set(
      next.status === "error"
        ? { ...previous, ...(next.error ? { error: next.error } : {}) }
        : next,
    ),
  );
  if (ok && previous.fresh) {
    if (previous.publicId) {
      void fetch(`/uploads?publicId=${encodeURIComponent(previous.publicId)}`, {
        method: "DELETE",
      });
    }
    if (previous.preview) URL.revokeObjectURL(previous.preview);
  }
}

function removeUpload(slot: Slot, set: (s: Slot) => void) {
  // Only images uploaded in this session are ours to delete. Deleting one that
  // is already on the saved record would leave the record pointing at nothing.
  if (slot.fresh && slot.publicId) {
    void fetch(`/uploads?publicId=${encodeURIComponent(slot.publicId)}`, {
      method: "DELETE",
    });
  }
  if (slot.fresh && slot.preview) URL.revokeObjectURL(slot.preview);
  set(IDLE);
}

/**
 * One image slot in the left rail: the customer photo, or a side of the ID.
 * Every slot can be filled from a file or taken on the spot, because that is
 * how the branch actually captures them — a clerk with a phone and the card in
 * their hand. A slot backing an open loan or agreement can be replaced with a
 * clearer picture but not emptied.
 */
export function ScanDrop({
  label,
  kind,
  slot,
  onChange,
  captureTitle,
  frame,
  required,
  locked,
  facingMode = "environment",
}: {
  label: string;
  kind: UploadKind;
  slot: Slot;
  onChange: (s: Slot) => void;
  /** What the camera dialog says it is about to take. */
  captureTitle: string;
  /**
   * Sizing class for the filled frame — an ID card is not shaped like a
   * portrait. The empty dropzone keeps a fixed height instead, so a blank
   * slot never takes more room than the picture it is waiting for.
   */
  frame: string;
  required?: boolean;
  /** The image backs open credit: replaceable, not removable. */
  locked?: boolean;
  facingMode?: "user" | "environment";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  /** A replacement never blanks a slot that already holds something. */
  function accept(file: File) {
    void (slot.status === "done"
      ? replaceUpload(kind, file, slot, onChange)
      : uploadTo(kind, file, onChange));
  }

  const filled = slot.status === "done" || slot.status === "uploading";
  const done = slot.status === "done";

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-2 text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </p>

      {filled ? (
        <div
          className={cn(
            "relative overflow-hidden rounded-lg border border-border",
            frame,
          )}
        >
          {slot.preview && (
            <img
              src={slot.preview}
              alt={label}
              className="size-full object-cover"
            />
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-foreground/40">
            {slot.status === "uploading" ? (
              <Loader2Icon className="size-6 animate-spin text-white" />
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success px-2.5 py-1 text-xs font-medium text-success-foreground">
                <CheckCircle2Icon className="size-3.5" /> Uploaded
              </span>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex h-36 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 text-center transition-colors",
            slot.status === "error"
              ? "border-destructive/50 bg-destructive/5"
              : "border-border hover:border-primary/40 hover:bg-accent/50",
          )}
        >
          <UploadIcon className="size-5 text-muted-foreground" />
          <span className="text-sm font-medium">Choose a file</span>
          <span className="text-xs text-muted-foreground">
            JPEG, PNG or WebP · up to 5 MB
          </span>
        </button>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCameraOpen(true)}
        >
          <CameraIcon /> {done ? "Retake" : "Take picture"}
        </Button>
        {done && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => inputRef.current?.click()}
            >
              <UploadIcon /> Replace
            </Button>
            {!locked && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeUpload(slot, onChange)}
              >
                <XIcon /> Remove
              </Button>
            )}
          </>
        )}
      </div>

      {slot.error && (
        <p className="mt-2 text-xs text-destructive">{slot.error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) accept(file);
          e.target.value = "";
        }}
      />

      <CameraDialog
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        title={captureTitle}
        facingMode={facingMode}
        onCapture={(file) => {
          setCameraOpen(false);
          accept(file);
        }}
      />
    </div>
  );
}

/**
 * A live-camera capture dialog.
 *
 * The office laptop has a built-in webcam and often a second one on a stand,
 * and a phone has a lens on each side — so which camera opens first is a
 * guess, and the dialog offers to move to the next one rather than making
 * anyone close it and start again. Device labels are only readable once
 * permission has been granted, so the list is read after the first stream.
 */
function CameraDialog({
  open,
  onOpenChange,
  onCapture,
  title,
  facingMode = "environment",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (file: File) => void;
  title: string;
  /** Which lens to prefer before anyone has chosen one. */
  facingMode?: "user" | "environment";
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  /** The camera asked for. Null means "whichever matches facingMode". */
  const [deviceId, setDeviceId] = useState<string | null>(null);
  /** The camera actually streaming, which is where cycling counts from. */
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      // Reopening should start from the preferred lens, not the last one used.
      setDeviceId(null);
      setActiveId(null);
      setCameras([]);
      return;
    }
    setError(null);
    setReady(false);
    let cancelled = false;

    const video: MediaTrackConstraints = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode };

    navigator.mediaDevices
      ?.getUserMedia({ video, audio: false })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setActiveId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? null);
        const el = videoRef.current;
        if (el) {
          el.srcObject = stream;
          void el
            .play()
            .then(() => setReady(true))
            .catch(() => setReady(true));
        }
        const all = await navigator.mediaDevices
          .enumerateDevices()
          .catch(() => [] as MediaDeviceInfo[]);
        if (!cancelled) setCameras(all.filter((d) => d.kind === "videoinput"));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Camera access was blocked. Allow it in the browser, or choose a file instead."
            : "That camera could not be opened. Try another, or choose a file instead.",
        );
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, deviceId, facingMode]);

  /** Move to the next camera, wrapping round. */
  function nextCamera() {
    if (cameras.length < 2) return;
    const at = cameras.findIndex((c) => c.deviceId === activeId);
    const next = cameras[(at + 1) % cameras.length];
    if (next) setDeviceId(next.deviceId);
  }

  function capture() {
    const el = videoRef.current;
    if (!el?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(el, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob)
          onCapture(new File([blob], "capture.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.9,
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Line it up in frame, then capture. It is saved to the record as a
            JPEG.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : (
          <div className="relative overflow-hidden rounded-lg border border-border bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              className="aspect-video w-full object-cover"
            />
            {cameras.length > 1 && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="absolute top-2 right-2"
                onClick={nextCamera}
              >
                <SwitchCameraIcon /> Switch camera
              </Button>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={capture}
            disabled={!ready || Boolean(error)}
          >
            <CameraIcon /> Capture
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
