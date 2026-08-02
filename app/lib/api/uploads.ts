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

