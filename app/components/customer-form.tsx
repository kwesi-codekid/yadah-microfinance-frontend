import {
  CameraIcon,
  CheckCircle2Icon,
  Loader2Icon,
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
  cancelTo: string;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const editing = mode === "edit";

  const [front, setFront] = useState<Slot>(() => existing(customer?.idDocumentFrontUrl));
  const [back, setBack] = useState<Slot>(() => existing(customer?.idDocumentBackUrl));
  const [photo, setPhoto] = useState<Slot>(() => existing(customer?.photoUrl));

  const idCount = [front, back].filter((s) => s.status === "done").length;
  const imagesReady = photo.status === "done";

  // The API checks the ID number against the format for its type. Catching it
  // here saves a round trip and points at the field that is actually wrong.
  const [idType, setIdType] = useState<IdType | undefined>(
    customer?.identification?.idType,
  );
  const [idNumber, setIdNumber] = useState(customer?.identification?.idNumber ?? "");
  const idIssue =
    idType && idNumber.trim() ? checkIdNumber(idType, idNumber) : null;

  const collectorOptions = collectors.map((c) => ({ value: c.id, label: c.name }));

  // A rejected submission is a toast carrying the API's issues, each named by
  // its field: "expected string" says nothing without the field it was about.
  useEffect(() => {
    if (!error) return;
    const issues = describeIssues(details);
    toast.error(error, {
      description: issues.length ? (
        <ul className="mt-1 space-y-0.5">
          {issues.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : undefined,
      duration: issues.length ? 10_000 : undefined,
    });
  }, [error, details]);

  return (
    <Form
      method="post"
      onSubmit={(e) => {
        if (!imagesReady) {
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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-2xl font-bold tracking-tight">
          {editing ? `Edit ${customer?.fullName}` : "Register Customer"}
        </h2>
      </div>


      {/* Hidden fields carry the uploaded URLs into the submission. */}
      <input type="hidden" name="photoUrl" value={photo.url ?? ""} />
      <input type="hidden" name="idDocumentFrontUrl" value={front.url ?? ""} />
      <input type="hidden" name="idDocumentBackUrl" value={back.url ?? ""} />

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Left rail: the two ID document scans. */}
        <div className="space-y-4">
          <DocDrop label="ID document — front" slot={front} onChange={setFront} />
          <DocDrop label="ID document — back" slot={back} onChange={setBack} />
        </div>

        {/* Right: the record. */}
        <div className="space-y-6">
          <Section title="Identity">
            <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
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
                  placeholder="dd/mm/yyyy"
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

              {/* Photo occupies the fourth column across both rows. */}
              <div className="sm:col-span-2 xl:col-span-1 xl:col-start-4 xl:row-start-1 xl:row-span-2">
                <PhotoDrop slot={photo} onChange={setPhoto} />
              </div>

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
              <Fld label="Mother's maiden name">
                <CapsInput
                  name="mothersMaidenName"
                  defaultValue={customer?.mothersMaidenName}
                  maxLength={120}
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
                  placeholder="0241234567"
                />
              </Fld>
              <Fld label="Alternate phone">
                <Input
                  name="altPhone"
                  defaultValue={customer?.altPhone}
                  inputMode="numeric"
                  pattern="0[25][0-9]{8}"
                  placeholder="0501234567"
                />
              </Fld>
              <Fld label="Email">
                <Input
                  type="email"
                  name="email"
                  defaultValue={customer?.email}
                  placeholder="name@example.com"
                />
              </Fld>
              <Fld label="GhanaPost GPS">
                <CapsInput
                  name="ghanaPostGps"
                  defaultValue={customer?.ghanaPostGps}
                  pattern="[A-Z]{2}-[0-9]{3,4}-[0-9]{4}"
                  placeholder="GA-183-9832"
                />
              </Fld>
              <Fld label="Residential address">
                <CapsInput
                  name="residentialAddress"
                  defaultValue={customer?.residentialAddress}
                  maxLength={300}
                />
              </Fld>
              <Fld label="Postal address">
                <CapsInput
                  name="postalAddress"
                  defaultValue={customer?.postalAddress}
                  maxLength={300}
                />
              </Fld>
            </div>
          </Section>

          <Section title="Identification">
            <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
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
                    idType ? ID_NUMBER_RULES[idType].placeholder : "As printed on the ID"
                  }
                />
              </Fld>
              <Fld label="Expiry date">
                <DateField
                  name="idExpiryDate"
                  defaultValue={toDay(customer?.identification?.idExpiryDate)}
                  placeholder="dd/mm/yyyy"
                  startMonth={new Date(2000, 0)}
                  endMonth={new Date(new Date().getFullYear() + 30, 11)}
                />
              </Fld>
              <Fld label="Place of issue">
                <CapsInput name="idPlaceOfIssue" maxLength={100} />
              </Fld>
            </div>
          </Section>

          <Section title="Work">
            <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
              <Fld label="Occupation">
                <CapsInput
                  name="occupation"
                  defaultValue={customer?.occupation}
                  maxLength={120}
                />
              </Fld>
              <Fld label="Employer or business">
                <CapsInput
                  name="employerOrBusiness"
                  defaultValue={customer?.employerOrBusiness}
                  maxLength={120}
                />
              </Fld>
              <Fld label="Purpose of account">
                <CapsInput
                  name="purposeOfAccount"
                  defaultValue={customer?.purposeOfAccount}
                  maxLength={200}
                />
              </Fld>

              {/* Only when registering. A round moves through the admin-only
                  reassignment route, which writes an audit entry — `PATCH` on the
                  profile ignores the field, so offering it here on an edit would
                  be a control that silently does nothing. */}
              {!editing && (
                <Fld label="Assigned collector" required>
                  {collectors.length > 0 ? (
                    <SelectField name="assignedCollectorId" options={collectorOptions} />
                  ) : (
                    <p className="pt-2 text-xs text-warning">
                      No active collectors. Add one under Staff before registering
                      anyone — a customer with no collector is a customer nobody
                      is due to visit.
                    </p>
                  )}
                </Fld>
              )}
            </div>
          </Section>

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
        </div>
      </div>

      {/* Footer bar. */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
        <p className={cn("text-sm", imagesReady ? "text-success" : "text-muted-foreground")}>
          {!imagesReady
            ? "A customer photo is required. ID document scans are optional."
            : idCount === 2
              ? "Photo and both sides of the ID document are on file."
              : `Photo added. ${idCount} of 2 ID document scans added (optional).`}
        </p>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link to={cancelTo}>Cancel</Link>
          </Button>
          <Button type="submit" disabled={submitting || !imagesReady}>
            {submitting && <Loader2Icon className="animate-spin" />}
            {editing ? "Save changes" : "Register customer"}
          </Button>
        </div>
      </div>
    </Form>
  );
}

/** Friendly names for the API's field paths, so an issue reads as a form label. */
const FIELD_LABELS: Record<string, string> = {
  fullName: "Full name",
  phone: "Phone",
  altPhone: "Alternative phone",
  email: "Email",
  photoUrl: "Photo",
  idDocumentFrontUrl: "ID document — front",
  idDocumentBackUrl: "ID document — back",
  assignedCollectorId: "Assigned collector",
  dateOfBirth: "Date of birth",
  gender: "Gender",
  nationality: "Nationality",
  maritalStatus: "Marital status",
  mothersMaidenName: "Mother's maiden name",
  residentialAddress: "Residential address",
  ghanaPostGps: "GhanaPost GPS",
  postalAddress: "Postal address",
  occupation: "Occupation",
  employerOrBusiness: "Employer / business",
  purposeOfAccount: "Purpose of account",
  identification: "Identification",
  idType: "ID type",
  idNumber: "ID number",
  idPlaceOfIssue: "Place of issue",
  idExpiryDate: "ID expiry date",
  nextOfKin: "Next of kin",
  relationship: "Relationship",
  address: "Address",
};

/**
 * One line per API issue. Each carries the field it is about (`path`) and a
 * message such as "expected string, received undefined"; without the path the
 * message on its own says nothing about what to fix.
 */
function describeIssues(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  return details.slice(0, 12).map((issue) => {
    const obj = issue && typeof issue === "object" ? (issue as Record<string, unknown>) : null;
    const msg = obj && "message" in obj ? String(obj.message) : String(issue);
    const rawPath = obj?.path ?? obj?.field;
    const segments = Array.isArray(rawPath)
      ? rawPath.map(String)
      : typeof rawPath === "string" && rawPath
        ? rawPath.split(".")
        : [];
    const field = segments.map((s) => FIELD_LABELS[s] ?? s).join(" › ");
    return field ? `${field}: ${msg}` : msg;
  });
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-4 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
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
    <Select name={name} defaultValue={defaultValue} onValueChange={onValueChange}>
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
function CapsInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <Input
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

async function uploadTo(
  kind: "photo" | "document",
  file: File,
  set: (s: Slot) => void,
) {
  if (file.size > MAX_BYTES) {
    set({ status: "error", error: "That file is larger than 5 MB." });
    return;
  }
  const preview = URL.createObjectURL(file);
  set({ status: "uploading", preview });
  try {
    const body = new FormData();
    body.append("image", file);
    const res = await fetch(`/uploads?kind=${kind}`, { method: "POST", body });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      set({ status: "error", preview, error: e.error ?? "Upload failed. Try again." });
      return;
    }
    const { url, publicId } = (await res.json()) as { url: string; publicId: string };
    set({ status: "done", url, publicId, preview, fresh: true });
  } catch {
    set({ status: "error", preview, error: "Network error. Try again." });
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

/** Full-width dropzone for the ID document scans. */
function DocDrop({
  label,
  required,
  slot,
  onChange,
}: {
  label: string;
  required?: boolean;
  slot: Slot;
  onChange: (s: Slot) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-2 text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </p>

      {slot.status === "done" || slot.status === "uploading" ? (
        <div className="relative overflow-hidden rounded-lg border border-border">
          {slot.preview && (
            <img src={slot.preview} alt={label} className="h-40 w-full object-cover" />
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
          {slot.status === "done" && (
            <button
              type="button"
              onClick={() => removeUpload(slot, onChange)}
              className="absolute top-2 right-2 rounded-full bg-foreground/70 p-1 text-white hover:bg-foreground"
              aria-label={`Replace ${label}`}
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
            slot.status === "error"
              ? "border-destructive/50 bg-destructive/5"
              : "border-border bg-card hover:border-primary/40 hover:bg-accent/50",
          )}
        >
          <UploadIcon className="size-5 text-muted-foreground" />
          <span className="text-sm font-medium">Click to choose a file, or drop one here</span>
          <span className="text-xs text-muted-foreground">JPEG, PNG or WebP · up to 5 MB</span>
        </button>
      )}

      {slot.status === "error" && slot.error && (
        <p className="mt-2 text-xs text-destructive">{slot.error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadTo("document", file, onChange);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** Compact uploader for the customer photo, with a camera-capture option. */
function PhotoDrop({ slot, onChange }: { slot: Slot; onChange: (s: Slot) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  return (
    <div className="flex h-full w-full flex-col space-y-1.5 sm:w-44">
      <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Photo<span className="ml-0.5 text-destructive">*</span>
      </Label>

      {slot.status === "done" || slot.status === "uploading" ? (
        <div className="relative min-h-32 w-full flex-1 overflow-hidden rounded-lg border border-border">
          {slot.preview && <img src={slot.preview} alt="Customer" className="size-full object-cover" />}
          <div className="absolute inset-0 flex items-center justify-center bg-foreground/30">
            {slot.status === "uploading" ? (
              <Loader2Icon className="size-6 animate-spin text-white" />
            ) : (
              <CheckCircle2Icon className="size-6 text-white" />
            )}
          </div>
          {slot.status === "done" && (
            <button
              type="button"
              onClick={() => removeUpload(slot, onChange)}
              className="absolute top-2 right-2 rounded-full bg-foreground/70 p-1 text-white hover:bg-foreground"
              aria-label="Replace photo"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={cn(
              "flex min-h-28 w-full flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed p-3 text-center transition-colors",
              slot.status === "error"
                ? "border-destructive/50 bg-destructive/5"
                : "border-border bg-card hover:border-primary/40 hover:bg-accent/50",
            )}
          >
            <UploadIcon className="size-5 text-muted-foreground" />
            <span className="text-sm font-medium">Choose file</span>
          </button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={() => setCameraOpen(true)}
          >
            <CameraIcon /> Take photo
          </Button>
        </>
      )}

      {slot.status === "error" && slot.error && (
        <p className="text-xs text-destructive">{slot.error}</p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadTo("photo", file, onChange);
          e.target.value = "";
        }}
      />

      <CameraDialog
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onCapture={(file) => {
          setCameraOpen(false);
          void uploadTo("photo", file, onChange);
        }}
      />
    </div>
  );
}

/** A live-camera capture dialog — "Take photo" opens the device webcam. */
function CameraDialog({
  open,
  onOpenChange,
  onCapture,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setReady(false);
    let cancelled = false;

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play().then(() => setReady(true)).catch(() => setReady(true));
        }
      })
      .catch((e: unknown) => {
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Camera access was blocked. Allow it in the browser, or use Choose file."
            : "No camera was found. Use Choose file instead.",
        );
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], "photo.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.9,
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Take a photo</DialogTitle>
          <DialogDescription>
            Position the customer in frame, then capture. JPEG, saved to the record.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-black">
            <video ref={videoRef} playsInline muted className="aspect-video w-full object-cover" />
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={capture} disabled={!ready || Boolean(error)}>
            <CameraIcon /> Capture
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
