import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Camera, RotateCcw, SwitchCamera } from "lucide-react";
import { ConfirmModal } from "~/components/modals";

/**
 * Take a photo with the device camera, in a dialog.
 *
 * A live preview big enough to frame a face — which is why this is a modal and
 * not something rendered inside the 8rem slot it fills. Registration happens
 * with the customer standing there, so the camera is the primary way a photo
 * gets on the record; picking a file is the fallback, not the other way round.
 *
 * The capture is handed back as a `File`, so the caller can put it through the
 * same path as a dropped or chosen file and nothing downstream needs to know
 * where it came from.
 *
 * **Secure context required.** `getUserMedia` is undefined over plain HTTP on
 * anything but `localhost`, so a dev server reached at `http://192.168.x.x`
 * from a phone has no camera at all. That is a browser rule, not something the
 * app can opt out of — hence `isCameraAvailable`, so the button can be hidden
 * rather than offered and then failing.
 */

/** Whether this browser will even allow a camera here. */
export function isCameraAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

type Facing = "user" | "environment";

export function CameraCapture({
  isOpen,
  onOpenChange,
  onCapture,
  title = "Take a photo",
  /** Filename for the captured image. The API only cares about the bytes. */
  fileName = "photo.jpg",
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (file: File) => void;
  title?: string;
  fileName?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Front camera by default — this is a portrait of the person at the counter.
  // Phones have a back one worth reaching, laptops generally don't.
  const [facing, setFacing] = useState<Facing>("user");
  const [hasMultiple, setHasMultiple] = useState(false);
  /** The still, held for approval. Nothing is handed back until it's accepted. */
  const [shot, setShot] = useState<{ url: string; file: File } | null>(null);

  /** Drop the stream. Called on close, on unmount, and before reopening. */
  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  // Start when the dialog opens, and whenever the chosen camera changes. The
  // effect owns the stream's whole life: every exit path runs `stop`, so the
  // recording light can't stay on after the dialog is dismissed.
  useEffect(() => {
    if (!isOpen || shot) return;

    let cancelled = false;

    async function start() {
      setError(null);
      if (!isCameraAvailable()) {
        setError(
          "This browser won't allow the camera here. It needs a secure (https) connection.",
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: false,
        });

        // The dialog may have closed while permission was being decided; a
        // stream started for a screen that's gone would just hold the camera.
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Autoplay is unreliable when the element mounts with the dialog;
          // an explicit play() with the rejection swallowed is the honest
          // version of "best effort".
          void videoRef.current.play().catch(() => {});
        }
        setReady(true);

        // Only worth offering a switch when there is something to switch to.
        // Labels are empty until permission is granted, which is why this runs
        // after `getUserMedia` rather than before it.
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled)
          setHasMultiple(
            devices.filter((d) => d.kind === "videoinput").length > 1,
          );
      } catch (cause) {
        if (cancelled) return;
        // The three that actually happen, told apart so the message says what
        // to do rather than "could not start camera".
        const name = cause instanceof Error ? cause.name : "";
        setError(
          name === "NotAllowedError"
            ? "Camera permission was refused. Allow it in your browser's site settings, or choose a file instead."
            : name === "NotFoundError"
              ? "No camera found on this device. Choose a file instead."
              : "The camera could not be started. Choose a file instead.",
        );
      }
    }

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [isOpen, facing, shot, stop]);

  // An object URL for the still has to be revoked or the bitmap leaks. Tied to
  // the shot's own lifetime rather than the dialog's, so retaking releases the
  // previous one immediately.
  useEffect(() => {
    if (!shot) return;
    return () => URL.revokeObjectURL(shot.url);
  }, [shot]);

  function close() {
    stop();
    setShot(null);
    setError(null);
    onOpenChange(false);
  }

  /** Freeze the current frame into a JPEG. */
  function take() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement("canvas");
    // The sensor's own resolution, not the size it happens to be displayed at
    // — the preview is a few hundred pixels wide and an ID photo scaled down
    // to that is worthless.
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");
    if (!context) return;

    // Un-mirror before saving. The preview is flipped because a mirror is what
    // people can aim in; the stored photo must not be, or every ID reads
    // backwards.
    if (facing === "user") {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], fileName, { type: "image/jpeg" });
        setShot({ url: URL.createObjectURL(blob), file });
        // Freed as soon as there is a still to look at — no reason to keep the
        // camera running behind a frozen frame.
        stop();
      },
      "image/jpeg",
      // Enough for a face at sensor resolution while staying well inside the
      // API's 5 MB ceiling.
      0.9,
    );
  }

  return (
    <ConfirmModal
      isOpen={isOpen}
      onOpenChange={(open) => (open ? onOpenChange(true) : close())}
      title={title}
      size="lg"
      closeLabel="Cancel"
      footer={
        shot ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-lg"
              onPress={() => setShot(null)}
            >
              <RotateCcw size={14} />
              Retake
            </Button>
            <Button
              size="sm"
              className="rounded-lg bg-success"
              onPress={() => {
                onCapture(shot.file);
                close();
              }}
            >
              Use this photo
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            className="rounded-lg bg-success"
            isDisabled={!ready}
            onPress={take}
          >
            <Camera size={14} />
            Capture
          </Button>
        )
      }
    >
      <div className="space-y-3">
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {error}
          </p>
        ) : (
          <>
            {/* One box, fixed 4:3, holding either the live feed or the still,
                so approving a shot doesn't resize the dialog under the cursor
                and move the buttons out from under it. */}
            <div className="relative aspect-4/3 w-full overflow-hidden rounded-lg bg-black">
              {shot ? (
                <img
                  src={shot.url}
                  alt="The photo just taken"
                  className="size-full object-contain"
                />
              ) : (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  // Mirrored for the front camera only: aiming a mirror is
                  // intuitive, aiming a back camera through one is not.
                  className={`size-full object-contain ${
                    facing === "user" ? "-scale-x-100" : ""
                  }`}
                />
              )}

              {!ready && !shot && (
                <p className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
                  Starting the camera…
                </p>
              )}
            </div>

            {hasMultiple && !shot && (
              <button
                type="button"
                onClick={() =>
                  setFacing((f) => (f === "user" ? "environment" : "user"))
                }
                className="flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
              >
                <SwitchCamera size={14} aria-hidden="true" />
                Switch camera
              </button>
            )}
          </>
        )}
      </div>
    </ConfirmModal>
  );
}
