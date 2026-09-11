import { Loader2Icon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Form, Link, useNavigation } from "react-router";
import { toast } from "sonner";

import { ScanDrop, existing, type Slot } from "~/components/scan-drop";
import { Button } from "~/components/ui/button";
import { DateField } from "~/components/ui/date-field";
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

/** Friendly names for the API's field paths, so an issue reads as a form label. */
const FIELD_LABELS: Record<string, string> = {
  fullName: "Full name",
  phone: "Phone",
  altPhone: "Secondary phone",
  photoUrl: "Photo",
  idDocumentFrontUrl: "ID document — front",
  idDocumentBackUrl: "ID document — back",
  assignedCollectorId: "Assigned collector",
  dateOfBirth: "Date of birth",
  gender: "Gender",
  nationality: "Nationality",
  maritalStatus: "Marital status",
  residentialAddress: "Residential address",
  occupation: "Occupation",
  identification: "Identification",
  idType: "ID type",
  idNumber: "ID number",
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
