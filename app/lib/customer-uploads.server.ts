import * as uploadsApi from "~/lib/api/uploads";
import type { UploadKind } from "~/lib/api/uploads";
import type { CustomerInput } from "~/lib/customer-client";
import { validateUpload } from "~/lib/customer-form";

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

export interface UploadedSlots {
  patch: Partial<Record<ImageUrlField, string>>;
  /** Handles for `discardUploads`, should the save that follows fail. */
  publicIds: string[];
}

export async function uploadImageSlots(
  accessToken: string,
  pending: PendingImage[],
): Promise<UploadedSlots> {
  const patch: Partial<Record<ImageUrlField, string>> = {};
  const publicIds: string[] = [];
  for (const image of pending) {
    const { url, publicId } = await uploadsApi.uploadImage(
      accessToken,
      image.file,
      image.kind,
    );
    patch[image.target] = url;
    publicIds.push(publicId);
  }
  return { patch, publicIds };
}

/**
 * Delete uploads the record never took: a failed save, or a picture replaced by
 * a newer one. Best-effort — an orphaned image is not worth failing a save for.
 */
export async function discardUploads(
  accessToken: string,
  publicIds: (string | null)[],
): Promise<void> {
  await Promise.all(
    publicIds.filter((id): id is string => id !== null).map((id) =>
      uploadsApi.deleteImage(accessToken, id).catch((error) => {
        console.error("[uploads] could not delete", id, error);
      }),
    ),
  );
}

/** The old images a patch is about to overwrite, as deletable public ids. */
export function replacedPublicIds(
  previous: Partial<Record<ImageUrlField, string>>,
  patch: Partial<Record<ImageUrlField, string>>,
): (string | null)[] {
  return Object.keys(patch)
    .map((key) => previous[key as ImageUrlField])
    .map((url) => uploadsApi.publicIdFromUrl(url));
}

/** "Photo and ID document (front)" — for the confirmation message. */
export function describeUploads(pending: PendingImage[]): string {
  const labels = pending.map((image) => image.label);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
