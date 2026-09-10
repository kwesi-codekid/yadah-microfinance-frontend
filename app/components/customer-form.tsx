import {
  CameraIcon,
  CheckCircle2Icon,
  Loader2Icon,
  SwitchCameraIcon,
  TriangleAlertIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Form, Link, useNavigation } from "react-router";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { DateField } from "~/components/ui/date-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { toDay } from "~/lib/customer-form";
import {
  GENDER_OPTIONS,
  ID_NUMBER_RULES,
  ID_TYPE_OPTIONS,
  MARITAL_OPTIONS,
  checkIdNumber,
  type Customer,
  type IdType,
} from "~/lib/customers";
import { cn } from "~/lib/utils";

/**
 * The customer record, as one form. Registration and editing post identical
 * field names — `~/lib/customer-form` parses both — so they share this rather
 * than keeping two copies of twenty-odd fields in step by hand.
 */
export function CustomerForm({
  mode,
  customer,
  collectors = [],
  error,
  details,
  idDocumentHeldBy,
  cancelTo,
}: {
  mode: "create" | "edit";
  /** The record being edited; prefills every field. Omitted when registering. */
  customer?: Customer;
  /**
   * The active collectors a new customer can be put on. Only read when
   * registering: an edit cannot move a round, so it is not offered the choice.
   */
  collectors?: { id: string; name: string }[];
  /** The action's error message, if the last submission was rejected. */
  error?: string;
  /** `VALIDATION_ERROR` issues from the API, listed under the message. */
  details?: unknown;
  /**
   * Set when the record backs an open loan or hire-purchase agreement — "an
   * open loan", say. The ID scans can then be replaced but not removed, so
   * the rail stops offering to remove them.
   */
  idDocumentHeldBy?: string | null;
  cancelTo: string;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const editing = mode === "edit";

  const [front, setFront] = useState<Slot>(() =>
    existing(customer?.idDocumentFrontUrl),
  );
  const [back, setBack] = useState<Slot>(() =>
    existing(customer?.idDocumentBackUrl),
  );
  const [photo, setPhoto] = useState<Slot>(() => existing(customer?.photoUrl));

  // The photo is the one image the record cannot be saved without. The ID
  // scans are optional here and gate credit instead, which the footer says.
  const photoReady = photo.status === "done";
  const idSides = [front, back].filter((s) => s.status === "done").length;
  const uploading = [front, back, photo].some((s) => s.status === "uploading");

  // The API checks the ID number against the format for its type. Catching it
  // here saves a round trip and points at the field that is actually wrong.
  const [idType, setIdType] = useState<IdType | undefined>(
    customer?.identification?.idType,
  );
  const [idNumber, setIdNumber] = useState(
    customer?.identification?.idNumber ?? "",
  );
  const idIssue =
    idType && idNumber.trim() ? checkIdNumber(idType, idNumber) : null;

  const collectorOptions = collectors.map((c) => ({
    value: c.id,
    label: c.name,
  }));

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  return (
    <Form
      method="post"
      onSubmit={(e) => {
        if (!photoReady) {
          e.preventDefault();
          toast.error("Add the customer photo first.");
          return;
        }
        if (idIssue) {
          e.preventDefault();
          toast.error(idIssue);
        }
      }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-2xl font-bold tracking-tight">
          {editing ? `Edit ${customer?.fullName}` : "Register Customer"}
        </h2>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">{error}</p>
            <ValidationIssues details={details} />
          </div>
        </div>
      )}

      {/* Hidden fields carry the uploaded URLs into the submission. */}
      <input type="hidden" name="photoUrl" value={photo.url ?? ""} />
      <input type="hidden" name="idDocumentFrontUrl" value={front.url ?? ""} />
      <input type="hidden" name="idDocumentBackUrl" value={back.url ?? ""} />

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Left rail: the face on the record, beside the details it belongs to.
            The ID scans sit at the foot of the form instead — they are the last
            thing captured and the two sides read as a pair. */}
        <div>
          <ScanDrop
            label="Photo"
            kind="photo"
            slot={photo}
            onChange={setPhoto}
            captureTitle="Take the customer photo"
            frame="aspect-[4/5]"
            facingMode="user"
            required
          />
        </div>

        {/* Right: the record. Spacing is deliberately tight — the whole form
            is meant to sit on one screen at desk size, without scrolling. */}
        <div className="space-y-5">
          <Section title="Identity">
            <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
              <Fld label="Full name" required>
                <CapsInput
                  name="fullName"
                  defaultValue={customer?.fullName}
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="off"
                />
              </Fld>
              <Fld label="Date of birth">
                <DateField
                  name="dateOfBirth"
                  defaultValue={toDay(customer?.dateOfBirth)}
                  placeholder="DD/MM/YYYY"
                  matcher={{ after: new Date() }}
                  startMonth={new Date(1920, 0)}
                  endMonth={new Date()}
                />
              </Fld>
              <Fld label="Gender">
                <SelectField
                  name="gender"
                  options={GENDER_OPTIONS}
                  defaultValue={customer?.gender}
                />
              </Fld>
              <Fld label="Marital status">
                <SelectField
                  name="maritalStatus"
                  options={MARITAL_OPTIONS}
                  defaultValue={customer?.maritalStatus}
                />
              </Fld>
              <Fld label="Nationality">
                <CapsInput
                  name="nationality"
                  defaultValue={customer?.nationality ?? "Ghanaian"}
                  maxLength={60}
                />
              </Fld>
              <Fld label="Occupation">
                <CapsInput
                  name="occupation"
                  defaultValue={customer?.occupation}
                  maxLength={120}
                />
              </Fld>
              {/* The number is checked against the format its type carries, so
                  the two sit together rather than in a section of their own. */}
              <Fld label="ID type">
                <SelectField
                  name="idType"
                  options={ID_TYPE_OPTIONS}
                  defaultValue={customer?.identification?.idType}
                  onValueChange={(v) => setIdType(v as IdType)}
                />
              </Fld>
              <Fld
                label="ID number"
                hint={idType ? ID_NUMBER_RULES[idType].hint : undefined}
                issue={idIssue}
              >
                <CapsInput
                  name="idNumber"
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  aria-invalid={idIssue ? true : undefined}
                  minLength={3}
                  maxLength={30}
                  placeholder={
                    idType ? ID_NUMBER_RULES[idType].placeholder : ""
                  }
                />
              </Fld>
            </div>
          </Section>

          <Section title="Contact">
            <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
              <Fld label="Phone" required>
                <Input
                  name="phone"
                  defaultValue={customer?.phone}
                  required
                  inputMode="numeric"
                  pattern="0[25][0-9]{8}"
                />
              </Fld>
              <Fld label="SECONDARY phone">
                <Input
                  name="altPhone"
                  defaultValue={customer?.altPhone}
                  inputMode="numeric"
                  pattern="0[25][0-9]{8}"
                />
              </Fld>
              <Fld
                label="Residential address"
                className="sm:col-span-2 xl:col-span-2"
              >
                <CapsTextarea
                  name="residentialAddress"
                  defaultValue={customer?.residentialAddress}
                  maxLength={300}
                  rows={2}
                />
              </Fld>
            </div>
          </Section>

          {/* Only when registering. A round moves through the admin-only
              reassignment route, which writes an audit entry — `PATCH` on the
              profile ignores the field, so offering it on an edit would be a
              control that silently does nothing. */}
          {!editing && (
            <Section title="Assigned collector">
              <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
                <Fld
                  label="Collector"
                  required
                  hint={
                    collectors.length > 0
                      ? "Whose round this customer joins. Changing it later is an admin job and is recorded against the customer."
                      : undefined
                  }
                >
                  {collectors.length > 0 ? (
                    <SelectField
                      name="assignedCollectorId"
                      options={collectorOptions}
                    />
                  ) : (
                    <p className="pt-2 text-xs text-warning">
                      No active collectors.
                    </p>
                  )}
                </Fld>
              </div>
            </Section>
          )}

          <Section title="Next of kin">
            <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
              <Fld label="Full name">
                <CapsInput
                  name="kinFullName"
                  defaultValue={customer?.nextOfKin?.fullName}
                  maxLength={120}
                />
              </Fld>
              <Fld label="Relationship">
                <CapsInput
                  name="kinRelationship"
                  defaultValue={customer?.nextOfKin?.relationship}
                  maxLength={60}
                  placeholder="Spouse, sibling…"
                />
              </Fld>
              <Fld label="Phone">
                <Input
                  name="kinPhone"
                  defaultValue={customer?.nextOfKin?.phone}
                  inputMode="numeric"
                  pattern="0[25][0-9]{8}"
                  placeholder="0241234567"
                />
              </Fld>
              <Fld label="Address">
                <CapsInput
                  name="kinAddress"
                  defaultValue={customer?.nextOfKin?.address}
                  maxLength={300}
                />
              </Fld>
            </div>
          </Section>

          {/* Both sides of one card, side by side, because that is how they are
              checked — front against back, not one after the other. */}
          <Section title="ID document">
            <div className="grid gap-4 sm:grid-cols-2">
              <ScanDrop
                label="Front"
                kind="document"
                slot={front}
                onChange={setFront}
                captureTitle="Take the front of the ID"
                frame="h-36"
                locked={Boolean(idDocumentHeldBy)}
              />
              <ScanDrop
                label="Back"
                kind="document"
                slot={back}
                onChange={setBack}
                captureTitle="Take the back of the ID"
                frame="h-36"
                locked={Boolean(idDocumentHeldBy)}
              />
            </div>
          </Section>
        </div>
      </div>

      {/* Footer bar, pinned to the foot of the screen. The control that
          finishes the job — and the line saying what is still missing before it
          will work — should never be something you have to go looking for. */}
      <div className="sticky bottom-0 z-10 mt-3 flex flex-wrap items-center justify-between gap-4 border-t border-border bg-background py-4">
        <p
          className={cn(
            "text-sm",
            photoReady && idSides === 2
              ? "text-success"
              : "text-muted-foreground",
          )}
        >
          {photoReady
            ? idSides === 2
              ? "Photo and ID document on file."
              : "Photo on file. The ID document can be added later."
            : "Add the customer photo to save."}
        </p>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link to={cancelTo}>Cancel</Link>
          </Button>
          <Button
            type="submit"
            disabled={submitting || uploading || !photoReady}
          >
            {submitting && <Loader2Icon className="animate-spin" />}
            {editing ? "Save changes" : "Register customer"}
          </Button>
        </div>
      </div>
    </Form>
  );
}

