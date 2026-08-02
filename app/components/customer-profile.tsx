import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Camera, ChevronDown, Upload, X } from "lucide-react";
import {
  CameraCapture,
  isCameraAvailable,
} from "~/components/camera-capture";
import {
  GENDERS,
  GENDER_LABELS,
  ID_TYPES,
  ID_TYPE_LABELS,
  MARITAL_STATUSES,
  MARITAL_STATUS_LABELS,
  toDateInput,
  type Customer,
} from "~/lib/customer-client";
import { MAX_UPLOAD_BYTES, UPLOAD_TYPES } from "~/lib/customer-form";
import { formatDate } from "~/lib/format";
import { formatGhanaCard, formatGhanaPostGps } from "~/lib/validation";

/** What a `Detail` needs to become an input. Omitted where a value is fixed. */
type EditField = {
  /** Must match the name `readCustomerForm` reads. */
  name: string;
  /** Current value, in the shape the input wants — dates as `YYYY-MM-DD`. */
  value?: string;
  type?: "text" | "date" | "email";
  required?: boolean;
  placeholder?: string;
  inputMode?: "numeric" | "text";
  /** Present for a dropdown; absent for a text input. */
  options?: { value: string; label: string }[];
  /** Uppercase as they type — for the fields whose API pattern demands it. */
  uppercase?: boolean;
  format?: (value: string) => string;
  onChange?: (value: string) => void;
};

const EditContext = createContext<{
  errors: Record<string, string>;
} | null>(null);

