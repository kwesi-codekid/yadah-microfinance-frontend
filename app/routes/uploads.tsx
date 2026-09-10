import { data } from "react-router";

import { ApiError } from "~/api/error";
import { deleteImage, uploadImage, type UploadKind } from "~/api/uploads";
import { requireCounter, withAuth } from "~/lib/session.server";
import type { Route } from "./+types/uploads";

/**
 * Resource route for image uploads. The browser has no access token, so it
 * cannot call the API's `/uploads/images` directly — it posts the file here and
 * this action forwards it with the session's bearer token. Used by the customer
 * registration form for the photo and the two ID-document scans.
 *
 *   POST   /uploads?kind=photo|document   (multipart, field `image`) → { url, publicId }
 *   DELETE /uploads?publicId=...          → 204
 */
export async function action({ request }: Route.ActionArgs) {
  await requireCounter(request);
  const url = new URL(request.url);

  if (request.method === "DELETE") {
    const publicId = url.searchParams.get("publicId");
    if (!publicId) return data({ error: "publicId is required" }, { status: 400 });

    const { data: result, headers } = await withAuth(request, async (token) => {
      await deleteImage(token, publicId);
      return { ok: true };
    });
    return data(result, { headers });
  }

  if (request.method === "POST") {
    const kind: UploadKind =
      url.searchParams.get("kind") === "document" ? "document" : "photo";

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return data({ error: "Expected a multipart upload." }, { status: 400 });
    }
    const image = form.get("image");
    if (!(image instanceof File) || image.size === 0) {
      return data({ error: "No image was provided." }, { status: 400 });
    }

    try {
      const { data: result, headers } = await withAuth(request, (token) =>
        uploadImage(token, image, kind),
      );
      return data(result, { headers });
    } catch (error) {
      if (error instanceof ApiError) {
        // 413 too large, 415 unsupported type — surface the API's own message.
        return data({ error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }
  }

  return data({ error: "Method not allowed" }, { status: 405 });
}
