import { createContext, useContext, useRef, useState } from "react";
import { Upload, X, ChevronDown } from "lucide-react";
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

/**
 * The customer record, as a grid of fields that reads or edits.
 *
 * One layout for all three jobs — viewing a record, editing it, and registering
 * a new one — so they can't drift into looking like three different apps. The
 * read-only cells and the inputs that replace them are the same list in the
 * same grid: a field added here appears everywhere at once.
 *
 * `editing` swaps the cells for inputs in place. Registration is simply the
 * editing view with no `customer` behind it, which is why there is no separate
 * "create" mode.
 *
 * The field names match what `readCustomerForm` reads, so whichever route wraps
 * this in a `<Form>` can hand the submission straight to it.
 */

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
};

/**
 * Field errors for the inputs below, so the ~25 `Detail` calls don't each have
 * to be handed the same props. Only provided while editing — a `Detail` with no
 * provider above it renders read-only.
 */
const EditContext = createContext<{
  errors: Record<string, string>;
} | null>(null);

export function CustomerProfile({
  customer,
  collectors = [],
  collectorName,
  editing,
  errors,
  showAssignment = true,
}: {
  /** Absent when registering — every field then starts blank. */
  customer?: Customer;
  /** Active collectors, for the assignment dropdown. Unused when hidden. */
  collectors?: { id: string; name: string }[];
  /** Names the assigned collector in the read-only view. */
  collectorName?: string | null;
  editing: boolean;
  errors?: Record<string, string>;
  /**
   * Off for registration, where a customer starts unassigned, and off for
   * collectors on the record page, who may not reassign anyone.
   */
  showAssignment?: boolean;
}) {
  const sections = (
    <>
      <DetailSection title="Identity">
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
            // The API's pattern demands uppercase; do it as they type rather
            // than rejecting them for it on submit.
            uppercase: true,
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
          }}
        />
        <Detail
          label="ID number"
          value={customer?.identification?.idNumber}
          field={{
            name: "idNumber",
            value: customer?.identification?.idNumber,
            placeholder: "GHA-123456789-0",
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

      {showAssignment && (
        <DetailSection
          title="Assignment"
          hint="Who collects from this customer. Can be left unassigned and set later."
        >
          <Detail
            label="Assigned collector"
            value={
              customer?.assignedCollectorId
                ? (collectorName ?? "Unknown collector")
                : undefined
            }
            empty="Unassigned"
            field={{
              name: "assignedCollectorId",
              value: customer?.assignedCollectorId ?? "",
              placeholder: "Unassigned",
              options: collectors.map((c) => ({ value: c.id, label: c.name })),
            }}
          />
          {/* No `field`: the id is the record's identity, not a detail of it,
              so it stays read-only on both sides of the toggle. There is
              nothing to show before the record exists. */}
          {customer && <Detail label="Customer ID" value={customer.id} mono />}
        </DetailSection>
      )}
    </>
  );

  // The provider is what every `Detail` below reads to decide which of its two
  // faces to render, so reading is simply its absence.
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
  children,
}: {
  title: string;
  /** A rule of this group worth stating, shown only while editing it. */
  hint?: string;
  children: React.ReactNode;
}) {
  const editing = useContext(EditContext) !== null;
  /**
   * A description list when it describes, a plain grid when it collects input:
   * `<dl>` may only hold `<dt>`/`<dd>` pairs, and a label with an input beside
   * it is neither. Same classes either way, so the fields land exactly where
   * the values they replace were sitting.
   */
  const Grid = editing ? "div" : "dl";

  return (
    <section>
      <h2 className="mb-3 border-b border-border pb-1.5 text-xs font-bold uppercase tracking-wide text-muted">
        {title}
      </h2>
      {editing && hint && <p className="-mt-1 mb-3 text-xs text-muted">{hint}</p>}
      {/* The fields flow across as the screen allows — up to four abreast on a
          wide monitor — rather than down in two long columns. Six fields become
          two short rows instead of three, which is most of what keeps the whole
          record on one screen.
          The row gap has to stay well clear of the near-zero gap between a
          label and its own value, or the label reads as belonging to the value
          above it and the whole grid runs together. */}
      <Grid className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {children}
      </Grid>
    </section>
  );
}

/** The label, identical on both sides of the toggle so nothing shifts. */
const DETAIL_LABEL =
  "mb-0.5 block text-[11px] font-medium uppercase leading-tight tracking-wide text-muted/80";

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
          // A native select rather than HeroUI's, matching the filter bars: its
          // trigger is built for the 40px fields in a drawer and would tower
          // over the inputs beside it here. The chevron is redrawn so it comes
          // from the same icon set as the rest of the page.
          <div className="relative">
            <select
              id={id}
              name={field.name}
              defaultValue={field.value ?? ""}
              // Keyed on the stored value so cancelling and re-entering starts
              // from what is on the record, not what was last typed. A rejected
              // submit leaves the record — and so the key — unchanged, which is
              // what keeps the corrected-but-not-yet-saved entry on screen.
              key={field.value}
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

  // A fixed cell (the customer id) still appears while editing, and by then the
  // section around it is a plain grid — `<dt>`/`<dd>` outside a `<dl>` is not
  // markup, so those two degrade to paragraphs.
  const Term = edit ? "p" : "dt";
  const Desc = edit ? "p" : "dd";

  return (
    <div className="min-w-0">
      {/* A size down from the value, and tighter line-height on both: the page
          holds ~25 of these, so a few pixels each is what decides whether the
          record fits on one screen. */}
      <Term className={DETAIL_LABEL}>{label}</Term>
      <Desc
        className={`text-sm leading-snug ${value ? "text-foreground" : "text-muted"} ${
          mono ? "break-all font-mono text-xs" : "truncate"
        }`}
        // Long values (an address, an email) would otherwise wrap onto a second
        // line and make their whole row taller; the full text stays available
        // on hover and to a screen reader.
        title={value || undefined}
      >
        {value || empty}
      </Desc>
    </div>
  );
}