export function CustomerProfile({
  customer,
  registrarName,
  editing,
  errors,
  showRecord = true,
  photoSlot,
}: {
  /** Absent when registering — every field then starts blank. */
  customer?: Customer;
  registrarName?: string | null;
  editing: boolean;
  errors?: Record<string, string>;
  showRecord?: boolean;
  photoSlot?: React.ReactNode;
}) {
  const [idType, setIdType] = useState<string>(
    customer?.identification?.idType ?? "",
  );

  const sections = (
    <>
      <DetailSection title="Identity" aside={photoSlot}>
        <Detail
          label="Full name"
          value={customer?.fullName}
          field={{ name: "fullName", value: customer?.fullName, required: true }}
        />
        <Detail
          label="Date of birth"
          value={formatDate(customer?.dateOfBirth)}
          field={{
            name: "dateOfBirth",
            value: toDateInput(customer?.dateOfBirth),
            type: "date",
          }}
        />
        <Detail
          label="Gender"
          value={customer?.gender && GENDER_LABELS[customer.gender]}
          field={{
            name: "gender",
            value: customer?.gender ?? "",
            placeholder: "Select",
            options: GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] })),
          }}
        />
        <Detail
          label="Marital status"
          value={
            customer?.maritalStatus &&
            MARITAL_STATUS_LABELS[customer.maritalStatus]
          }
          field={{
            name: "maritalStatus",
            value: customer?.maritalStatus ?? "",
            placeholder: "Select",
            options: MARITAL_STATUSES.map((m) => ({
              value: m,
              label: MARITAL_STATUS_LABELS[m],
            })),
          }}
        />
        <Detail
          label="Nationality"
          value={customer?.nationality}
          field={{
            name: "nationality",
            value: customer?.nationality,
            placeholder: "Ghanaian",
          }}
        />
        <Detail
          label="Mother's maiden name"
          value={customer?.mothersMaidenName}
          field={{
            name: "mothersMaidenName",
            value: customer?.mothersMaidenName,
          }}
        />
      </DetailSection>

      <DetailSection title="Contact">
        <Detail
          label="Phone"
          value={customer?.phone}
          field={{
            name: "phone",
            value: customer?.phone,
            required: true,
            inputMode: "numeric",
            placeholder: "0241234567",
          }}
        />
        <Detail
          label="Alternate phone"
          value={customer?.altPhone}
          field={{
            name: "altPhone",
            value: customer?.altPhone,
            inputMode: "numeric",
            placeholder: "0501234567",
          }}
        />
        <Detail
          label="Email"
          value={customer?.email}
          field={{ name: "email", value: customer?.email, type: "email" }}
        />
        <Detail
          label="GhanaPost GPS"
          value={customer?.ghanaPostGps}
          field={{
            name: "ghanaPostGps",
            value: customer?.ghanaPostGps,
            placeholder: "GA-183-9832",
            uppercase: true,
            format: formatGhanaPostGps,
          }}
        />
        <Detail
          label="Residential address"
          value={customer?.residentialAddress}
          field={{
            name: "residentialAddress",
            value: customer?.residentialAddress,
          }}
        />
        <Detail
          label="Postal address"
          value={customer?.postalAddress}
          field={{ name: "postalAddress", value: customer?.postalAddress }}
        />
      </DetailSection>

      <DetailSection
        title="Identification"
        hint="Leave blank if you don't have the document to hand — but a type needs its number, and a number needs its type."
      >
        <Detail
          label="ID type"
          value={
            customer?.identification &&
            ID_TYPE_LABELS[customer.identification.idType]
          }
          field={{
            name: "idType",
            value: customer?.identification?.idType ?? "",
            placeholder: "Select",
            options: ID_TYPES.map((t) => ({ value: t, label: ID_TYPE_LABELS[t] })),
            onChange: setIdType,
          }}
        />
        <Detail
          label="ID number"
          value={customer?.identification?.idNumber}
          field={{
            name: "idNumber",
            value: customer?.identification?.idNumber,
            placeholder:
              idType === "ghana-card" ? "GHA-123456789-0" : "As printed on the ID",
            format: idType === "ghana-card" ? formatGhanaCard : undefined,
          }}
        />
        <Detail
          label="Expiry date"
          value={formatDate(customer?.identification?.idExpiryDate)}
          field={{
            name: "idExpiryDate",
            value: toDateInput(customer?.identification?.idExpiryDate),
            type: "date",
          }}
        />
        <Detail
          label="Place of issue"
          value={customer?.identification?.idPlaceOfIssue}
          field={{
            name: "idPlaceOfIssue",
            value: customer?.identification?.idPlaceOfIssue,
          }}
        />
      </DetailSection>

      <DetailSection title="Work">
        <Detail
          label="Occupation"
          value={customer?.occupation}
          field={{ name: "occupation", value: customer?.occupation }}
        />
        <Detail
          label="Employer or business"
          value={customer?.employerOrBusiness}
          field={{
            name: "employerOrBusiness",
            value: customer?.employerOrBusiness,
          }}
        />
        <Detail
          label="Purpose of account"
          value={customer?.purposeOfAccount}
          field={{ name: "purposeOfAccount", value: customer?.purposeOfAccount }}
        />
      </DetailSection>

      <DetailSection
        title="Next of kin"
        hint="The name is what carries the rest — without it, nothing here is recorded."
      >
        <Detail
          label="Full name"
          value={customer?.nextOfKin?.fullName}
          field={{ name: "kinFullName", value: customer?.nextOfKin?.fullName }}
        />
        <Detail
          label="Relationship"
          value={customer?.nextOfKin?.relationship}
          field={{
            name: "kinRelationship",
            value: customer?.nextOfKin?.relationship,
            placeholder: "Spouse, sibling…",
          }}
        />
        <Detail
          label="Phone"
          value={customer?.nextOfKin?.phone}
          field={{
            name: "kinPhone",
            value: customer?.nextOfKin?.phone,
            inputMode: "numeric",
            placeholder: "0241234567",
          }}
        />
        <Detail
          label="Address"
          value={customer?.nextOfKin?.address}
          field={{ name: "kinAddress", value: customer?.nextOfKin?.address }}
        />
      </DetailSection>

      {showRecord && customer && (
        <DetailSection title="Record">
          <Detail
            label="Registered by"
            value={registrarName ?? undefined}
            empty={customer.registeredById ? "Unknown staff" : "—"}
          />
          <Detail label="Customer ID" value={customer.id} mono />
        </DetailSection>
      )}
    </>
  );

  if (!editing) return sections;
  return (
    <EditContext.Provider value={{ errors: errors ?? {} }}>
      {sections}
    </EditContext.Provider>
  );
}

