import { apiFetch } from "~/lib/api/client";

/**
 * Image upload (`/uploads/images`) endpoint wrappers.
 *
 * This replaced the per-customer upload routes. `POST /customers/{id}/photo`
 * and `POST /customers/{id}/id-document` no longer exist: a picture is now
 * uploaded on its own, and the URL that comes back is written to the record as
 * an ordinary field (`photoUrl`, `idDocumentFrontUrl`, `idDocumentBackUrl`) on
 * create or update.
 *
 * That inversion is worth understanding, because it changes what can go wrong.
 * Uploading first means a rejected file is discovered *before* anything is
 * written — registration can no longer half-succeed, leaving a customer whose
 * photo silently didn't attach.
 *
 * Each call takes the caller's access token; failures throw `ApiError`.
 */

/** What the upload is for. `document` is stored at higher resolution. */
export type UploadKind = "photo" | "document";

export interface UploadedImage {
  /** Hosted URL — this is what gets submitted in the customer form. */
  url: string;
  /** Handle for `deleteImage`. Only uploads can be deleted. */
  publicId: string;
}

/**
 * POST /uploads/images
 *
 * JPEG/PNG/WebP, max 5 MB — the same limits the old endpoints had, and still
 * worth checking before the round trip (`validateUpload`) rather than pushing
 * five megabytes to be told no. The API answers 413 `FILE_TOO_LARGE` and 415
 * `UNSUPPORTED_FILE_TYPE`.
 *
 * The multipart part is named `image` — note it is *not* `photo`, which is what
 * the retired customer endpoints wanted for both the picture and the ID scan.
 */
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

/**
 * DELETE /uploads/images — 204, no body.
 *
 * Answers 403 `FORBIDDEN` for anything that didn't come from this endpoint, so
 * only a `publicId` handed back by `uploadImage` is a legal argument.
 */
export function deleteImage(
  accessToken: string,
  publicId: string,
): Promise<void> {
  return apiFetch(`/uploads/images?publicId=${encodeURIComponent(publicId)}`, {
    method: "DELETE",
    accessToken,
  });
}