/**
 * One file slot: the stored image, or the one waiting to replace it. No submit
 * of its own — the form around the slots owns that.
 *
 * On the record page that form posts to the upload endpoints. On registration
 * there is no id to upload against yet, so the same slot rides along with the
 * profile and the action uploads once the customer exists.
 */
export function UploadSlot({
  field,
  title,
  hint,
  currentUrl,
  error,
  onSelect,
}: {
  field: string;
  title: string;
  hint: string;
  currentUrl?: string;
  error?: string;
  /** Tells the parent whether this slot is holding a file to send. */
  onSelect: (hasFile: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * The chosen file as a data URL, so the picture appears the moment it is
   * selected rather than only after a round trip to Cloudinary.
   *
   * A data URL rather than `URL.createObjectURL`: an object URL has to be
   * revoked to avoid leaking the file, and every revocation is a chance to
   * blank the very image it was meant to show. A data URL is self-contained
   * and has no lifecycle to get wrong — worth the base64 for a ≤5 MB preview.
   */
  const [preview, setPreview] = useState<string | null>(null);

  // Clear the preview once the upload lands, so the card shows the stored
  // image rather than the local copy. This is the "adjust state when a prop
  // changes" pattern — done during render, not in an effect, so there is no
  // pass where the new URL is on screen and the stale preview is still set.
  const [seenUrl, setSeenUrl] = useState(currentUrl);
  if (currentUrl !== seenUrl) {
    setSeenUrl(currentUrl);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const [dragging, setDragging] = useState(false);
  // Rejections caught here rather than on the server: dropping a PDF should say
  // so straight away, not after a submit.
  const [localError, setLocalError] = useState<string | null>(null);
  const inputId = `upload-${field}`;

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

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    // The input is what posts the file, so the drop has to be written into it.
    // Via a fresh `DataTransfer` rather than assigning `dataTransfer.files`
    // wholesale: dropping several files onto a single-file input is not
    // something every browser accepts.
    if (inputRef.current) {
      const carrier = new DataTransfer();
      carrier.items.add(file);
      inputRef.current.files = carrier.files;
    }
    accept(file);
  }

  return (
    <div className="space-y-3 rounded-lg border-2 border-border bg-surface p-4">
      {/* The heading and the format rules are there to explain an empty slot.
          Once there is an image in it — stored, or picked and waiting — it
          speaks for itself, and the caption or the label below carries the
          rest. The input keeps `aria-label={title}`, so nothing is lost to a
          screen reader. */}
      {!preview && !currentUrl && (
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted">{hint}</p>
        </div>
      )}

      {/* Always mounted, never inside a branch: this input carries the file to
          the server, so unmounting it when the preview appears would drop the
          upload. `peer` + `sr-only` keeps it reachable by keyboard — the label
          picks up the focus ring on its behalf. */}
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
        <figure className="space-y-1.5">
          <div className="relative">
            {/* Sized to the card, not to the file: it fills the slot's width
                and is capped at `max-h-64`, so a tall image can't stretch the
                card down the page. `object-contain` keeps the whole picture
                visible within that box — `object-cover` would crop an ID, and
                a hard height would squash it. */}
            <img
              src={preview}
              alt={`${title} to be uploaded`}
              className="h-auto max-h-64 w-full rounded-lg border border-border object-contain"
            />
            <button
              type="button"
              onClick={remove}
              aria-label={`Remove the selected ${title.toLowerCase()}`}
              title="Remove"
              className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
            >
              <X size={14} />
            </button>
          </div>
          <figcaption className="text-xs font-medium text-success">
            Selected — not uploaded yet
          </figcaption>
        </figure>
      ) : (
        // The whole slot is the target: click it to open the picker, or drop a
        // file onto it. `htmlFor` does the click half without any JS.
        <label
          htmlFor={inputId}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          // Without preventDefault here the browser refuses the drop and then
          // navigates to the file instead.
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={[
            "block cursor-pointer rounded-lg border-2 border-dashed p-3 text-center transition-colors",
            "peer-focus-visible:border-success peer-focus-visible:ring-2 peer-focus-visible:ring-success/30",
            dragging
              ? "border-success bg-success/10"
              : "border-border hover:border-success/60 hover:bg-background",
          ].join(" ")}
        >
          {currentUrl && (
            <img
              src={currentUrl}
              alt={`Current ${title.toLowerCase()}`}
              className="mb-3 h-auto max-h-64 w-full rounded-lg border border-border object-contain"
            />
          )}
          <span className="flex flex-col items-center gap-1 py-3">
            <Upload size={18} className="text-muted" aria-hidden="true" />
            <span className="text-xs font-medium text-foreground">
              {currentUrl
                ? "Click or drop an image to replace"
                : "Click to choose a file, or drop one here"}
            </span>
            {/* Only worth saying while the slot is empty — it is the same rule
                the header states, and repeating it over a stored image is
                noise. */}
            {!currentUrl && (
              <span className="text-[11px] text-muted">
                JPEG, PNG or WebP · up to 5 MB
              </span>
            )}
          </span>
        </label>
      )}

      {/* Outside the label — a link nested in one would fight it for the
          click, and this opens the stored original rather than the picker. */}
      {!preview && currentUrl && (
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