function ValidationIssues({ details }: { details?: unknown }) {
  if (!Array.isArray(details) || details.length === 0) return null;
  return (
    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-destructive/90">
      {details.slice(0, 8).map((issue, i) => {
        const msg =
          issue && typeof issue === "object" && "message" in issue
            ? String((issue as { message: unknown }).message)
            : String(issue);
        return <li key={i}>{msg}</li>;
      })}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="border-t border-border/60 pt-3">{children}</div>
    </section>
  );
}

/** A shadcn Select wired for form submission via its hidden native control. */
function SelectField({
  name,
  options,
  defaultValue,
  onValueChange,
}: {
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}) {
  return (
    <Select
      name={name}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A text input that records in capitals — the branch keeps names, addresses and
 * ID numbers upper-cased. The value is upper-cased again on the server, so it is
 * stored that way regardless of the device keyboard.
 */
function CapsInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      autoCapitalize="characters"
      className={cn("uppercase placeholder:normal-case", className)}
      {...props}
    />
  );
}

/** The textarea twin of `CapsInput`, for the fields that run to a line or two. */
function CapsTextarea({
  className,
  ...props
}: React.ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      autoCapitalize="characters"
      className={cn("uppercase placeholder:normal-case", className)}
      {...props}
    />
  );
}

function Fld({
  label,
  required,
  hint,
  issue,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  /** A failed pre-check. Replaces the hint and reads as an error. */
  issue?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {issue ? (
        <p className="text-xs text-destructive">{issue}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- uploaders --- */

type Slot = {
  status: "idle" | "uploading" | "done" | "error";
  url?: string;
  publicId?: string;
  preview?: string;
  error?: string;
  /** Uploaded in this session, so removing it should delete it from storage. */
  fresh?: boolean;
};

const IDLE: Slot = { status: "idle" };

/** An image already on the record — shown as done, but not ours to delete. */
function existing(url?: string): Slot {
  return url ? { status: "done", url, preview: url } : IDLE;
}

const MAX_BYTES = 5 * 1024 * 1024;

/** Upload into a slot. Resolves to whether the image is now on the server. */
async function uploadTo(
  kind: "photo" | "document",
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
  kind: "photo" | "document",
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
function ScanDrop({
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
  kind: "photo" | "document";
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
