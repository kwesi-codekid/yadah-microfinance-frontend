import { apiFetch } from "~/lib/api/client";

/** What the upload is for. `document` is stored at higher resolution. */
export type UploadKind = "photo" | "document";

export interface UploadedImage {
  /** Hosted URL — this is what gets submitted in the customer form. */
  url: string;
  /** Handle for `deleteImage`. Only uploads can be deleted. */
  publicId: string;
}

export function uploadImage(
  accessToken: string,
  file: File,
  kind: UploadKind = "photo",
): Promise<UploadedImage> {
  const body = new FormData();
  body.set("image", file);
  return apiFetch(`/uploads/images?kind=${kind}`, {
    method: "POST",
    formData: body,
    accessToken,
  });
}

/** The shape the API will accept back — anything else answers 403. */
const PUBLIC_ID = /^yadah\/uploads\/[A-Za-z0-9-]+$/;

/** DELETE /uploads/images — for an upload that was replaced or abandoned. */
export function deleteImage(
  accessToken: string,
  publicId: string,
): Promise<void> {
  if (!PUBLIC_ID.test(publicId)) {
    return Promise.reject(
      new Error(`Not an uploads public id: ${publicId}`),
    );
  }
  return apiFetch(`/uploads/images?publicId=${encodeURIComponent(publicId)}`, {
    method: "DELETE",
    accessToken,
  });
}

/**
 * The public id inside a hosted URL, or null when it isn't one of ours.
 * The record stores the URL only, so a replaced image has to be found this way.
 */
export function publicIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/yadah\/uploads\/[A-Za-z0-9-]+/);
  return match && PUBLIC_ID.test(match[0]) ? match[0] : null;
}

