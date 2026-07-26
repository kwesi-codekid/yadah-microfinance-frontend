import * as uploadsApi from "~/lib/api/uploads";
import type { UploadKind } from "~/lib/api/uploads";
import type { CustomerInput } from "~/lib/customer-client";
import { validateUpload } from "~/lib/customer-form";

/**
 * The picture half of the customer form, shared by register and edit.
 *
 * The API used to take a file at `POST /customers/{id}/photo`. It doesn't any
 * more: an image goes to `/uploads/images` on its own and the URL that comes
 * back is written to the record as an ordinary field. So every page that offers
 * an upload now does the same two steps — put the files somewhere, then send
 * the URLs — and they live here so the two can't do it differently.
 *
 * Note what the change costs: the old photo endpoint admitted the customer's
 * *assigned collector*, but `PATCH /customers/{id}` is office-only. A collector
 * can therefore no longer replace a photo, and offering them the slot would
 * only earn a 403.
 */

/**
 * The three customer fields an upload can fill. Named as its own type so the
 * patch below is `Record<ImageUrlField, string>` rather than a slice of
 * `CustomerInput` — indexing that by a union collapses the assignable value
 * type to nothing, since TypeScript can't know which of the three it is.
 */
type ImageUrlField = Extract<
  keyof CustomerInput,
  "photoUrl" | "idDocumentFrontUrl" | "idDocumentBackUrl"
>;

/** One image slot: the form field it posts under, and the record field it fills. */
const SLOTS = [
  {
    field: "photo",
    label: "Photo",
    target: "photoUrl",
    kind: "photo",
  },
  {
    field: "idDocumentFront",
    label: "ID document (front)",
    target: "idDocumentFrontUrl",
    kind: "document",
  },
  {
    field: "idDocumentBack",
    label: "ID document (back)",
    target: "idDocumentBackUrl",
    kind: "document",
  },
] as const satisfies readonly {
  field: string;
  label: string;
  target: ImageUrlField;
  kind: UploadKind;
}[];

export interface PendingImage {
  field: string;
  label: string;
  target: ImageUrlField;
  kind: UploadKind;
  file: File;
}

/**
 * Pick the files out of a submission and check them before anything is sent.
 *
 * The API answers 413/415 for a file it won't take, but finding that out costs
 * a five-megabyte upload — and on registration it would mean discovering the
 * problem partway through a multi-step write. Every slot is checked before any
 * of them is uploaded, so one bad file can't leave another already stored.
 */
export function readImageSlots(form: FormData): {
  pending: PendingImage[];
  fieldErrors: Record<string, string>;
} {
  const pending: PendingImage[] = [];
  const fieldErrors: Record<string, string> = {};

  for (const slot of SLOTS) {
    const value = form.get(slot.field);
    if (!(value instanceof File) || value.size === 0) continue;

    const error = validateUpload(value);
    if (error) fieldErrors[slot.field] = error;
    else pending.push({ ...slot, file: value });
  }

  return { pending, fieldErrors };
}

/**
 * Upload each pending file and return the URLs as a patch for the record.
 *
 * Call this *inside* the same `withAuth` as the write that consumes it: the
 * session helper reads its tokens off the request cookie every time, so a
 * second call in one action would still be holding a refresh token the first
 * had already spent.
 *
 * Failures propagate. On registration that is what you want — nothing has been
 * created yet, so a rejected upload simply means nothing happened.
 */
export async function uploadImageSlots(
  accessToken: string,
  pending: PendingImage[],
): Promise<Partial<Record<ImageUrlField, string>>> {
  const patch: Partial<Record<ImageUrlField, string>> = {};
  // Sequential, not `Promise.all`: three concurrent multipart uploads from a
  // phone on one bar of signal is how you get three timeouts instead of one
  // slow success.
  for (const image of pending) {
    const { url } = await uploadsApi.uploadImage(
      accessToken,
      image.file,
      image.kind,
    );
    patch[image.target] = url;
  }
  return patch;
}

/** "Photo and ID document (front)" — for the confirmation message. */
export function describeUploads(pending: PendingImage[]): string {
  const labels = pending.map((image) => image.label);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
