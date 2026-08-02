import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Camera, RotateCcw, SwitchCamera } from "lucide-react";
import { ConfirmModal } from "~/components/modals";

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

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
        setReady(true);

        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled)
          setHasMultiple(
            devices.filter((d) => d.kind === "videoinput").length > 1,
          );
      } catch (cause) {
        if (cancelled) return;
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
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");
    if (!context) return;

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
        stop();
      },
      "image/jpeg",
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