function DetailSection({
  title,
  hint,
  aside,
  children,
}: {
  title: string;
  /** A rule of this group worth stating, shown only while editing it. */
  hint?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const editing = useContext(EditContext) !== null;
  const Grid = editing ? "div" : "dl";

  const grid = `grid min-w-0 grid-cols-1 gap-x-8 gap-y-5 ${
    aside
      ? "flex-1 md:grid-cols-2 2xl:grid-cols-3"
      : "sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
  }`;

  return (
    <section>
      <h2 className="mb-3 border-b border-border pb-1.5 text-xs font-bold uppercase tracking-wide text-muted">
        {title}
      </h2>
      {editing && hint && <p className="-mt-1 mb-3 text-xs text-muted">{hint}</p>}

      {aside ? (
        <div className="flex flex-col gap-x-6 gap-y-4 sm:flex-row">
          <Grid className={grid}>{children}</Grid>
          <div className="w-32 shrink-0">{aside}</div>
        </div>
      ) : (
        <Grid className={grid}>{children}</Grid>
      )}
    </section>
  );
}

/** The label, identical on both sides of the toggle so nothing shifts. */
const DETAIL_LABEL =
  "mb-0.5 block text-xs font-medium uppercase leading-tight tracking-wide text-muted/80";

/** Compact enough for four across, tall enough to tap. */
const DETAIL_INPUT =
  "min-h-9 w-full rounded-md border-2 bg-field px-2.5 text-sm text-foreground outline-none transition-colors";

function Detail({
  label,
  value,
  empty = "—",
  mono,
  field,
}: {
  label: string;
  value?: string;
  /** Shown in place of a blank, e.g. "Unassigned" rather than a dash. */
  empty?: string;
  mono?: boolean;
  /** Makes this cell editable. Without it the value is fixed. */
  field?: EditField;
}) {
  const edit = useContext(EditContext);

  if (edit && field) {
    const error = edit.errors[field.name];
    const id = `field-${field.name}`;
    const border = error
      ? "border-red-500 dark:border-red-500"
      : "border-border focus:border-success";

    return (
      <div className="min-w-0">
        <label htmlFor={id} className={DETAIL_LABEL}>
          {label}
          {field.required && (
            <span className="text-red-600 dark:text-red-400" aria-hidden="true">
              {" "}
              *
            </span>
          )}
        </label>

        {field.options ? (
          <div className="relative">
            <select
              id={id}
              name={field.name}
              defaultValue={field.value ?? ""}
              key={field.value}
              onChange={(e) => field.onChange?.(e.currentTarget.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              className={`${DETAIL_INPUT} ${border} appearance-none py-1 pr-8`}
            >
              <option value="">{field.placeholder ?? "Select"}</option>
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-2.5 my-auto text-muted"
            />
          </div>
        ) : (
          <input
            id={id}
            name={field.name}
            type={field.type ?? "text"}
            defaultValue={field.value ?? ""}
            key={field.value}
            placeholder={field.placeholder}
            inputMode={field.inputMode}
            autoComplete="off"
            onInput={
              field.format
                ? (e) => {
                    const el = e.currentTarget;
                    const next = field.format!(el.value);
                    if (next !== el.value) el.value = next;
                  }
                : undefined
            }
            aria-required={field.required || undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className={`${DETAIL_INPUT} ${border} ${
              field.uppercase ? "uppercase placeholder:normal-case" : ""
            }`}
          />
        )}

        {error && (
          <p
            id={`${id}-error`}
            role="alert"
            className="text-sm text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}
      </div>
    );
  }

  const Term = edit ? "p" : "dt";
  const Desc = edit ? "p" : "dd";

  return (
    <div className="min-w-0">
      <Term className={DETAIL_LABEL}>{label}</Term>
      <Desc
        className={`text-sm leading-snug ${value ? "text-foreground" : "text-muted"} ${
          mono ? "break-all font-mono text-xs" : "truncate"
        }`}
        title={value || undefined}
      >
        {value || empty}
      </Desc>
    </div>
  );
}

export function ImageView({
  title,
  url,
  compact,
}: {
  title: string;
  url?: string;
  /** Square and label-sized, for standing among the fields. */
  compact?: boolean;
}) {
  const frame = compact
    ? "aspect-square w-full rounded-md object-cover"
    : "h-auto max-h-64 w-full rounded-lg object-contain";

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      {compact ? (
        <span className={DETAIL_LABEL}>{title}</span>
      ) : (
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      )}

      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          <img
            src={url}
            alt={title}
            className={`${frame} border border-border transition-opacity hover:opacity-90`}
          />
        </a>
      ) : (
        <p
          className={[
            "flex items-center justify-center rounded-md border-2 border-dashed border-border text-xs text-muted",
            compact ? "aspect-square w-full" : "h-32 w-full",
          ].join(" ")}
        >
          None
        </p>
      )}
    </div>
  );
}

export function UploadSlot({
  field,
  title,
  hint,
  currentUrl,
  error,
  onSelect,
  compact,
  camera,
}: {
  field: string;
  title: string;
  /** The format rules, under the heading. Not shown when `compact`. */
  hint?: string;
  currentUrl?: string;
  error?: string;
  /** Tells the parent whether this slot is holding a file to send. */
  onSelect: (hasFile: boolean) => void;
  compact?: boolean;
  camera?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const [seenUrl, setSeenUrl] = useState(currentUrl);
  if (currentUrl !== seenUrl) {
    setSeenUrl(currentUrl);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputId = `upload-${field}`;

  const [cameraOpen, setCameraOpen] = useState(false);
  const [canUseCamera, setCanUseCamera] = useState(false);
  useEffect(() => {
    if (camera) setCanUseCamera(isCameraAvailable());
  }, [camera]);

  /** Take a file from either route — the picker or a drop — and preview it. */
  function accept(file: File) {
    if (!UPLOAD_TYPES.includes(file.type))
      return setLocalError("Use a JPEG, PNG or WebP image.");
    if (file.size > MAX_UPLOAD_BYTES)
      return setLocalError("File must be 5 MB or smaller.");
    setLocalError(null);
    onSelect(true);
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.readAsDataURL(file);
  }

  /** Drop the pending file: clearing the input's value un-queues it too. */
  function remove() {
    if (inputRef.current) inputRef.current.value = "";
    setPreview(null);
    setLocalError(null);
    onSelect(false);
  }

  function receive(file: File) {
    if (inputRef.current) {
      const carrier = new DataTransfer();
      carrier.items.add(file);
      inputRef.current.files = carrier.files;
    }
    accept(file);
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) receive(file);
  }

  const imageClass = compact
    ? "aspect-square w-full rounded-md border border-border object-cover"
    : "h-auto max-h-64 w-full rounded-lg border border-border object-contain";

  return (
    <div
      className={
        compact
          ? "space-y-1"
          : "space-y-3 rounded-lg border-2 border-border bg-surface p-4"
      }
    >
      {compact ? (
        <span className={DETAIL_LABEL}>{title}</span>
      ) : (
        !preview &&
        !currentUrl && (
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
          </div>
        )
      )}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        name={field}
        accept="image/jpeg,image/png,image/webp"
        aria-label={title}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) {
            setPreview(null);
            return onSelect(false);
          }
          accept(file);
        }}
        className={preview ? "hidden" : "peer sr-only"}
      />

      {preview ? (
        <figure className={compact ? "space-y-1" : "space-y-1.5"}>
          <div className="relative">
            <img
              src={preview}
              alt={`${title} to be uploaded`}
              className={imageClass}
            />
            <button
              type="button"
              onClick={remove}
              aria-label={`Remove the selected ${title.toLowerCase()}`}
              title="Remove"
              className={[
                "absolute flex items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80",
                compact ? "right-1 top-1 size-6" : "right-2 top-2 size-7",
              ].join(" ")}
            >
              <X size={compact ? 12 : 14} />
            </button>
          </div>
          <figcaption
            className={`font-medium text-success ${compact ? "text-xs" : "text-xs"}`}
          >
            {compact ? "Not uploaded yet" : "Selected — not uploaded yet"}
          </figcaption>
        </figure>
      ) : (
        <label
          htmlFor={inputId}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={[
            "block cursor-pointer border-2 border-dashed text-center transition-colors",
            "peer-focus-visible:border-success peer-focus-visible:ring-2 peer-focus-visible:ring-success/30",
            compact
              ? "relative flex aspect-square w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-md p-2"
              : "rounded-lg p-3",
            dragging
              ? "border-success bg-success/10"
              : "border-border hover:border-success/60 hover:bg-background",
          ].join(" ")}
        >
          {currentUrl &&
            (compact ? (
              <img
                src={currentUrl}
                alt={`Current ${title.toLowerCase()}`}
                className="absolute inset-0 size-full rounded-md object-cover"
              />
            ) : (
              <img
                src={currentUrl}
                alt={`Current ${title.toLowerCase()}`}
                className="mb-3 h-auto max-h-64 w-full rounded-lg border border-border object-contain"
              />
            ))}

          {compact ? (
            !currentUrl && (
              <>
                <Upload size={16} className="text-muted" aria-hidden="true" />
                <span className="text-xs font-medium text-foreground">
                  {canUseCamera ? "Choose file" : "Add photo"}
                </span>
              </>
            )
          ) : (
            <span className="flex flex-col items-center gap-1 py-3">
              <Upload size={18} className="text-muted" aria-hidden="true" />
              <span className="text-xs font-medium text-foreground">
                {currentUrl
                  ? "Click or drop an image to replace"
                  : "Click to choose a file, or drop one here"}
              </span>
              {!currentUrl && (
                <span className="text-xs text-muted">
                  JPEG, PNG or WebP · up to 5 MB
                </span>
              )}
            </span>
          )}
        </label>
      )}

      {canUseCamera && (
        <>
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            className={[
              "flex w-full items-center justify-center gap-1.5 rounded-md border-2 border-border font-medium text-foreground transition-colors hover:border-success/60 hover:bg-background",
              compact ? "min-h-7 text-xs" : "min-h-8 text-xs",
            ].join(" ")}
          >
            <Camera size={compact ? 12 : 14} aria-hidden="true" />
            {preview || currentUrl ? "Retake" : "Take photo"}
          </button>

          <CameraCapture
            isOpen={cameraOpen}
            onOpenChange={setCameraOpen}
            title={`Take ${title.toLowerCase()}`}
            fileName={`${field}.jpg`}
            onCapture={receive}
          />
        </>
      )}

      {!compact && !preview && currentUrl && (
        <a
          href={currentUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-xs text-muted underline hover:text-foreground"
        >
          View full size
        </a>
      )}

      {(localError || error) && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {localError ?? error}
        </p>
      )}
    </div>
  );
}
