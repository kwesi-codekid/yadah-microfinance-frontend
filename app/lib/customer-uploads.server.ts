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

export async function uploadImageSlots(
  accessToken: string,
  pending: PendingImage[],
): Promise<Partial<Record<ImageUrlField, string>>> {
  const patch: Partial<Record<ImageUrlField, string>> = {};
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
