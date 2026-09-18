import { apiFetch } from "~/api/client";

/**
 * The two `/uploads/images` endpoints. Server-only — the browser has no token,
 * so image uploads are proxied through the `/uploads` resource route, which
 * calls these with the session's access token.
 */

export type UploadKind = "photo" | "document" | "signature";

export interface UploadedImage {
  /** Hosted image URL — submit this on the customer record. */
  url: string;
  /** Pass to `deleteImage` to remove an abandoned or replaced upload. */
  publicId: string;
}

/** POST /uploads/images */
export function uploadImage(
  accessToken: string,
  file: File,
  kind: UploadKind,
): Promise<UploadedImage> {
  const form = new FormData();
  form.append("image", file);
  return apiFetch(`/uploads/images?kind=${kind}`, {
    method: "POST",
    formData: form,
    accessToken,
  });
}

/** DELETE /uploads/images — clean up an upload that never got attached. */
export function deleteImage(
  accessToken: string,
  publicId: string,
): Promise<void> {
  return apiFetch(`/uploads/images?publicId=${encodeURIComponent(publicId)}`, {
    method: "DELETE",
    accessToken,
  });
}
